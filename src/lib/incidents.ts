/**
 * Incident clocks — PRV04 (PRD §36).
 *
 * "For applicable CERT In directions, assess specified cyber incidents
 *  against the six hour awareness based reporting requirement and maintain
 *  applicable ICT logs for rolling 180 days in Indian jurisdiction. Keep this
 *  assessment distinct from routine support incidents and future DPDP clocks."
 *
 * Acceptance evidence: "The incident screen shows awareness time and the
 * correct independent reporting clocks, even if root cause investigation is
 * incomplete."
 *
 * How that is kept honest:
 *
 *  - Every clock runs from AWARENESS. Root cause has no input into any clock;
 *    an incident with root cause UNKNOWN shows exactly the same deadlines.
 *  - The CERT-In clock starts running while applicability is still being
 *    assessed. "We had not finished deciding" is not a reason the six hours
 *    did not start, so a PENDING assessment shows the deadline, not a blank.
 *  - Clock states are DERIVED from the awareness time, the assessment and the
 *    reports actually recorded. Nothing stores "met" as a flag.
 *  - The DPDP clocks are independent rows, and their standing comes from the
 *    PRV02 register: was the duty operative AT the awareness time, on what
 *    the register knows now? Not tracked, not operative, or operative.
 *    PRV05's workflow is R1, so even an operative DPDP clock only says what
 *    is due; it does not pretend to run it.
 *  - Routine support incidents get no regulatory clock at all.
 *  - Awareness can be corrected EARLIER only. Moving it later would lengthen
 *    a statutory deadline after the fact.
 */

import type { IncidentClockRegime } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { recordEvent } from "@/lib/audit";
import { assertCan } from "@/lib/permissions";
import { versionConflict } from "@/lib/concurrency";
import { PrivacyError, legalStandingAt, type RegulatoryStanding } from "@/lib/privacy-register";

export const CERT_IN_HOURS = 6;
export const DPDP_DETAILED_HOURS = 72;
/**
 * The register code a practice records the DPDP breach-intimation duty under.
 * Its legal state is whatever the practice's register says — this module does
 * not assert it.
 */
export const DPDP_BREACH_CODE = "DPDP-BREACH-INTIMATION";

const HOUR = 3_600_000;

async function actorName(userId: string) {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { fullName: true } });
  return u?.fullName ?? "(unknown)";
}

export type ClockState =
  | "RUNNING"
  | "RUNNING_ASSESSMENT_PENDING"
  | "OVERDUE"
  | "MET"
  | "LATE"
  | "NOT_APPLICABLE"
  | "NOT_OPERATIVE"
  | "NOT_TRACKED"
  | "WITHOUT_DELAY";

export type IncidentClock = {
  regime: IncidentClockRegime;
  label: string;
  startsAt: Date;
  /** Null where the duty is "without delay" rather than a fixed period. */
  dueAt: Date | null;
  state: ClockState;
  reportedAt: Date | null;
  reference: string | null;
  explanation: string;
};

type IncidentForClocks = {
  practiceId: string;
  track: "SECURITY" | "ROUTINE_SUPPORT";
  awarenessAt: Date;
  certInAssessment: "PENDING" | "APPLICABLE" | "NOT_APPLICABLE";
  certInReason: string | null;
  reports: { regime: IncidentClockRegime; reportedAt: Date; reference: string }[];
};

function fixedClock(
  regime: IncidentClockRegime,
  label: string,
  startsAt: Date,
  hours: number,
  report: { reportedAt: Date; reference: string } | undefined,
  now: Date,
  pending: boolean,
): IncidentClock {
  const dueAt = new Date(startsAt.getTime() + hours * HOUR);
  if (report) {
    const late = report.reportedAt > dueAt;
    return {
      regime, label, startsAt, dueAt,
      state: late ? "LATE" : "MET",
      reportedAt: report.reportedAt,
      reference: report.reference,
      explanation: late
        ? `Reported ${hoursBetween(dueAt, report.reportedAt)} after the ${hours} h deadline.`
        : `Reported within ${hours} h of awareness.`,
    };
  }
  if (now > dueAt) {
    return {
      regime, label, startsAt, dueAt, state: "OVERDUE", reportedAt: null, reference: null,
      explanation: pending
        ? `The ${hours} h deadline has passed and applicability is STILL being assessed.`
        : `The ${hours} h deadline has passed with no report recorded.`,
    };
  }
  return {
    regime, label, startsAt, dueAt,
    state: pending ? "RUNNING_ASSESSMENT_PENDING" : "RUNNING",
    reportedAt: null, reference: null,
    explanation: pending
      ? `Running from awareness while applicability is assessed — ${hoursBetween(now, dueAt)} left.`
      : `${hoursBetween(now, dueAt)} left to report.`,
  };
}

function hoursBetween(a: Date, b: Date) {
  const mins = Math.round(Math.abs(b.getTime() - a.getTime()) / 60_000);
  return `${Math.floor(mins / 60)} h ${mins % 60} min`;
}

function dpdpClocks(
  standing: RegulatoryStanding,
  startsAt: Date,
  reports: IncidentForClocks["reports"],
  now: Date,
): IncidentClock[] {
  const defs: { regime: IncidentClockRegime; label: string; hours: number | null }[] = [
    { regime: "DPDP_AFFECTED_PERSONS", label: "DPDP — notice to affected persons", hours: null },
    { regime: "DPDP_BOARD_INITIAL", label: "DPDP — initial intimation to the Board", hours: null },
    { regime: "DPDP_BOARD_DETAILED_72H", label: "DPDP — detailed information to the Board", hours: DPDP_DETAILED_HOURS },
  ];
  if (!standing.tracked) {
    return defs.map((d) => ({
      regime: d.regime, label: d.label, startsAt, dueAt: null, state: "NOT_TRACKED" as const,
      reportedAt: null, reference: null,
      explanation: `The DPDP breach duty (${standing.code}) is not in this practice's regulatory register — its status is UNKNOWN, not "not applicable". Record it before relying on this.`,
    }));
  }
  if (!standing.operative) {
    return defs.map((d) => ({
      regime: d.regime, label: d.label, startsAt, dueAt: null, state: "NOT_OPERATIVE" as const,
      reportedAt: null, reference: null,
      explanation: `The register records ${standing.code} as ${standing.state}, not operative at the awareness time — no DPDP clock runs yet (source: ${standing.sourceReference}).`,
    }));
  }
  return defs.map((d) => {
    const report = reports.find((r) => r.regime === d.regime);
    if (d.hours !== null) return fixedClock(d.regime, d.label, startsAt, d.hours, report, now, false);
    return {
      regime: d.regime, label: d.label, startsAt, dueAt: null,
      state: report ? ("MET" as const) : ("WITHOUT_DELAY" as const),
      reportedAt: report?.reportedAt ?? null, reference: report?.reference ?? null,
      explanation: report
        ? "Recorded."
        : "Due without delay. The guided breach workflow (PRV05) is R1 — handle and record it manually.",
    };
  });
}

/** The clocks for one incident, as at `now`. Root cause is deliberately not an input. */
export async function incidentClocks(incident: IncidentForClocks, now: Date = new Date()): Promise<IncidentClock[]> {
  if (incident.track === "ROUTINE_SUPPORT") return [];

  const certReport = incident.reports.find((r) => r.regime === "CERT_IN_6H");
  let cert: IncidentClock;
  if (incident.certInAssessment === "NOT_APPLICABLE") {
    cert = {
      regime: "CERT_IN_6H", label: "CERT-In — report within 6 h",
      startsAt: incident.awarenessAt, dueAt: null, state: "NOT_APPLICABLE",
      reportedAt: null, reference: null,
      explanation: `Assessed as not a specified incident: ${incident.certInReason ?? "(no reason)"}`,
    };
  } else {
    cert = fixedClock(
      "CERT_IN_6H", "CERT-In — report within 6 h", incident.awarenessAt, CERT_IN_HOURS,
      certReport, now, incident.certInAssessment === "PENDING",
    );
  }

  const standing = await legalStandingAt(incident.practiceId, DPDP_BREACH_CODE, incident.awarenessAt);
  return [cert, ...dpdpClocks(standing, incident.awarenessAt, incident.reports, now)];
}

// ---------------------------------------------------------------- mutations

export async function reportIncident(params: {
  actorUserId: string;
  practiceId: string;
  title: string;
  summary: string;
  track: "SECURITY" | "ROUTINE_SUPPORT";
  awarenessAt: Date;
  securityAlertId?: string | null;
  now?: Date;
}) {
  await assertCan(params.actorUserId, params.practiceId, "incident.report");
  const now = params.now ?? new Date();
  if (!params.title?.trim() || !params.summary?.trim()) {
    throw new PrivacyError("Give the incident a title and a summary", "FIELD_REQUIRED");
  }
  if (params.awarenessAt > now) {
    throw new PrivacyError("Awareness cannot be in the future", "AWARENESS_IN_FUTURE");
  }
  if (params.securityAlertId) {
    const alert = await prisma.securityAlert.findFirst({
      where: { id: params.securityAlertId, OR: [{ practiceId: params.practiceId }, { practiceId: null }] },
      select: { id: true },
    });
    if (!alert) throw new PrivacyError("Not found", "NOT_FOUND", 404);
  }
  const name = await actorName(params.actorUserId);
  const row = await prisma.securityIncident.create({
    data: {
      practiceId: params.practiceId,
      title: params.title.trim(),
      summary: params.summary.trim(),
      track: params.track,
      awarenessAt: params.awarenessAt,
      recordedAt: now,
      securityAlertId: params.securityAlertId ?? null,
      reportedByUserId: params.actorUserId,
      reportedByName: name,
    },
  });
  await recordEvent({
    action: "INCIDENT_REPORTED",
    targetType: "SecurityIncident",
    targetId: row.id,
    result: "SUCCESS",
    actorUserId: params.actorUserId,
    practiceId: params.practiceId,
    targetVersion: row.version,
    afterMeta: { track: row.track, awarenessAt: row.awarenessAt.toISOString() },
  });
  return row;
}

async function loadForUpdate(practiceId: string, incidentId: string, expectedVersion: number) {
  const row = await prisma.securityIncident.findFirst({ where: { id: incidentId, practiceId } });
  if (!row) throw new PrivacyError("Not found", "NOT_FOUND", 404);
  if (row.version !== expectedVersion) {
    throw await versionConflict({
      subjectType: "SecurityIncident",
      subjectId: row.id,
      expectedVersion,
      currentVersion: row.version,
    });
  }
  return row;
}

async function bump(incidentId: string, expectedVersion: number, data: Record<string, unknown>) {
  const res = await prisma.securityIncident.updateMany({
    where: { id: incidentId, version: expectedVersion },
    data: { ...data, version: { increment: 1 } },
  });
  if (res.count === 0) {
    throw await versionConflict({
      subjectType: "SecurityIncident",
      subjectId: incidentId,
      expectedVersion,
      currentVersion: expectedVersion + 1,
    });
  }
}

export async function assessCertIn(params: {
  actorUserId: string;
  practiceId: string;
  incidentId: string;
  expectedVersion: number;
  applicable: boolean;
  category?: string | null;
  reason: string;
  now?: Date;
}) {
  await assertCan(params.actorUserId, params.practiceId, "incident.manage");
  const row = await loadForUpdate(params.practiceId, params.incidentId, params.expectedVersion);
  if (row.track !== "SECURITY") {
    throw new PrivacyError(
      "A routine support incident has no CERT-In assessment — reclassify it as a security incident first",
      "NOT_A_SECURITY_INCIDENT",
    );
  }
  if (!params.reason?.trim()) throw new PrivacyError("An assessment needs a reason", "REASON_REQUIRED");
  if (params.applicable && !params.category?.trim()) {
    throw new PrivacyError("Name the specified incident category it falls under", "CATEGORY_REQUIRED");
  }
  const name = await actorName(params.actorUserId);
  await bump(row.id, params.expectedVersion, {
    certInAssessment: params.applicable ? "APPLICABLE" : "NOT_APPLICABLE",
    certInCategory: params.applicable ? params.category!.trim() : null,
    certInReason: params.reason.trim(),
    assessedByUserId: params.actorUserId,
    assessedByName: name,
    assessedAt: params.now ?? new Date(),
  });
  await recordEvent({
    action: "INCIDENT_CERT_IN_ASSESSED",
    targetType: "SecurityIncident",
    targetId: row.id,
    result: "SUCCESS",
    actorUserId: params.actorUserId,
    practiceId: params.practiceId,
    targetVersion: params.expectedVersion + 1,
    reason: params.reason,
    afterMeta: { applicable: params.applicable },
  });
  return getIncident(params.actorUserId, params.practiceId, row.id, params.now);
}

export async function recordIncidentReport(params: {
  actorUserId: string;
  practiceId: string;
  incidentId: string;
  regime: IncidentClockRegime;
  reportedAt: Date;
  reference: string;
  now?: Date;
}) {
  await assertCan(params.actorUserId, params.practiceId, "incident.manage");
  const now = params.now ?? new Date();
  const row = await prisma.securityIncident.findFirst({
    where: { id: params.incidentId, practiceId: params.practiceId },
  });
  if (!row) throw new PrivacyError("Not found", "NOT_FOUND", 404);
  if (!params.reference?.trim()) {
    throw new PrivacyError("Record the acknowledgement or reference the authority gave", "REFERENCE_REQUIRED");
  }
  if (params.reportedAt > now || params.reportedAt < row.awarenessAt) {
    throw new PrivacyError("A report time must fall between awareness and now", "BAD_REPORT_TIME");
  }
  if (params.regime === "CERT_IN_6H" && row.certInAssessment === "NOT_APPLICABLE") {
    throw new PrivacyError("This incident was assessed as not reportable to CERT-In", "NOT_APPLICABLE");
  }
  const existing = await prisma.incidentReport.findUnique({
    where: { incidentId_regime: { incidentId: row.id, regime: params.regime } },
  });
  if (existing) throw new PrivacyError("A report is already recorded for this regime", "ALREADY_REPORTED", 409);

  const name = await actorName(params.actorUserId);
  const report = await prisma.incidentReport.create({
    data: {
      practiceId: params.practiceId,
      incidentId: row.id,
      regime: params.regime,
      reportedAt: params.reportedAt,
      reference: params.reference.trim(),
      recordedByUserId: params.actorUserId,
      recordedByName: name,
    },
  });
  await recordEvent({
    action: "INCIDENT_REPORT_RECORDED",
    targetType: "SecurityIncident",
    targetId: row.id,
    result: "SUCCESS",
    actorUserId: params.actorUserId,
    practiceId: params.practiceId,
    afterMeta: { regime: params.regime, reportedAt: params.reportedAt.toISOString() },
  });
  return report;
}

export async function reviseAwareness(params: {
  actorUserId: string;
  practiceId: string;
  incidentId: string;
  expectedVersion: number;
  newAwarenessAt: Date;
  reason: string;
}) {
  await assertCan(params.actorUserId, params.practiceId, "incident.manage");
  const row = await loadForUpdate(params.practiceId, params.incidentId, params.expectedVersion);
  if (!params.reason?.trim()) throw new PrivacyError("A correction needs a reason", "REASON_REQUIRED");
  if (params.newAwarenessAt >= row.awarenessAt) {
    throw new PrivacyError(
      "Awareness can only be corrected to an EARLIER time — moving it later would extend a statutory deadline after the fact",
      "AWARENESS_ONLY_EARLIER",
      409,
    );
  }
  const name = await actorName(params.actorUserId);
  await prisma.$transaction([
    prisma.incidentAwarenessRevision.create({
      data: {
        practiceId: params.practiceId,
        incidentId: row.id,
        previousAwarenessAt: row.awarenessAt,
        newAwarenessAt: params.newAwarenessAt,
        reason: params.reason.trim(),
        revisedByUserId: params.actorUserId,
        revisedByName: name,
      },
    }),
  ]);
  await bump(row.id, params.expectedVersion, { awarenessAt: params.newAwarenessAt });
  await recordEvent({
    action: "INCIDENT_AWARENESS_REVISED",
    targetType: "SecurityIncident",
    targetId: row.id,
    result: "SUCCESS",
    actorUserId: params.actorUserId,
    practiceId: params.practiceId,
    targetVersion: params.expectedVersion + 1,
    reason: params.reason,
    beforeMeta: { awarenessAt: row.awarenessAt.toISOString() },
    afterMeta: { awarenessAt: params.newAwarenessAt.toISOString() },
  });
}

export async function updateRootCause(params: {
  actorUserId: string;
  practiceId: string;
  incidentId: string;
  expectedVersion: number;
  rootCause: "UNKNOWN" | "INVESTIGATING" | "IDENTIFIED";
  note?: string | null;
}) {
  await assertCan(params.actorUserId, params.practiceId, "incident.manage");
  const row = await loadForUpdate(params.practiceId, params.incidentId, params.expectedVersion);
  if (params.rootCause === "IDENTIFIED" && !params.note?.trim()) {
    throw new PrivacyError("Describe the root cause that was identified", "NOTE_REQUIRED");
  }
  await bump(row.id, params.expectedVersion, {
    rootCause: params.rootCause,
    rootCauseNote: params.note?.trim() || null,
  });
  await recordEvent({
    action: "INCIDENT_ROOT_CAUSE_UPDATED",
    targetType: "SecurityIncident",
    targetId: row.id,
    result: "SUCCESS",
    actorUserId: params.actorUserId,
    practiceId: params.practiceId,
    targetVersion: params.expectedVersion + 1,
    afterMeta: { rootCause: params.rootCause },
  });
}

export async function getIncident(actorUserId: string, practiceId: string, incidentId: string, now?: Date) {
  await assertCan(actorUserId, practiceId, "incident.manage");
  const row = await prisma.securityIncident.findFirst({
    where: { id: incidentId, practiceId },
    include: {
      reports: { orderBy: { reportedAt: "asc" } },
      awarenessRevisions: { orderBy: { revisedAt: "asc" } },
    },
  });
  if (!row) throw new PrivacyError("Not found", "NOT_FOUND", 404);
  return { ...row, clocks: await incidentClocks(row, now ?? new Date()) };
}

export async function listIncidents(actorUserId: string, practiceId: string, now: Date = new Date()) {
  await assertCan(actorUserId, practiceId, "incident.manage");
  const rows = await prisma.securityIncident.findMany({
    where: { practiceId },
    orderBy: { awarenessAt: "desc" },
    include: { reports: true },
  });
  return Promise.all(rows.map(async (r) => ({ ...r, clocks: await incidentClocks(r, now) })));
}
