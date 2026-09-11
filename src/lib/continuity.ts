/**
 * Operational continuity — BCP04 (PRD §37).
 *
 * "Show degraded status for internet, email, AI or connector outages. Keep
 *  work queues and local functions available where infrastructure permits.
 *  Provide a controlled emergency obligation export and a procedure for
 *  recording work performed during downtime when the core returns."
 *
 * Three pieces, each built so it cannot overstate:
 *
 *  1. Service status. Database, object store and queue are MEASURED by a probe;
 *     internet, email, AI and connectors have no live integration in R0, so
 *     they are REPORTED by an administrator and otherwise stay UNKNOWN. A
 *     person cannot declare a probed service healthy, and a status that has
 *     not been checked recently is shown as unknown rather than as its last
 *     good value — a green light from yesterday is not a green light.
 *
 *  2. Emergency obligation export. One practice, open obligations only, the
 *     six DUE02 dates in separately labelled columns, plain CSV that opens in
 *     anything. Gated on export.run AND a fresh AUTH02 step-up, narrowed to
 *     the actor's assignment scope, and audited with a row count and digest —
 *     never the contents.
 *
 *  3. Downtime work records. Work done while the core was down is entered
 *     afterwards against when it actually happened, and stays a separate
 *     record until a human reconciles it. Reconciling does NOT create time
 *     entries or move jobs: an unreconciled note must never silently become
 *     billable or completed work, so the reconciler does those through the
 *     normal paths and records where it went.
 */

import { createHash } from "node:crypto";
import { connect } from "node:net";
import type { MonitoredService, ServiceState } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { recordEvent } from "@/lib/audit";
import { assertCan, can, reachesRecord, resolveMembership } from "@/lib/permissions";
import { getAccessiblePracticeIds, PracticeAccessError } from "@/lib/practice-scope";
import { hasValidStepUp } from "@/lib/auth";
import { bucketReachable } from "@/lib/object-store";
import { externalSendingDisabled } from "@/lib/external-sending";
import { versionConflict } from "@/lib/concurrency";

export class ContinuityError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "ContinuityError";
  }
}

// ------------------------------------------------------------ service status

export const MONITORED_SERVICES: MonitoredService[] = [
  "DATABASE",
  "OBJECT_STORE",
  "QUEUE",
  "INTERNET",
  "EMAIL",
  "AI",
  "CONNECTOR",
];

/** Services a probe measures. Only these can be set by the probe, and only these are refused to a person. */
const PROBED: ReadonlySet<MonitoredService> = new Set(["DATABASE", "OBJECT_STORE", "QUEUE"]);

/** A status older than this is shown as UNKNOWN, whatever it last said. */
export const STATUS_STALE_AFTER_MS = 15 * 60 * 1000;

const PROBE_TIMEOUT_MS = 3000;

/**
 * What still works when each service is not operational. BCP04 asks for local
 * functions to stay available "where infrastructure permits" — which only
 * helps if the screen says which ones.
 */
export const DEGRADED_GUIDANCE: Record<MonitoredService, string> = {
  DATABASE:
    "Core records are unavailable. Work from the latest emergency obligation export and note work on the downtime sheet; enter it here when the core returns.",
  OBJECT_STORE:
    "Work queues, the calendar and client records still work. Document upload, download and release are paused — nothing already filed is lost.",
  QUEUE:
    "Screens and records still work. Reminders, scheduled alerts and background exports are delayed until the queue returns; each carries a duplicate key, so none will send twice.",
  INTERNET:
    "Users on the office network keep full access. The client portal and outbound email cannot be reached from outside.",
  EMAIL:
    "Outbound messages stay queued and are not lost. Do not rely on email for anything time-critical — telephone and record the call on the thread.",
  AI:
    "AI drafting is unavailable. Every task can be done by hand; AI never holds final authority in this system.",
  CONNECTOR:
    "Connector syncs are paused. Enter data manually and mark it for reconciliation when the connector returns.",
};

export type ProbeResult = {
  service: MonitoredService;
  state: ServiceState;
  detail: string;
  /** False when the result could not be saved — expected when the database itself is down. */
  persisted: boolean;
};

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} did not answer within ${ms} ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function probeDatabase(): Promise<Omit<ProbeResult, "persisted">> {
  try {
    await withTimeout(prisma.$queryRawUnsafe("SELECT 1"), PROBE_TIMEOUT_MS, "Database");
    return { service: "DATABASE", state: "OPERATIONAL", detail: "Answered SELECT 1." };
  } catch (e) {
    return { service: "DATABASE", state: "OFFLINE", detail: message(e) };
  }
}

async function probeObjectStore(): Promise<Omit<ProbeResult, "persisted">> {
  try {
    const ok = await withTimeout(bucketReachable(), PROBE_TIMEOUT_MS, "Object store");
    return ok
      ? { service: "OBJECT_STORE", state: "OPERATIONAL", detail: "Bucket answered a signed HEAD." }
      : { service: "OBJECT_STORE", state: "DEGRADED", detail: "Store answered but refused the bucket HEAD." };
  } catch (e) {
    return { service: "OBJECT_STORE", state: "OFFLINE", detail: message(e) };
  }
}

/**
 * The queue is Redis. There is no Redis client in the dependency tree, and a
 * health check does not justify adding one: an inline PING over a socket is a
 * genuine round trip to the same server BullMQ would use.
 */
async function probeQueue(): Promise<Omit<ProbeResult, "persisted">> {
  const raw = process.env.REDIS_URL;
  if (!raw) {
    return { service: "QUEUE", state: "UNKNOWN", detail: "REDIS_URL is not configured." };
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { service: "QUEUE", state: "UNKNOWN", detail: "REDIS_URL is not a valid URL." };
  }

  try {
    const reply = await new Promise<string>((resolve, reject) => {
      const socket = connect({ host: url.hostname, port: Number(url.port || 6379) });
      let buffer = "";
      socket.setEncoding("utf8");
      // The socket's own timer, so a hung server is torn down, not leaked.
      socket.setTimeout(PROBE_TIMEOUT_MS, () => {
        socket.destroy();
        reject(new Error(`Queue did not answer within ${PROBE_TIMEOUT_MS} ms`));
      });
      socket.on("connect", () => {
        const password = url.password ? decodeURIComponent(url.password) : "";
        const user = url.username ? decodeURIComponent(url.username) : "";
        const auth = password ? `AUTH ${user ? `${user} ` : ""}${password}\r\n` : "";
        socket.write(`${auth}PING\r\n`);
      });
      socket.on("data", (chunk: string) => {
        buffer += chunk;
        if (buffer.includes("+PONG") || /(^|\r\n)-/.test(buffer)) {
          socket.destroy();
          resolve(buffer);
        }
      });
      socket.on("error", (err) => {
        socket.destroy();
        reject(err);
      });
    });
    if (reply.includes("+PONG")) {
      return { service: "QUEUE", state: "OPERATIONAL", detail: "Answered PING." };
    }
    // An error reply means the server is up but will not serve us — that is
    // degraded, not offline, and the reply itself (never the password) says why.
    return {
      service: "QUEUE",
      state: "DEGRADED",
      detail: `Server refused PING: ${reply.split("\r\n").find((l) => l.startsWith("-")) ?? "error reply"}`,
    };
  } catch (e) {
    return { service: "QUEUE", state: "OFFLINE", detail: message(e) };
  }
}

/**
 * Probe the measurable services and persist what was found. Returns the
 * results even when they cannot be saved — the case that matters most is the
 * database being down, and the caller must still be told.
 */
export async function probeServices(): Promise<ProbeResult[]> {
  const results = await Promise.all([probeDatabase(), probeObjectStore(), probeQueue()]);
  const out: ProbeResult[] = [];

  for (const r of results) {
    let persisted = false;
    try {
      await applyServiceState({
        service: r.service,
        state: r.state,
        detail: r.detail,
        actorServiceIdentity: "continuity-probe",
      });
      persisted = true;
    } catch {
      // Expected when the database is the thing that is down.
    }
    out.push({ ...r, persisted });
  }

  // Email is not probed (no live mail integration in R0), but an environment
  // that has sending switched off is KNOWN not to deliver. Saying so is
  // measured fact, not a guess, so it is recorded like a probe result.
  if (externalSendingDisabled()) {
    try {
      await applyServiceState({
        service: "EMAIL",
        state: "DEGRADED",
        detail: "External sending is disabled in this environment (EXTERNAL_SENDING_DISABLED).",
        actorServiceIdentity: "continuity-probe",
      });
    } catch {
      // Same reasoning as above.
    }
  }

  return out;
}

/**
 * The single write path for a service status. `since` moves only when the
 * state actually changes, so "down for three hours" stays true across the
 * probes that confirm it. Version-checked so two probes cannot interleave a
 * state change and lose its start time.
 */
async function applyServiceState(params: {
  service: MonitoredService;
  state: ServiceState;
  detail: string | null;
  actorUserId?: string;
  actorServiceIdentity?: string;
}): Promise<{ changed: boolean }> {
  const guidance = params.state === "OPERATIONAL" ? null : DEGRADED_GUIDANCE[params.service];

  for (let attempt = 0; attempt < 4; attempt++) {
    const now = new Date();
    const current = await prisma.serviceStatusRecord.findUnique({ where: { service: params.service } });

    if (!current) {
      try {
        await prisma.serviceStatusRecord.create({
          data: {
            service: params.service,
            state: params.state,
            since: now,
            checkedAt: now,
            detail: params.detail,
            degradedGuidance: guidance,
          },
        });
      } catch {
        continue; // Another writer created it first; re-read and apply as an update.
      }
      await auditStateChange(params, null);
      return { changed: true };
    }

    const changed = current.state !== params.state;
    const { count } = await prisma.serviceStatusRecord.updateMany({
      where: { service: params.service, version: current.version },
      data: {
        state: params.state,
        detail: params.detail,
        checkedAt: now,
        since: changed ? now : current.since,
        degradedGuidance: guidance,
        version: { increment: 1 },
      },
    });
    if (count === 1) {
      if (changed) await auditStateChange(params, current.state);
      return { changed };
    }
  }
  throw new ContinuityError(
    `Status for ${params.service} kept changing underneath this update; try again.`,
    "STATUS_CONTENTION",
    409,
  );
}

async function auditStateChange(
  params: { service: MonitoredService; state: ServiceState; detail: string | null; actorUserId?: string; actorServiceIdentity?: string },
  before: ServiceState | null,
) {
  await recordEvent({
    action: "SERVICE_STATE_CHANGED",
    targetType: "ServiceStatusRecord",
    targetId: params.service,
    result: "SUCCESS",
    actorUserId: params.actorUserId ?? null,
    actorServiceIdentity: params.actorServiceIdentity ?? null,
    beforeMeta: { state: before },
    afterMeta: { state: params.state, detail: params.detail },
  });
}

/**
 * IT administration is not practice-scoped professional authority (IAM02), and
 * service status is deployment-wide. So the test is: does this user hold
 * `system.administer` through ANY live membership?
 */
export async function isSystemAdministrator(userId: string): Promise<boolean> {
  for (const practiceId of await getAccessiblePracticeIds(userId)) {
    const m = await resolveMembership(userId, practiceId);
    if (m && can(m, "system.administer")) return true;
  }
  return false;
}

/**
 * The enforcing form. `isSystemAdministrator` is for deciding what a screen
 * shows and does not audit; this one records the refusal, because an attempt
 * to ACT without the authority is a security event.
 */
export async function assertSystemAdministrator(userId: string): Promise<void> {
  if (await isSystemAdministrator(userId)) return;
  await recordEvent({
    action: "PERMISSION_DENIED",
    targetType: "Permission",
    targetId: "system.administer",
    result: "FAILURE",
    actorUserId: userId,
    reason: "No live membership carries system.administer",
  });
  throw new ContinuityError("System administration permission is required.", "PERMISSION_DENIED", 403);
}

/**
 * An administrator reports the state of a service the system cannot measure —
 * internet, email, AI, connectors. Refused for probed services: a person
 * saying the database is fine is not evidence that it is.
 */
export async function reportServiceState(params: {
  actorUserId: string;
  service: MonitoredService;
  state: ServiceState;
  detail: string;
}): Promise<{ changed: boolean }> {
  await assertSystemAdministrator(params.actorUserId);
  if (PROBED.has(params.service)) {
    throw new ContinuityError(
      `${params.service} is measured by the health probe and cannot be set by hand.`,
      "SERVICE_IS_PROBED",
      409,
    );
  }
  if (!params.detail.trim()) {
    throw new ContinuityError("Say what was observed — a status with no detail cannot be acted on.", "DETAIL_REQUIRED");
  }
  return applyServiceState({
    service: params.service,
    state: params.state,
    detail: params.detail.trim(),
    actorUserId: params.actorUserId,
  });
}

export type ServiceStatusView = {
  service: MonitoredService;
  /** What the record says. */
  recordedState: ServiceState;
  /** What the screen should show — UNKNOWN when never checked or stale. */
  effectiveState: ServiceState;
  stale: boolean;
  measured: boolean;
  since: Date | null;
  checkedAt: Date | null;
  detail: string | null;
  guidance: string | null;
  version: number | null;
};

export async function serviceStatusBoard(at: Date = new Date()): Promise<ServiceStatusView[]> {
  const rows = await prisma.serviceStatusRecord.findMany();
  const byService = new Map(rows.map((r) => [r.service, r]));

  return MONITORED_SERVICES.map((service) => {
    const r = byService.get(service);
    if (!r) {
      return {
        service,
        recordedState: "UNKNOWN",
        effectiveState: "UNKNOWN",
        stale: false,
        measured: PROBED.has(service),
        since: null,
        checkedAt: null,
        detail: "Never checked.",
        guidance: DEGRADED_GUIDANCE[service],
        version: null,
      };
    }
    const stale = at.getTime() - r.checkedAt.getTime() > STATUS_STALE_AFTER_MS;
    return {
      service,
      recordedState: r.state,
      effectiveState: stale ? "UNKNOWN" : r.state,
      stale,
      measured: PROBED.has(service),
      since: r.since,
      checkedAt: r.checkedAt,
      detail: r.detail,
      guidance: stale && r.state === "OPERATIONAL" ? DEGRADED_GUIDANCE[service] : r.degradedGuidance,
      version: r.version,
    };
  });
}

export type FunctionAvailability = {
  name: string;
  dependsOn: MonitoredService[];
  /** AVAILABLE only when every dependency is freshly OPERATIONAL. */
  availability: "AVAILABLE" | "DEGRADED" | "UNAVAILABLE" | "UNCERTAIN";
  blockedBy: MonitoredService[];
};

const LOCAL_FUNCTIONS: { name: string; dependsOn: MonitoredService[] }[] = [
  { name: "Work queues, client records and calendar", dependsOn: ["DATABASE"] },
  { name: "Emergency obligation export", dependsOn: ["DATABASE"] },
  { name: "Documents: upload, download, release", dependsOn: ["DATABASE", "OBJECT_STORE"] },
  { name: "Reminders and scheduled alerts", dependsOn: ["DATABASE", "QUEUE", "EMAIL"] },
  { name: "Client portal", dependsOn: ["DATABASE", "OBJECT_STORE", "INTERNET"] },
  { name: "AI drafting", dependsOn: ["AI"] },
  { name: "Connector sync", dependsOn: ["CONNECTOR"] },
];

/**
 * BCP04 "keep work queues and local functions available where infrastructure
 * permits", turned into what a user can actually do right now. Worst
 * dependency wins, and anything not freshly known is UNCERTAIN — never
 * AVAILABLE by default.
 */
export function localFunctionAvailability(board: ServiceStatusView[]): FunctionAvailability[] {
  const state = new Map(board.map((b) => [b.service, b.effectiveState]));
  return LOCAL_FUNCTIONS.map((f) => {
    const states = f.dependsOn.map((s) => state.get(s) ?? "UNKNOWN");
    const blockedBy = f.dependsOn.filter((s) => state.get(s) !== "OPERATIONAL");
    let availability: FunctionAvailability["availability"];
    if (states.includes("OFFLINE")) availability = "UNAVAILABLE";
    else if (states.includes("DEGRADED")) availability = "DEGRADED";
    else if (states.includes("UNKNOWN")) availability = "UNCERTAIN";
    else availability = "AVAILABLE";
    return { ...f, availability, blockedBy };
  });
}

// ------------------------------------------------ emergency obligation export

/** Final states — an emergency list is of work still to do. */
const CLOSED_OBLIGATION_STATES = ["FILED", "NOT_APPLICABLE", "CANCELLED"] as const;

const EXPORT_COLUMNS = [
  "obligation_id",
  "client_legal_name",
  "rule_code",
  "rule_version",
  "period",
  "status",
  "governing_law",
  "assessment_year",
  "tax_year",
  "taxpayer_category",
  "form_version",
  "original_statutory_date",
  "current_statutory_date",
  "payment_deadline",
  "client_document_cutoff",
  "internal_target_date",
  "review_target_date",
] as const;

export type EmergencyExport = {
  practiceId: string;
  practiceName: string;
  csv: string;
  rowCount: number;
  sha256: string;
  exportedAt: Date;
  filename: string;
};

/**
 * A spreadsheet opening this file must not execute anything in it. Cells that
 * begin with a formula trigger are prefixed, then every cell is quoted.
 */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

function isoDate(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : "";
}

/**
 * BCP04's "controlled emergency obligation export". Controlled means:
 * one practice (never Combined), export.run in that practice, a fresh AUTH02
 * step-up on the caller's own live session, a stated reason, the actor's
 * assignment scope applied, and an audit event carrying the count and digest.
 */
export async function emergencyObligationExport(params: {
  actorUserId: string;
  sessionId: string;
  practiceId: string;
  reason: string;
  at?: Date;
}): Promise<EmergencyExport> {
  const exportedAt = params.at ?? new Date();

  if (!params.reason.trim()) {
    throw new ContinuityError("An emergency export needs a stated reason.", "REASON_REQUIRED");
  }

  const membership = await assertCan(params.actorUserId, params.practiceId, "export.run", exportedAt);

  // AUTH02: exports need a fresh MFA proof — and it must be THIS user's live
  // session, or a step-up on someone else's session would open the door.
  const session = await prisma.session.findUnique({
    where: { id: params.sessionId },
    select: { userId: true, revokedAt: true, idleExpiresAt: true, absoluteExpiresAt: true },
  });
  const sessionLive =
    session &&
    session.userId === params.actorUserId &&
    !session.revokedAt &&
    session.idleExpiresAt > exportedAt &&
    session.absoluteExpiresAt > exportedAt;
  if (!sessionLive || !(await hasValidStepUp(params.sessionId, "EXPORT"))) {
    await recordEvent({
      action: "EMERGENCY_OBLIGATION_EXPORT",
      targetType: "Practice",
      targetId: params.practiceId,
      result: "FAILURE",
      actorUserId: params.actorUserId,
      practiceId: params.practiceId,
      reason: "No valid EXPORT step-up on the caller's live session",
    });
    throw new ContinuityError(
      "Confirm with your authenticator code before exporting.",
      "STEP_UP_REQUIRED",
      403,
    );
  }

  const practice = await prisma.practice.findUniqueOrThrow({
    where: { id: params.practiceId },
    select: { name: true },
  });

  const obligations = await prisma.obligation.findMany({
    where: {
      practiceId: params.practiceId,
      archivedAt: null,
      status: { notIn: [...CLOSED_OBLIGATION_STATES] },
    },
    select: {
      id: true,
      periodKey: true,
      status: true,
      ruleVersion: true,
      governingLaw: true,
      assessmentYear: true,
      taxYear: true,
      taxpayerCategory: true,
      formVersion: true,
      originalStatutoryDate: true,
      currentStatutoryDate: true,
      paymentDeadline: true,
      clientDocumentCutoff: true,
      internalTargetDate: true,
      reviewTargetDate: true,
      rule: { select: { code: true } },
      clientRelationship: { select: { party: { select: { legalName: true } } } },
      engagement: { select: { ownerUserId: true, reviewerUserId: true } },
    },
    orderBy: [{ currentStatutoryDate: "asc" }, { id: "asc" }],
  });

  // IAM03: a practice-wide export for someone whose role reaches only their
  // own engagements would be a scope escalation through a file. An obligation
  // with no engagement has no owner to match, so narrow scopes do not reach it.
  const reachable = obligations.filter((o) =>
    reachesRecord(
      membership,
      {
        ownerUserId: o.engagement?.ownerUserId ?? null,
        assignedUserIds: o.engagement?.reviewerUserId ? [o.engagement.reviewerUserId] : [],
      },
      params.actorUserId,
    ),
  );

  const lines = [EXPORT_COLUMNS.join(",")];
  for (const o of reachable) {
    lines.push(
      [
        o.id,
        o.clientRelationship.party.legalName,
        o.rule.code,
        o.ruleVersion,
        o.periodKey,
        o.status,
        o.governingLaw,
        o.assessmentYear,
        o.taxYear,
        o.taxpayerCategory,
        o.formVersion,
        isoDate(o.originalStatutoryDate),
        isoDate(o.currentStatutoryDate),
        isoDate(o.paymentDeadline),
        isoDate(o.clientDocumentCutoff),
        isoDate(o.internalTargetDate),
        isoDate(o.reviewTargetDate),
      ]
        .map(csvCell)
        .join(","),
    );
  }
  // CRLF per RFC 4180, so the file opens cleanly in whatever is to hand.
  const csv = `${lines.join("\r\n")}\r\n`;
  const sha256 = createHash("sha256").update(csv).digest("hex");

  await recordEvent({
    action: "EXPORT_RUN",
    targetType: "EmergencyObligationExport",
    targetId: params.practiceId,
    result: "SUCCESS",
    actorUserId: params.actorUserId,
    practiceId: params.practiceId,
    reason: params.reason.trim(),
    afterMeta: { rowCount: reachable.length, sha256, assignmentScope: membership.assignmentScope },
  });

  return {
    practiceId: params.practiceId,
    practiceName: practice.name,
    csv,
    rowCount: reachable.length,
    sha256,
    exportedAt,
    filename: `emergency-obligations-${exportedAt.toISOString().slice(0, 10)}.csv`,
  };
}

// ------------------------------------------------------ downtime work records

export type DowntimeEntry = {
  occurredAt: Date;
  description: string;
  service?: MonitoredService | null;
  jobId?: string | null;
  obligationId?: string | null;
};

/**
 * Validate one entry against the practice. A linked job or obligation from
 * another practice is reported as not found, like everywhere else (API01), so
 * a downtime sheet cannot be used to probe for record ids.
 */
async function validateEntry(practiceId: string, e: DowntimeEntry, now: Date): Promise<void> {
  if (!e.description.trim()) {
    throw new ContinuityError("Describe the work that was done.", "DESCRIPTION_REQUIRED");
  }
  if (Number.isNaN(e.occurredAt.getTime())) {
    throw new ContinuityError("When the work happened is not a valid date.", "OCCURRED_AT_INVALID");
  }
  // A minute of clock skew between the paper sheet and the server is not fraud.
  if (e.occurredAt.getTime() > now.getTime() + 60_000) {
    throw new ContinuityError("Downtime work cannot be dated in the future.", "OCCURRED_AT_FUTURE");
  }
  if (e.jobId) {
    const job = await prisma.job.findFirst({ where: { id: e.jobId, practiceId }, select: { id: true } });
    if (!job) throw new ContinuityError("Linked job not found.", "JOB_NOT_FOUND", 404);
  }
  if (e.obligationId) {
    const ob = await prisma.obligation.findFirst({
      where: { id: e.obligationId, practiceId },
      select: { id: true },
    });
    if (!ob) throw new ContinuityError("Linked obligation not found.", "OBLIGATION_NOT_FOUND", 404);
  }
}

/**
 * Enter a downtime sheet when the core returns. All-or-nothing: a sheet with
 * one bad line is sent back whole, rather than half-entered so nobody can tell
 * which lines made it.
 */
export async function recordDowntimeWork(params: {
  actorUserId: string;
  practiceId: string;
  entries: DowntimeEntry[];
}): Promise<{ ids: string[] }> {
  await assertCan(params.actorUserId, params.practiceId, "job.write");
  if (params.entries.length === 0) {
    throw new ContinuityError("The downtime sheet has no entries.", "NO_ENTRIES");
  }
  if (params.entries.length > 500) {
    throw new ContinuityError("Enter at most 500 lines at once.", "TOO_MANY_ENTRIES");
  }

  const now = new Date();
  for (const [i, e] of params.entries.entries()) {
    try {
      await validateEntry(params.practiceId, e, now);
    } catch (err) {
      if (err instanceof ContinuityError) {
        throw new ContinuityError(`Line ${i + 1}: ${err.message}`, err.code, err.status);
      }
      throw err;
    }
  }

  const ids = await prisma.$transaction(async (tx) => {
    const created: string[] = [];
    for (const e of params.entries) {
      const row = await tx.downtimeWorkRecord.create({
        data: {
          practiceId: params.practiceId,
          recordedByUserId: params.actorUserId,
          occurredAt: e.occurredAt,
          recordedAt: now,
          service: e.service ?? null,
          description: e.description.trim(),
          jobId: e.jobId ?? null,
          obligationId: e.obligationId ?? null,
        },
        select: { id: true },
      });
      created.push(row.id);
    }
    return created;
  });

  await recordEvent({
    action: "DOWNTIME_WORK_RECORDED",
    targetType: "DowntimeWorkRecord",
    targetId: ids[0],
    result: "SUCCESS",
    actorUserId: params.actorUserId,
    practiceId: params.practiceId,
    afterMeta: { count: ids.length, ids },
  });

  return { ids };
}

/**
 * A person confirms where a downtime record went — which job it was entered
 * against, which time entry now carries it, or why it needs nothing. This
 * does not itself move a job or create a time entry; those happen through
 * their own paths with their own controls.
 */
export async function reconcileDowntimeWork(params: {
  actorUserId: string;
  practiceId: string;
  recordId: string;
  expectedVersion: number;
  note: string;
}): Promise<{ version: number; reconciledAt: Date }> {
  await assertCan(params.actorUserId, params.practiceId, "job.write");
  if (!params.note.trim()) {
    throw new ContinuityError(
      "Say where this work was entered, or why it needs nothing.",
      "NOTE_REQUIRED",
    );
  }

  const record = await prisma.downtimeWorkRecord.findFirst({
    where: { id: params.recordId, practiceId: params.practiceId },
    select: { id: true, version: true, reconciledAt: true },
  });
  if (!record) throw new PracticeAccessError(params.actorUserId, params.practiceId);
  if (record.reconciledAt) {
    throw new ContinuityError("This downtime record is already reconciled.", "ALREADY_RECONCILED", 409);
  }

  const reconciledAt = new Date();
  const { count } = await prisma.downtimeWorkRecord.updateMany({
    where: {
      id: record.id,
      practiceId: params.practiceId,
      version: params.expectedVersion,
      reconciledAt: null,
    },
    data: {
      reconciledAt,
      reconciledByUserId: params.actorUserId,
      reconciliationNote: params.note.trim(),
      version: { increment: 1 },
    },
  });
  if (count === 0) {
    const now = await prisma.downtimeWorkRecord.findUnique({
      where: { id: record.id },
      select: { version: true },
    });
    throw await versionConflict({
      subjectType: "DowntimeWorkRecord",
      subjectId: record.id,
      expectedVersion: params.expectedVersion,
      currentVersion: now?.version ?? record.version,
      message: "This downtime record changed since you loaded it.",
    });
  }

  await recordEvent({
    action: "DOWNTIME_WORK_RECONCILED",
    targetType: "DowntimeWorkRecord",
    targetId: record.id,
    targetVersion: params.expectedVersion + 1,
    result: "SUCCESS",
    actorUserId: params.actorUserId,
    practiceId: params.practiceId,
    reason: params.note.trim(),
  });

  return { version: params.expectedVersion + 1, reconciledAt };
}

/** Outstanding downtime work in one practice — the list that must reach zero. */
export async function unreconciledDowntimeWork(actorUserId: string, practiceId: string) {
  await assertCan(actorUserId, practiceId, "job.read");
  return prisma.downtimeWorkRecord.findMany({
    where: { practiceId, reconciledAt: null },
    orderBy: { occurredAt: "asc" },
  });
}

function message(e: unknown): string {
  return e instanceof Error ? e.message.slice(0, 300) : String(e).slice(0, 300);
}
