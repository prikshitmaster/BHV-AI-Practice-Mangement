/**
 * Recovery exercises — BCP06 (PRD §37).
 *
 * "Run a restore drill before production and periodically thereafter,
 *  proposed quarterly. Record achieved times, missing items, exceptions and
 *  remediation owner. Test loss of the primary server, unavailable key service
 *  and departure of the only administrator."
 *
 * A drill here is something the system DOES, not a form someone fills in. Each
 * scenario runs real checks and writes what it found into `missingItems` and
 * `exceptions` itself; a person adds the remediation owner, a due date and
 * notes, but cannot remove a finding. So a drill cannot pass by being written
 * up well.
 *
 * Where a scenario depends on something outside the system — a key held in
 * escrow, a named custodian — the drill takes the fact as an ATTESTATION and
 * says so in the evidence, rather than claiming to have verified it. The key
 * attestation is still checked: an escrowed key is accepted only if its
 * fingerprint matches the key the backups were actually written under.
 *
 *   PRIMARY_SERVER_LOSS / SCHEDULED_QUARTERLY
 *     Restores from the OFFSITE copy into an isolated database, with every
 *     artifact in that copy first decrypted and hash-checked. Achieved RPO/RTO
 *     come from that restore; failed reconciliation checks become missing items.
 *   KEY_SERVICE_UNAVAILABLE
 *     Proves the held backup key opens the newest backup, that a wrong key is
 *     REFUSED rather than partially decrypted, that the app key the archived
 *     secrets are wrapped in is still the one in use, and that an escrowed copy
 *     of the backup key exists and matches.
 *   SOLE_ADMINISTRATOR_DEPARTED
 *     Takes one administrator out of the picture and asks who is left: another
 *     system administrator, someone who can re-grant access, a key custodian
 *     who is not them, and whose DSC tokens would walk out with them.
 */

import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import type { DrillScenario } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { recordEvent } from "@/lib/audit";
import {
  artifactPath,
  backupEncryptionKey,
  decryptArtifact,
  keyFingerprint,
  readArtifact,
} from "@/lib/backup";
import { runRestore, type RestoreOptions } from "@/lib/restore";
import { sha256Hex } from "@/lib/object-store";
import { can, resolveMembership } from "@/lib/permissions";
import { assertSystemAdministrator, ContinuityError } from "@/lib/continuity";
import { versionConflict } from "@/lib/concurrency";

/** BCP06 "proposed quarterly". */
export const DRILL_INTERVAL_MONTHS = 3;

/** The three failures BCP06 names. A scheduled drill does not stand in for any of them. */
export const REQUIRED_SCENARIOS: DrillScenario[] = [
  "PRIMARY_SERVER_LOSS",
  "KEY_SERVICE_UNAVAILABLE",
  "SOLE_ADMINISTRATOR_DEPARTED",
];

export type DrillParams = {
  scenario: DrillScenario;
  performedByUserId: string;
  remediationOwnerName: string;
  remediationOwnerUserId?: string | null;
  remediationDueAt?: Date | null;
  notes?: string | null;
  /** Which backup to drill against. Defaults to the newest completed one. */
  backupRunId?: string;
  /** Passed through to the restore for the two restore scenarios. */
  restore?: Pick<RestoreOptions, "targetDatabaseUrl" | "objectHashSampleSize" | "sampleSeed" | "skipMigrate">;
  /** KEY_SERVICE_UNAVAILABLE: who retrieved the escrowed backup key, and its fingerprint. */
  escrow?: { retrievedByName: string; keyFingerprint: string } | null;
  /** KEY_SERVICE_UNAVAILABLE / SOLE_ADMINISTRATOR_DEPARTED: named holders of escrowed key material. */
  keyCustodianNames?: string[];
  /** SOLE_ADMINISTRATOR_DEPARTED: whose departure to rehearse. Defaults to the only administrator, if there is one. */
  departingUserId?: string;
  at?: Date;
};

export type DrillOutcome = {
  drillId: string;
  scenario: DrillScenario;
  missingItems: string[];
  exceptions: string[];
  /** What was actually checked, including which facts were attested rather than verified. */
  evidence: string[];
  achievedRpoSeconds: number | null;
  achievedRtoSeconds: number | null;
  restoreRunId: string | null;
  /** True only when there were no missing items and no exceptions. */
  clean: boolean;
  nextDueAt: Date;
  version: number;
};

type Findings = {
  missingItems: string[];
  exceptions: string[];
  evidence: string[];
  achievedRpoSeconds: number | null;
  achievedRtoSeconds: number | null;
  restoreRunId: string | null;
};

function emptyFindings(): Findings {
  return {
    missingItems: [],
    exceptions: [],
    evidence: [],
    achievedRpoSeconds: null,
    achievedRtoSeconds: null,
    restoreRunId: null,
  };
}

export function nextDrillDue(from: Date): Date {
  const d = new Date(from);
  d.setUTCMonth(d.getUTCMonth() + DRILL_INTERVAL_MONTHS);
  return d;
}

async function pickBackup(backupRunId: string | undefined) {
  return backupRunId
    ? prisma.backupRun.findFirst({ where: { id: backupRunId, status: "COMPLETED" } })
    : prisma.backupRun.findFirst({ where: { status: "COMPLETED" }, orderBy: { dataAsOf: "desc" } });
}

// ---------------------------------------------------------------- scenarios

async function drillPrimaryServerLoss(p: DrillParams, f: Findings): Promise<void> {
  const backup = await pickBackup(p.backupRunId);
  if (!backup) {
    f.missingItems.push("No completed backup exists to recover from.");
    return;
  }
  f.evidence.push(`Backup ${backup.id}, data as of ${backup.dataAsOf.toISOString()}.`);

  if (!backup.offsiteLocation) {
    f.missingItems.push(
      "The backup has no copy in a separate failure domain — losing the primary server loses the backup with it.",
    );
    return;
  }

  // Every artifact in the offsite copy, not a sample: this is the copy the
  // firm would be relying on, and one unreadable file is enough to fail.
  const artifacts = await prisma.backupArtifact.findMany({
    where: { backupRunId: backup.id },
    include: { backupRun: { select: { primaryLocation: true, offsiteLocation: true } } },
  });
  const unreadable: string[] = [];
  for (const a of artifacts) {
    try {
      const body = decryptArtifact(await fs.readFile(artifactPath(a, "offsite")));
      if (sha256Hex(body) !== a.sha256) unreadable.push(`${a.name}: hash mismatch`);
    } catch (e) {
      unreadable.push(`${a.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (unreadable.length > 0) {
    f.missingItems.push(
      `${unreadable.length} of ${artifacts.length} offsite artifacts unreadable: ${unreadable.slice(0, 5).join("; ")}`,
    );
    return;
  }
  f.evidence.push(`All ${artifacts.length} offsite artifacts decrypted and matched their recorded hashes.`);

  let result;
  try {
    result = await runRestore({
      backupRunId: backup.id,
      source: "offsite",
      targetLabel: `drill-${p.scenario.toLowerCase()}`,
      performedByUserId: p.performedByUserId,
      ...p.restore,
    });
  } catch (e) {
    // A drill that cannot restore is a finding, not a crash — it is exactly
    // what the drill exists to find out.
    f.exceptions.push(`Restore from the offsite copy could not run: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }

  f.restoreRunId = result.restoreRunId;
  f.achievedRpoSeconds = result.measuredRpoSeconds;
  f.achievedRtoSeconds = result.measuredRtoSeconds;
  f.evidence.push(
    `Restored ${result.rowsRestored} rows across ${result.tablesRestored} tables from the offsite copy; ` +
      `${result.checks.filter((c) => c.passed).length}/${result.checks.length} reconciliation checks passed.`,
  );

  for (const c of result.checks.filter((c) => !c.passed)) {
    f.missingItems.push(`Reconciliation failed — ${c.subject}: expected ${c.expected}, got ${c.actual}.`);
  }
  if (result.measuredRpoSeconds > result.rpoTargetSeconds) {
    f.exceptions.push(
      `Achieved RPO ${result.measuredRpoSeconds}s exceeds the ${result.rpoTargetSeconds}s target.`,
    );
  }
  if (result.measuredRtoSeconds > result.rtoTargetSeconds) {
    f.exceptions.push(
      `Achieved RTO ${result.measuredRtoSeconds}s exceeds the ${result.rtoTargetSeconds}s target.`,
    );
  }
}

async function drillKeyServiceUnavailable(p: DrillParams, f: Findings): Promise<void> {
  let heldFingerprint: string | null = null;
  try {
    heldFingerprint = keyFingerprint(backupEncryptionKey());
    f.evidence.push(`Backup key held by this deployment: fingerprint ${heldFingerprint}.`);
  } catch (e) {
    f.missingItems.push(`No usable backup key is held: ${e instanceof Error ? e.message : String(e)}`);
  }

  const backup = await pickBackup(p.backupRunId);
  if (!backup) {
    f.missingItems.push("No completed backup exists to test the key against.");
    return;
  }

  // Every completed backup written under a key that is not held is unreadable
  // unless that key comes back from escrow.
  if (heldFingerprint) {
    const orphaned = await prisma.backupRun.count({
      where: { status: "COMPLETED", encryptionKeyId: { not: heldFingerprint } },
    });
    if (orphaned > 0) {
      f.exceptions.push(
        `${orphaned} completed backup(s) were written under a key other than the one held now — unreadable unless that key is recovered from escrow.`,
      );
    }
  }

  // The held key must actually open the newest backup — a fingerprint match is
  // a claim; a verified decrypt is evidence.
  let inventory: { keys?: { name: string; fingerprint: string | null }[] } | null = null;
  try {
    const art = await readArtifact(backup.id, "KEY_INVENTORY", "key-inventory.json");
    inventory = JSON.parse(art.body.toString("utf8"));
    f.evidence.push(`Held key decrypted and hash-verified the key inventory of backup ${backup.id}.`);
  } catch (e) {
    f.missingItems.push(
      `The held backup key does not open the newest backup: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  // A wrong key must be REFUSED. AES-GCM authenticates, so this should throw;
  // if it ever returned bytes, a corrupted archive could pass as a good one.
  try {
    await readArtifact(backup.id, "KEY_INVENTORY", "key-inventory.json", "primary", randomBytes(32));
    f.exceptions.push("An artifact decrypted under a WRONG key without error — integrity is not being enforced.");
  } catch {
    f.evidence.push("A wrong key was refused outright (no partial decrypt).");
  }

  // Secrets restored from the archive (MFA seeds) are wrapped in the app key.
  // If that key has since changed, a restore brings back seeds nobody can open.
  const archivedAppKey = inventory?.keys?.find((k) => k.name === "APP_ENCRYPTION_KEY")?.fingerprint ?? null;
  const currentAppKey = process.env.APP_ENCRYPTION_KEY
    ? keyFingerprint(Buffer.from(process.env.APP_ENCRYPTION_KEY, "base64"))
    : null;
  if (inventory) {
    if (!currentAppKey) {
      f.missingItems.push("APP_ENCRYPTION_KEY is not held — restored MFA seeds could not be decrypted.");
    } else if (archivedAppKey !== currentAppKey) {
      f.missingItems.push(
        "The APP_ENCRYPTION_KEY in use differs from the one the newest backup's secrets are wrapped in — restored MFA seeds would be unreadable.",
      );
    } else {
      f.evidence.push("APP_ENCRYPTION_KEY in use matches the key the archived secrets are wrapped in.");
    }
  }

  // Escrow: the one fact the system cannot see for itself.
  if (!p.escrow) {
    f.missingItems.push(
      "Retrieval of the escrowed backup key was not demonstrated — if the key service is lost, nothing here shows the key can be recovered.",
    );
  } else if (!heldFingerprint || p.escrow.keyFingerprint.trim().toLowerCase() !== heldFingerprint) {
    f.missingItems.push(
      `The escrowed key retrieved by ${p.escrow.retrievedByName} does not match the key the backups use.`,
    );
  } else {
    f.evidence.push(
      `ATTESTED: escrowed backup key retrieved by ${p.escrow.retrievedByName}; its fingerprint matches the key the backups use.`,
    );
  }

  if (!p.keyCustodianNames || p.keyCustodianNames.filter((n) => n.trim()).length < 2) {
    f.exceptions.push("Fewer than two named key custodians — escrowed key material has a single point of failure.");
  }
}

async function drillSoleAdministratorDeparted(p: DrillParams, f: Findings): Promise<void> {
  const now = p.at ?? new Date();

  // Scope to the performer's own tenant(s): another firm's administrator on the
  // same deployment is not a substitute for this one's.
  const performerPractices = await prisma.practiceMembership.findMany({
    where: { userId: p.performedByUserId, revokedAt: null },
    select: { practice: { select: { tenantId: true } } },
  });
  const tenantIds = [...new Set(performerPractices.map((m) => m.practice.tenantId))];

  const memberships = await prisma.practiceMembership.findMany({
    where: {
      revokedAt: null,
      practice: { tenantId: { in: tenantIds }, archivedAt: null },
      user: { status: "ACTIVE", suspendedAt: null },
    },
    select: { userId: true, practiceId: true, user: { select: { fullName: true } } },
  });

  const admins = new Map<string, string>();
  const grantors = new Map<string, string>();
  for (const m of memberships) {
    const resolved = await resolveMembership(m.userId, m.practiceId, now);
    if (!resolved) continue;
    if (can(resolved, "system.administer")) admins.set(m.userId, m.user.fullName);
    if (can(resolved, "user.grant_access")) grantors.set(m.userId, m.user.fullName);
  }

  const departingId =
    p.departingUserId ?? (admins.size === 1 ? [...admins.keys()][0] : undefined);
  if (!departingId) {
    f.exceptions.push(
      admins.size === 0
        ? "No active system administrator exists at all."
        : `There are ${admins.size} administrators; name the one whose departure is being rehearsed.`,
    );
    return;
  }
  const departing = await prisma.user.findUnique({
    where: { id: departingId },
    select: { fullName: true },
  });
  const departingName = departing?.fullName ?? "the departing administrator";
  f.evidence.push(`Rehearsed the departure of ${departingName}. Tenant scope: ${tenantIds.length} tenant(s).`);

  const remainingAdmins = [...admins].filter(([id]) => id !== departingId);
  if (remainingAdmins.length === 0) {
    f.missingItems.push(
      `No other person holds system administration — with ${departingName} gone, nobody can administer the system.`,
    );
  } else {
    f.evidence.push(`Remaining administrators: ${remainingAdmins.map(([, n]) => n).join(", ")}.`);
  }

  const remainingGrantors = [...grantors].filter(([id]) => id !== departingId);
  if (remainingGrantors.length === 0) {
    f.missingItems.push("Nobody remaining can grant access, so a replacement administrator could not be appointed.");
  } else {
    f.evidence.push(
      `Can appoint a replacement / approve recovery as substitute: ${remainingGrantors.map(([, n]) => n).join(", ")}.`,
    );
  }

  const custodians = (p.keyCustodianNames ?? [])
    .map((n) => n.trim())
    .filter((n) => n && n.toLowerCase() !== departingName.toLowerCase());
  if (custodians.length === 0) {
    f.missingItems.push(
      `No named key custodian other than ${departingName} — the backup and application keys would leave with them.`,
    );
  } else {
    f.evidence.push(`ATTESTED: key custodians other than the departing administrator: ${custodians.join(", ")}.`);
  }

  const tokens = await prisma.dscCustodyRecord.count({
    where: { custodianUserId: departingId, returnedAt: null, archivedAt: null },
  });
  if (tokens > 0) {
    f.exceptions.push(`${tokens} DSC token(s) are in ${departingName}'s custody and not returned.`);
  }
}

// ------------------------------------------------------------------- runner

export async function runDrill(p: DrillParams): Promise<DrillOutcome> {
  await assertSystemAdministrator(p.performedByUserId);
  const performedAt = p.at ?? new Date();

  if (!p.remediationOwnerName.trim()) {
    throw new ContinuityError("BCP06 requires a named remediation owner for every drill.", "REMEDIATION_OWNER_REQUIRED");
  }

  const f = emptyFindings();
  switch (p.scenario) {
    case "PRIMARY_SERVER_LOSS":
    case "SCHEDULED_QUARTERLY":
      await drillPrimaryServerLoss(p, f);
      break;
    case "KEY_SERVICE_UNAVAILABLE":
      await drillKeyServiceUnavailable(p, f);
      break;
    case "SOLE_ADMINISTRATOR_DEPARTED":
      await drillSoleAdministratorDeparted(p, f);
      break;
  }

  const clean = f.missingItems.length === 0 && f.exceptions.length === 0;
  // A finding without a date to fix it by is a finding nobody will fix.
  if (!clean && !p.remediationDueAt) {
    f.exceptions.push("Findings were recorded without a remediation due date.");
  }

  const nextDueAt = nextDrillDue(performedAt);
  const notes = [p.notes?.trim(), ...f.evidence.map((e) => `• ${e}`)].filter(Boolean).join("\n");

  const drill = await prisma.restoreDrill.create({
    data: {
      scenario: p.scenario,
      performedAt,
      performedByUserId: p.performedByUserId,
      restoreRunId: f.restoreRunId,
      achievedRpoSeconds: f.achievedRpoSeconds,
      achievedRtoSeconds: f.achievedRtoSeconds,
      missingItems: f.missingItems,
      exceptions: f.exceptions,
      remediationOwnerUserId: p.remediationOwnerUserId ?? null,
      remediationOwnerName: p.remediationOwnerName.trim(),
      remediationDueAt: p.remediationDueAt ?? null,
      notes: notes || null,
      nextDueAt,
    },
  });

  await recordEvent({
    action: "RESTORE_DRILL_RECORDED",
    targetType: "RestoreDrill",
    targetId: drill.id,
    targetVersion: drill.version,
    result: clean ? "SUCCESS" : "FAILURE",
    actorUserId: p.performedByUserId,
    reason: `${p.scenario}: ${f.missingItems.length} missing, ${f.exceptions.length} exceptions`,
    afterMeta: {
      scenario: p.scenario,
      missingItems: f.missingItems.length,
      exceptions: f.exceptions.length,
      achievedRpoSeconds: f.achievedRpoSeconds,
      achievedRtoSeconds: f.achievedRtoSeconds,
      restoreRunId: f.restoreRunId,
    },
  });

  return {
    drillId: drill.id,
    scenario: p.scenario,
    missingItems: f.missingItems,
    exceptions: f.exceptions,
    evidence: f.evidence,
    achievedRpoSeconds: f.achievedRpoSeconds,
    achievedRtoSeconds: f.achievedRtoSeconds,
    restoreRunId: f.restoreRunId,
    clean,
    nextDueAt,
    version: drill.version,
  };
}

/**
 * Close a drill's remediation. The findings themselves are never edited — the
 * record of what was missing stays, and the closure says what was done about
 * it. Not closable by a drill that had nothing to remediate.
 */
export async function closeRemediation(params: {
  drillId: string;
  actorUserId: string;
  expectedVersion: number;
  note: string;
}): Promise<{ version: number; closedAt: Date }> {
  await assertSystemAdministrator(params.actorUserId);
  if (!params.note.trim()) {
    throw new ContinuityError("Say what was done to remediate the findings.", "NOTE_REQUIRED");
  }
  const drill = await prisma.restoreDrill.findUnique({ where: { id: params.drillId } });
  if (!drill) throw new ContinuityError("Drill not found.", "NOT_FOUND", 404);
  if (drill.missingItems.length === 0 && drill.exceptions.length === 0) {
    throw new ContinuityError("This drill had no findings to remediate.", "NOTHING_TO_REMEDIATE", 409);
  }
  if (drill.remediationClosedAt) {
    throw new ContinuityError("Remediation for this drill is already closed.", "ALREADY_CLOSED", 409);
  }

  const closedAt = new Date();
  const stamp = `[${closedAt.toISOString()}] Remediation closed: ${params.note.trim()}`;
  const { count } = await prisma.restoreDrill.updateMany({
    where: { id: drill.id, version: params.expectedVersion, remediationClosedAt: null },
    data: {
      remediationClosedAt: closedAt,
      notes: drill.notes ? `${drill.notes}\n${stamp}` : stamp,
      version: { increment: 1 },
    },
  });
  if (count === 0) {
    const current = await prisma.restoreDrill.findUnique({ where: { id: drill.id }, select: { version: true } });
    throw await versionConflict({
      subjectType: "RestoreDrill",
      subjectId: drill.id,
      expectedVersion: params.expectedVersion,
      currentVersion: current?.version ?? drill.version,
      message: "This drill changed since you loaded it.",
    });
  }

  await recordEvent({
    action: "RESTORE_DRILL_REMEDIATION_CLOSED",
    targetType: "RestoreDrill",
    targetId: drill.id,
    targetVersion: params.expectedVersion + 1,
    result: "SUCCESS",
    actorUserId: params.actorUserId,
    reason: params.note.trim(),
  });

  return { version: params.expectedVersion + 1, closedAt };
}

export type ScenarioSchedule = {
  scenario: DrillScenario;
  lastPerformedAt: Date | null;
  lastClean: boolean | null;
  nextDueAt: Date | null;
  /** Never performed counts as overdue: BCP06 wants a drill BEFORE production. */
  overdue: boolean;
  openRemediations: number;
};

/** Per-scenario cadence, for the continuity screen. */
export async function drillSchedule(at: Date = new Date()): Promise<ScenarioSchedule[]> {
  const scenarios: DrillScenario[] = ["SCHEDULED_QUARTERLY", ...REQUIRED_SCENARIOS];
  const out: ScenarioSchedule[] = [];
  for (const scenario of scenarios) {
    const last = await prisma.restoreDrill.findFirst({
      where: { scenario },
      orderBy: { performedAt: "desc" },
    });
    const open = await prisma.restoreDrill.count({
      where: {
        scenario,
        remediationClosedAt: null,
        OR: [{ missingItems: { isEmpty: false } }, { exceptions: { isEmpty: false } }],
      },
    });
    out.push({
      scenario,
      lastPerformedAt: last?.performedAt ?? null,
      lastClean: last ? last.missingItems.length === 0 && last.exceptions.length === 0 : null,
      nextDueAt: last?.nextDueAt ?? null,
      overdue: !last || last.nextDueAt <= at,
      openRemediations: open,
    });
  }
  return out;
}

export type ProductionDrillGate = { passed: boolean; blockers: string[] };

/**
 * BCP06 "run a restore drill before production". The gate passes only when
 * each named scenario's MOST RECENT drill is clean or has its remediation
 * closed, and the most recent primary-loss drill actually restored and met
 * both targets. A clean key drill from last year does not cover a failed one
 * from today, so only the latest counts.
 */
export async function productionDrillGate(): Promise<ProductionDrillGate> {
  const blockers: string[] = [];
  for (const scenario of REQUIRED_SCENARIOS) {
    const last = await prisma.restoreDrill.findFirst({
      where: { scenario },
      orderBy: { performedAt: "desc" },
      include: { restoreRun: { select: { targetsMet: true, status: true } } },
    });
    if (!last) {
      blockers.push(`${scenario}: never drilled.`);
      continue;
    }
    const hasFindings = last.missingItems.length > 0 || last.exceptions.length > 0;
    if (hasFindings && !last.remediationClosedAt) {
      blockers.push(
        `${scenario}: latest drill has ${last.missingItems.length} missing item(s) and ${last.exceptions.length} exception(s) with remediation open.`,
      );
    }
    // Closing a remediation note does not turn a failed restore into a working
    // one: the primary-loss gate needs a restore that both reconciled and met
    // its targets, which only a re-drill can produce.
    if (
      scenario === "PRIMARY_SERVER_LOSS" &&
      (last.restoreRun?.targetsMet !== true || last.restoreRun?.status !== "COMPLETED")
    ) {
      blockers.push(
        "PRIMARY_SERVER_LOSS: latest drill did not complete a fully reconciled restore that met both RPO and RTO.",
      );
    }
  }
  return { passed: blockers.length === 0, blockers };
}
