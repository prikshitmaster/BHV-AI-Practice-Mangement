/**
 * Processing register and regulatory state — PRV01, PRV02 (PRD §36).
 *
 * PRV01: "Identify the responsible practice, processing purpose, data
 *  categories, source, access roles, recipients, vendor, hosting location,
 *  retention class and applicable legal basis / authority. Record notices and
 *  consent where required; do not treat consent as the only possible basis
 *  for every professional record."
 *
 * PRV02: "Track Enacted, Notified, Operational, Prospective and Superseded
 *  requirements with sources and effective rules. DPDP commencement is phased;
 *  core duties must not all be described as operational on this research
 *  date. Build readiness without mislabelling legal status."
 *
 * Two rules carry most of the weight here:
 *
 *  1. A legal basis always names its authority, and CONSENT is the one basis
 *     that additionally needs a notice and a consent record. Nothing defaults
 *     to consent: a statutory working paper recorded as consent-based would
 *     imply a withdrawal could erase it.
 *
 *  2. OPERATIONAL is a claim about the law, so it needs a source AND an
 *     effective date that has actually arrived. Every change of state is
 *     appended to a history, never rewritten, so a decision taken under last
 *     year's state can be read against what the register said THEN
 *     (`stateAt`). Nothing in this module asserts what any real law's state
 *     is — the register's content is the practice's to verify and enter.
 */

import type { LegalBasis, PracticeRole, RegulatoryState } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { recordEvent } from "@/lib/audit";
import { assertCan } from "@/lib/permissions";
import { versionConflict } from "@/lib/concurrency";

export class PrivacyError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "PrivacyError";
  }
}

async function actorName(userId: string): Promise<string> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { fullName: true } });
  return u?.fullName ?? "(unknown)";
}

/** API02: the losing writer gets the standard comparison, with the version now held. */
async function conflictOn(
  subjectType: "ProcessingActivity" | "RegulatoryRequirement",
  subjectId: string,
  expectedVersion: number,
) {
  const row =
    subjectType === "ProcessingActivity"
      ? await prisma.processingActivity.findUnique({ where: { id: subjectId }, select: { version: true } })
      : await prisma.regulatoryRequirement.findUnique({ where: { id: subjectId }, select: { version: true } });
  return versionConflict({ subjectType, subjectId, expectedVersion, currentVersion: row?.version ?? -1 });
}

function required(value: string | null | undefined, field: string): string {
  const v = value?.trim();
  if (!v) throw new PrivacyError(`${field} is required`, "FIELD_REQUIRED");
  return v;
}

// ------------------------------------------------------------ PRV01 register

export type ProcessingActivityInput = {
  name: string;
  purpose: string;
  dataCategories: string[];
  source: string;
  accessRoles: PracticeRole[];
  recipients: string[];
  vendor?: string | null;
  hostingLocation: string;
  retentionClass: string;
  legalBasis: LegalBasis;
  legalAuthority: string;
  noticeReference?: string | null;
  consentRecordReference?: string | null;
  ownerName: string;
};

function validateActivity(input: ProcessingActivityInput) {
  required(input.name, "Name");
  required(input.purpose, "Purpose");
  required(input.source, "Source");
  required(input.hostingLocation, "Hosting location");
  required(input.retentionClass, "Retention class");
  required(input.ownerName, "Owner");
  if (!input.dataCategories.length || input.dataCategories.some((c) => !c.trim())) {
    throw new PrivacyError("Name at least one data category", "FIELD_REQUIRED");
  }
  if (!input.accessRoles.length) {
    throw new PrivacyError("Name the roles that may access this data", "FIELD_REQUIRED");
  }
  // Every basis names the statute, clause or engagement term behind it.
  required(input.legalAuthority, "Legal authority for the basis");
  if (input.legalBasis === "CONSENT") {
    if (!input.noticeReference?.trim()) {
      throw new PrivacyError(
        "Consent-based processing needs the notice the person was given",
        "CONSENT_NEEDS_NOTICE",
      );
    }
    if (!input.consentRecordReference?.trim()) {
      throw new PrivacyError(
        "Consent-based processing needs a reference to the consent record",
        "CONSENT_NEEDS_RECORD",
      );
    }
  }
}

export async function createProcessingActivity(params: {
  actorUserId: string;
  practiceId: string;
  input: ProcessingActivityInput;
}) {
  await assertCan(params.actorUserId, params.practiceId, "privacy.manage");
  validateActivity(params.input);
  const i = params.input;

  const row = await prisma.processingActivity.create({
    data: {
      practiceId: params.practiceId,
      name: i.name.trim(),
      purpose: i.purpose.trim(),
      dataCategories: i.dataCategories.map((c) => c.trim()),
      source: i.source.trim(),
      accessRoles: i.accessRoles,
      recipients: i.recipients.map((r) => r.trim()).filter(Boolean),
      vendor: i.vendor?.trim() || null,
      hostingLocation: i.hostingLocation.trim(),
      retentionClass: i.retentionClass.trim(),
      legalBasis: i.legalBasis,
      legalAuthority: i.legalAuthority.trim(),
      noticeReference: i.noticeReference?.trim() || null,
      consentRecordReference: i.consentRecordReference?.trim() || null,
      ownerName: i.ownerName.trim(),
      createdByUserId: params.actorUserId,
    },
  });

  await recordEvent({
    action: "PROCESSING_ACTIVITY_CREATED",
    targetType: "ProcessingActivity",
    targetId: row.id,
    result: "SUCCESS",
    actorUserId: params.actorUserId,
    practiceId: params.practiceId,
    targetVersion: row.version,
    afterMeta: { name: row.name, legalBasis: row.legalBasis },
  });
  return row;
}

/** Activate / retire / amend, version-checked (API02). */
export async function updateProcessingActivity(params: {
  actorUserId: string;
  practiceId: string;
  activityId: string;
  expectedVersion: number;
  input?: ProcessingActivityInput;
  status?: "ACTIVE" | "RETIRED";
}) {
  await assertCan(params.actorUserId, params.practiceId, "privacy.manage");
  const current = await prisma.processingActivity.findFirst({
    where: { id: params.activityId, practiceId: params.practiceId },
  });
  if (!current) throw new PrivacyError("Not found", "NOT_FOUND", 404);
  if (params.input) validateActivity(params.input);

  const i = params.input;
  const updated = await prisma.processingActivity.updateMany({
    where: { id: current.id, practiceId: params.practiceId, version: params.expectedVersion },
    data: {
      ...(i
        ? {
            name: i.name.trim(),
            purpose: i.purpose.trim(),
            dataCategories: i.dataCategories.map((c) => c.trim()),
            source: i.source.trim(),
            accessRoles: i.accessRoles,
            recipients: i.recipients.map((r) => r.trim()).filter(Boolean),
            vendor: i.vendor?.trim() || null,
            hostingLocation: i.hostingLocation.trim(),
            retentionClass: i.retentionClass.trim(),
            legalBasis: i.legalBasis,
            legalAuthority: i.legalAuthority.trim(),
            noticeReference: i.noticeReference?.trim() || null,
            consentRecordReference: i.consentRecordReference?.trim() || null,
            ownerName: i.ownerName.trim(),
          }
        : {}),
      ...(params.status ? { status: params.status } : {}),
      version: { increment: 1 },
    },
  });
  if (updated.count === 0) {
    throw await conflictOn("ProcessingActivity", current.id, params.expectedVersion);
  }

  await recordEvent({
    action: "PROCESSING_ACTIVITY_UPDATED",
    targetType: "ProcessingActivity",
    targetId: current.id,
    result: "SUCCESS",
    actorUserId: params.actorUserId,
    practiceId: params.practiceId,
    targetVersion: params.expectedVersion + 1,
    afterMeta: { status: params.status ?? current.status },
  });
  return prisma.processingActivity.findUniqueOrThrow({ where: { id: current.id } });
}

export async function listProcessingActivities(actorUserId: string, practiceId: string) {
  await assertCan(actorUserId, practiceId, "privacy.manage");
  return prisma.processingActivity.findMany({
    where: { practiceId },
    orderBy: [{ status: "asc" }, { name: "asc" }],
  });
}

// ---------------------------------------------------------- PRV02 regulatory

export type RegulatoryInput = {
  code: string;
  title: string;
  instrument: string;
  state: RegulatoryState;
  sourceReference: string;
  sourceDate: Date;
  effectiveFrom?: Date | null;
  effectiveRule: string;
  supersededByCode?: string | null;
};

/**
 * The one place a state claim is checked. OPERATIONAL needs a known effective
 * date that has arrived; PROSPECTIVE needs a date still ahead (otherwise it is
 * mislabelled one way or the other); SUPERSEDED names what replaced it.
 */
function assertStateIsHonest(input: {
  state: RegulatoryState;
  effectiveFrom?: Date | null;
  supersededByCode?: string | null;
  sourceReference: string;
}, now: Date) {
  required(input.sourceReference, "Source reference");
  if (input.state === "OPERATIONAL") {
    if (!input.effectiveFrom) {
      throw new PrivacyError(
        "A requirement cannot be marked Operational without the date it took effect",
        "OPERATIONAL_NEEDS_DATE",
      );
    }
    if (input.effectiveFrom > now) {
      throw new PrivacyError(
        "Its effective date has not arrived — record it as Prospective until then",
        "NOT_YET_OPERATIONAL",
      );
    }
  }
  if (input.state === "PROSPECTIVE" && input.effectiveFrom && input.effectiveFrom <= now) {
    throw new PrivacyError(
      "Its effective date has passed — confirm whether it is now Operational",
      "PROSPECTIVE_DATE_PASSED",
    );
  }
  if (input.state === "SUPERSEDED" && !input.supersededByCode?.trim()) {
    throw new PrivacyError("Name the requirement that superseded it", "SUPERSEDED_NEEDS_SUCCESSOR");
  }
}

export async function recordRegulatoryRequirement(params: {
  actorUserId: string;
  practiceId: string;
  input: RegulatoryInput;
  reason: string;
  now?: Date;
}) {
  await assertCan(params.actorUserId, params.practiceId, "privacy.manage");
  const now = params.now ?? new Date();
  const i = params.input;
  required(i.code, "Code");
  required(i.title, "Title");
  required(i.instrument, "Instrument");
  required(i.effectiveRule, "Effective rule");
  required(params.reason, "Reason");
  assertStateIsHonest(i, now);

  const name = await actorName(params.actorUserId);
  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.regulatoryRequirement.create({
      data: {
        practiceId: params.practiceId,
        code: i.code.trim(),
        title: i.title.trim(),
        instrument: i.instrument.trim(),
        state: i.state,
        sourceReference: i.sourceReference.trim(),
        sourceDate: i.sourceDate,
        effectiveFrom: i.effectiveFrom ?? null,
        effectiveRule: i.effectiveRule.trim(),
        supersededByCode: i.supersededByCode?.trim() || null,
      },
    });
    await tx.regulatoryStateChange.create({
      data: {
        practiceId: params.practiceId,
        requirementId: created.id,
        fromState: null,
        toState: i.state,
        sourceReference: created.sourceReference,
        sourceDate: i.sourceDate,
        effectiveFrom: i.effectiveFrom ?? null,
        reason: params.reason.trim(),
        changedByUserId: params.actorUserId,
        changedByName: name,
        changedAt: now,
      },
    });
    return created;
  });

  await recordEvent({
    action: "REGULATORY_REQUIREMENT_RECORDED",
    targetType: "RegulatoryRequirement",
    targetId: row.id,
    result: "SUCCESS",
    actorUserId: params.actorUserId,
    practiceId: params.practiceId,
    targetVersion: row.version,
    reason: params.reason,
    afterMeta: { code: row.code, state: row.state },
  });
  return row;
}

/** Move a requirement to a new legal state. Appends history; never edits it. */
export async function changeRegulatoryState(params: {
  actorUserId: string;
  practiceId: string;
  requirementId: string;
  expectedVersion: number;
  toState: RegulatoryState;
  sourceReference: string;
  sourceDate: Date;
  effectiveFrom?: Date | null;
  supersededByCode?: string | null;
  reason: string;
  now?: Date;
}) {
  await assertCan(params.actorUserId, params.practiceId, "privacy.manage");
  const now = params.now ?? new Date();
  required(params.reason, "Reason");

  const current = await prisma.regulatoryRequirement.findFirst({
    where: { id: params.requirementId, practiceId: params.practiceId },
  });
  if (!current) throw new PrivacyError("Not found", "NOT_FOUND", 404);
  if (current.state === "SUPERSEDED") {
    throw new PrivacyError(
      "A superseded requirement is history — record its successor instead",
      "ALREADY_SUPERSEDED",
    );
  }

  const effectiveFrom =
    params.effectiveFrom === undefined ? current.effectiveFrom : params.effectiveFrom;
  assertStateIsHonest(
    {
      state: params.toState,
      effectiveFrom,
      supersededByCode: params.supersededByCode,
      sourceReference: params.sourceReference,
    },
    now,
  );

  const name = await actorName(params.actorUserId);
  await prisma.$transaction(async (tx) => {
    const updated = await tx.regulatoryRequirement.updateMany({
      where: { id: current.id, practiceId: params.practiceId, version: params.expectedVersion },
      data: {
        state: params.toState,
        sourceReference: params.sourceReference.trim(),
        sourceDate: params.sourceDate,
        effectiveFrom,
        supersededByCode: params.supersededByCode?.trim() || current.supersededByCode,
        version: { increment: 1 },
      },
    });
    if (updated.count === 0) {
      throw await conflictOn("RegulatoryRequirement", current.id, params.expectedVersion);
    }
    await tx.regulatoryStateChange.create({
      data: {
        practiceId: params.practiceId,
        requirementId: current.id,
        fromState: current.state,
        toState: params.toState,
        sourceReference: params.sourceReference.trim(),
        sourceDate: params.sourceDate,
        effectiveFrom,
        reason: params.reason.trim(),
        changedByUserId: params.actorUserId,
        changedByName: name,
        changedAt: now,
      },
    });
  });

  await recordEvent({
    action: "REGULATORY_STATE_CHANGED",
    targetType: "RegulatoryRequirement",
    targetId: current.id,
    result: "SUCCESS",
    actorUserId: params.actorUserId,
    practiceId: params.practiceId,
    targetVersion: params.expectedVersion + 1,
    reason: params.reason,
    beforeMeta: { state: current.state },
    afterMeta: { state: params.toState },
  });
  return prisma.regulatoryRequirement.findUniqueOrThrow({ where: { id: current.id } });
}

export type RegulatoryStanding =
  | { tracked: false; code: string }
  | {
      tracked: true;
      code: string;
      requirementId: string;
      state: RegulatoryState;
      effectiveFrom: Date | null;
      operative: boolean;
      sourceReference: string;
    };

/**
 * The state the register recorded for `code` as at `at`, read from the
 * append-only history rather than the current row — so an incident assessed
 * in the past is judged by what the register said then.
 *
 * "Operative" means OPERATIONAL with an effective date on or before `at`. A
 * requirement that is not in the register at all is reported as NOT TRACKED,
 * which callers must show as unknown — never as "not applicable".
 */
export async function stateAt(
  practiceId: string,
  code: string,
  at: Date = new Date(),
): Promise<RegulatoryStanding> {
  const req = await prisma.regulatoryRequirement.findFirst({
    where: { practiceId, code },
    select: { id: true },
  });
  if (!req) return { tracked: false, code };

  const change = await prisma.regulatoryStateChange.findFirst({
    where: { requirementId: req.id, practiceId, changedAt: { lte: at } },
    orderBy: { changedAt: "desc" },
  });
  if (!change) return { tracked: false, code };

  const operative =
    change.toState === "OPERATIONAL" && !!change.effectiveFrom && change.effectiveFrom <= at;
  return {
    tracked: true,
    code,
    requirementId: req.id,
    state: change.toState,
    effectiveFrom: change.effectiveFrom,
    operative,
    sourceReference: change.sourceReference,
  };
}

/**
 * The law's standing at `at` on what the register knows NOW — the question a
 * deadline asks. `stateAt` answers a different one ("what did the register say
 * then?"). They differ when the register is updated after the fact: if the
 * practice learns today that a duty was already operative last week, an
 * incident from last week must show that clock as overdue, not as never
 * having run.
 */
export async function legalStandingAt(
  practiceId: string,
  code: string,
  at: Date = new Date(),
): Promise<RegulatoryStanding> {
  const req = await prisma.regulatoryRequirement.findFirst({ where: { practiceId, code } });
  if (!req) return { tracked: false, code };
  return {
    tracked: true,
    code,
    requirementId: req.id,
    state: req.state,
    effectiveFrom: req.effectiveFrom,
    operative: req.state === "OPERATIONAL" && !!req.effectiveFrom && req.effectiveFrom <= at,
    sourceReference: req.sourceReference,
  };
}

export async function isOperational(practiceId: string, code: string, at: Date = new Date()) {
  const standing = await legalStandingAt(practiceId, code, at);
  return standing.tracked && standing.operative;
}

export async function listRegulatoryRequirements(actorUserId: string, practiceId: string) {
  await assertCan(actorUserId, practiceId, "privacy.manage");
  return prisma.regulatoryRequirement.findMany({
    where: { practiceId },
    orderBy: { code: "asc" },
    include: { stateChanges: { orderBy: { changedAt: "asc" } } },
  });
}
