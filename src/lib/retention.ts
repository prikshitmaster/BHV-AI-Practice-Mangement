/**
 * Retention decisions — PRV06 (PRD §36).
 *
 * "Configure schedules by record class, governing rule, trigger and hold,
 *  covering originals, derivatives, email, AI and backups. Support applicable
 *  one year data / log retention under DPDP Rules 6 and 8 when operative,
 *  reconciled with longer duties. Neither CERT-In's 180 days nor inactivity /
 *  audit norms are universal purge timers."
 *
 * The decision is built from two different kinds of rule, which is the whole
 * point of the requirement:
 *
 *  - FLOORS (RETAIN_AT_LEAST). A statute says keep it this long. Reaching a
 *    floor makes deletion ALLOWED — it never makes deletion DUE. With several
 *    floors on one record class the LONGEST wins ("reconciled with longer
 *    duties").
 *  - CEILINGS (DELETE_AFTER). A rule says do not keep it longer than this. A
 *    ceiling tied to a regulatory requirement applies only while that
 *    requirement is OPERATIONAL (PRV02) — a prospective rule is readiness, not
 *    a purge timer. A ceiling shorter than a floor does not cut the floor
 *    short; the collision is reported as a conflict for a human.
 *
 * A live legal hold suspends everything: no purge date exists while one is in
 * force, whatever the schedule says.
 */

import type { RetentionCoverage, RetentionTrigger } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { recordEvent } from "@/lib/audit";
import { assertCan } from "@/lib/permissions";
import { PrivacyError, legalStandingAt } from "@/lib/privacy-register";

/** CERT-In directions: ICT logs kept for a rolling 180 days. A FLOOR only. */
export const CERT_IN_ICT_LOG_DAYS = 180;
export const ICT_LOG_CLASS = "ICT_LOG";

export type PolicyInput = {
  recordClass: string;
  direction: "RETAIN_AT_LEAST" | "DELETE_AFTER";
  trigger: RetentionTrigger;
  retainYears?: number;
  retainDays?: number | null;
  basis: string;
  covers: RetentionCoverage[];
  effectiveFrom: Date;
  regulatoryRequirementCode?: string | null;
};

export async function createRetentionPolicy(params: {
  actorUserId: string;
  practiceId: string;
  input: PolicyInput;
}) {
  await assertCan(params.actorUserId, params.practiceId, "privacy.manage");
  const i = params.input;
  if (!i.recordClass?.trim()) throw new PrivacyError("Record class is required", "FIELD_REQUIRED");
  if (!i.basis?.trim()) {
    throw new PrivacyError("Name the governing rule for this schedule", "FIELD_REQUIRED");
  }
  const years = i.retainYears ?? 0;
  const days = i.retainDays ?? null;
  if (years < 0 || (days !== null && days < 0)) {
    throw new PrivacyError("A retention period cannot be negative", "BAD_PERIOD");
  }
  if (years === 0 && (days === null || days === 0) && i.direction === "DELETE_AFTER") {
    throw new PrivacyError("A deletion ceiling needs a period", "BAD_PERIOD");
  }
  if (!i.covers.length) {
    throw new PrivacyError(
      "Say what the schedule covers — originals, derivatives, email, AI output, logs, backups",
      "FIELD_REQUIRED",
    );
  }
  // CERT-In's 180 days is a minimum for ICT logs. A ceiling below it would
  // make the system destroy logs the directions require.
  const periodDays = days ?? years * 365;
  if (i.recordClass === ICT_LOG_CLASS && i.direction === "DELETE_AFTER" && periodDays < CERT_IN_ICT_LOG_DAYS) {
    throw new PrivacyError(
      `ICT logs must be kept for at least ${CERT_IN_ICT_LOG_DAYS} days — a shorter deletion ceiling is refused`,
      "BELOW_ICT_LOG_FLOOR",
    );
  }

  let regulatoryRequirementId: string | null = null;
  if (i.regulatoryRequirementCode) {
    const req = await prisma.regulatoryRequirement.findFirst({
      where: { practiceId: params.practiceId, code: i.regulatoryRequirementCode },
      select: { id: true },
    });
    if (!req) {
      throw new PrivacyError(
        "That requirement is not in this practice's regulatory register",
        "REQUIREMENT_NOT_TRACKED",
      );
    }
    regulatoryRequirementId = req.id;
  }

  const row = await prisma.retentionPolicy.create({
    data: {
      practiceId: params.practiceId,
      recordClass: i.recordClass.trim(),
      direction: i.direction,
      trigger: i.trigger,
      retainYears: years,
      retainDays: days,
      basis: i.basis.trim(),
      covers: i.covers,
      effectiveFrom: i.effectiveFrom,
      regulatoryRequirementId,
      createdByUserId: params.actorUserId,
    },
  });
  await recordEvent({
    action: "RETENTION_POLICY_CREATED",
    targetType: "RetentionPolicy",
    targetId: row.id,
    result: "SUCCESS",
    actorUserId: params.actorUserId,
    practiceId: params.practiceId,
    afterMeta: { recordClass: row.recordClass, direction: row.direction, basis: row.basis },
  });
  return row;
}

function addPeriod(from: Date, years: number, days: number | null): Date {
  const out = new Date(from);
  if (days !== null && days !== undefined) {
    out.setUTCDate(out.getUTCDate() + days);
  } else {
    out.setUTCFullYear(out.getUTCFullYear() + years);
  }
  return out;
}

export type HoldRef = { id: string; reason: string; placedAt: Date };

/**
 * Live legal holds reaching a document — by the document itself, its
 * engagement or its client relationship. Evaluated from the LegalHold rows at
 * the moment of asking, NOT from `Document.legalHold`: that flag is set when a
 * hold is placed, so a document filed into a held engagement afterwards would
 * otherwise look unheld.
 */
export async function activeHoldsForDocument(practiceId: string, documentId: string): Promise<HoldRef[]> {
  const doc = await prisma.document.findFirst({
    where: { id: documentId, practiceId },
    select: { id: true, engagementId: true, clientRelationshipId: true },
  });
  if (!doc) return [];
  const scopes: Record<string, string>[] = [{ scopeDocumentId: doc.id }];
  if (doc.engagementId) scopes.push({ scopeEngagementId: doc.engagementId });
  if (doc.clientRelationshipId) scopes.push({ scopeClientRelationshipId: doc.clientRelationshipId });
  return prisma.legalHold.findMany({
    where: { practiceId, releasedAt: null, OR: scopes },
    select: { id: true, reason: true, placedAt: true },
  });
}

export async function activeHoldsForEngagement(practiceId: string, engagementId: string): Promise<HoldRef[]> {
  const eng = await prisma.engagement.findFirst({
    where: { id: engagementId, practiceId },
    select: { clientRelationshipId: true },
  });
  if (!eng) return [];
  return prisma.legalHold.findMany({
    where: {
      practiceId,
      releasedAt: null,
      scopeDocumentId: null,
      OR: [{ scopeEngagementId: engagementId }, { scopeClientRelationshipId: eng.clientRelationshipId }],
    },
    select: { id: true, reason: true, placedAt: true },
  });
}

export type RetentionDecision = {
  recordClass: string;
  triggerDate: Date;
  /** The longest applicable floor. Before this, deletion is not allowed. */
  retainUntil: Date | null;
  floors: { policyId: string; basis: string; until: Date }[];
  /** Operative ceilings. Deletion becomes DUE only from these, never from a floor. */
  ceilings: { policyId: string; basis: string; deleteAfter: Date }[];
  /** Rules in the schedule that do not bind at `at`, and why. */
  rulesNotApplied: { policyId: string; basis: string; why: string }[];
  /** A ceiling that falls before a longer floor — the floor wins, a human must look. */
  conflicts: string[];
  holds: HoldRef[];
  /** When deletion becomes due. Null when nothing makes it due — a floor alone never does. */
  purgeDueAt: Date | null;
  /** Whether deletion is permitted at `at` (floor passed, no hold). */
  deletionAllowed: boolean;
  explanation: string;
};

/**
 * PRV06's decision for one record of a class, triggered at `triggerDate`, as
 * judged at `at`. Pure over what the database holds — no side effects.
 */
export async function retentionDecision(params: {
  practiceId: string;
  recordClass: string;
  triggerDate: Date;
  holds?: HoldRef[];
  at?: Date;
}): Promise<RetentionDecision> {
  const at = params.at ?? new Date();
  const holds = params.holds ?? [];
  const policies = await prisma.retentionPolicy.findMany({
    where: {
      practiceId: params.practiceId,
      recordClass: params.recordClass,
      effectiveFrom: { lte: at },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
    },
    orderBy: { effectiveFrom: "asc" },
  });

  const floors: RetentionDecision["floors"] = [];
  const ceilings: RetentionDecision["ceilings"] = [];
  const rulesNotApplied: RetentionDecision["rulesNotApplied"] = [];

  for (const p of policies) {
    let operative = true;
    let why = "";
    if (p.regulatoryRequirementId) {
      const req = await prisma.regulatoryRequirement.findFirst({
        where: { id: p.regulatoryRequirementId, practiceId: params.practiceId },
        select: { code: true },
      });
      const standing = req ? await legalStandingAt(params.practiceId, req.code, at) : null;
      operative = !!standing && standing.tracked && standing.operative;
      if (!operative) {
        why = !standing || !standing.tracked
          ? "its governing requirement is not tracked in the regulatory register"
          : `its governing requirement ${standing.code} is ${standing.state}, not operative`;
      }
    }
    const until = addPeriod(params.triggerDate, p.retainYears, p.retainDays);
    if (p.direction === "RETAIN_AT_LEAST") {
      // A floor whose requirement is not yet operative is still the
      // conservative choice to keep — but it is not a legal duty yet, so it
      // is reported as such rather than silently counted.
      if (operative) floors.push({ policyId: p.id, basis: p.basis, until });
      else rulesNotApplied.push({ policyId: p.id, basis: p.basis, why: `floor not binding: ${why}` });
    } else if (operative) {
      ceilings.push({ policyId: p.id, basis: p.basis, deleteAfter: until });
    } else {
      rulesNotApplied.push({ policyId: p.id, basis: p.basis, why });
    }
  }

  const retainUntil = floors.length
    ? new Date(Math.max(...floors.map((f) => f.until.getTime())))
    : null;

  const conflicts: string[] = [];
  let purgeDueAt: Date | null = null;
  if (ceilings.length) {
    const earliestCeiling = new Date(Math.min(...ceilings.map((c) => c.deleteAfter.getTime())));
    if (retainUntil && earliestCeiling < retainUntil) {
      const c = ceilings.find((x) => x.deleteAfter.getTime() === earliestCeiling.getTime())!;
      conflicts.push(
        `"${c.basis}" would delete on ${iso(earliestCeiling)}, before the longer duty to keep until ${iso(retainUntil)} — the longer duty wins; review the schedule`,
      );
      purgeDueAt = retainUntil;
    } else {
      purgeDueAt = earliestCeiling;
    }
  }
  if (holds.length) purgeDueAt = null;

  const floorPassed = retainUntil ? retainUntil <= at : policies.length > 0;
  const deletionAllowed = holds.length === 0 && floorPassed && (floors.length > 0 || ceilings.length > 0);

  let explanation: string;
  if (!policies.length) {
    explanation = `No retention schedule is in force for ${params.recordClass}; nothing may be deleted until one is.`;
  } else if (holds.length) {
    explanation = `Under legal hold (${holds.map((h) => h.reason).join("; ")}) — no deletion while the hold stands.`;
  } else if (retainUntil && retainUntil > at) {
    explanation = `Must be kept until ${iso(retainUntil)} (${floors.map((f) => f.basis).join("; ")}).`;
  } else if (purgeDueAt) {
    explanation = `Deletion is due from ${iso(purgeDueAt)}.`;
  } else {
    explanation = "The retention floor has passed. Deletion is allowed but not due — a floor is not a purge timer.";
  }

  return {
    recordClass: params.recordClass,
    triggerDate: params.triggerDate,
    retainUntil,
    floors,
    ceilings,
    rulesNotApplied,
    conflicts,
    holds,
    purgeDueAt,
    deletionAllowed,
    explanation,
  };
}

function iso(d: Date) {
  return d.toISOString().slice(0, 10);
}

/**
 * CERT-In posture for ICT logs: is a floor of at least 180 days configured,
 * how far back the audit log actually reaches, and whether the hosting
 * location is confirmed as Indian jurisdiction. The audit trail is append-only
 * (SEC04), so it is never purged by this system at all — what this reports is
 * whether the SCHEDULE says so, and whether anything is left unconfirmed.
 */
export async function ictLogPosture(practiceId: string, at: Date = new Date()) {
  const decision = await retentionDecision({ practiceId, recordClass: ICT_LOG_CLASS, triggerDate: at, at });
  const floorDays = decision.retainUntil
    ? Math.round((decision.retainUntil.getTime() - at.getTime()) / 86_400_000)
    : 0;
  const oldest = await prisma.event.findFirst({
    where: { practiceId },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true },
  });
  const registerEntry = await prisma.processingActivity.findFirst({
    where: { practiceId, retentionClass: ICT_LOG_CLASS, status: { not: "RETIRED" } },
    select: { hostingLocation: true },
  });
  const hosting = registerEntry?.hostingLocation ?? null;
  return {
    floorDays,
    meetsCertInMinimum: floorDays >= CERT_IN_ICT_LOG_DAYS,
    oldestLogAt: oldest?.createdAt ?? null,
    auditTrailIsAppendOnly: true,
    hostingLocation: hosting,
    hostingConfirmedIndia: !!hosting && /\bindia\b/i.test(hosting) && !/unconfirmed/i.test(hosting),
  };
}
