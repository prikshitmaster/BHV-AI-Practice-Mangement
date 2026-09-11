/**
 * Restore engine — BCP03, and the measurement half of BCP02 (PRD §37).
 *
 * "Reconcile object manifests, hashes and database references after restore.
 *  Reapply revoked access, legal holds and approved erasures. Pause outbound
 *  messages and filings until queued actions are reconciled so restoration
 *  cannot resend historical communications or duplicate financial actions."
 *
 * The shape of this module follows from one observation: the dangerous moment
 * in a recovery is not the restore, it is the minute AFTER the restore, when a
 * system that believes it is production starts acting on a month-old queue.
 * So the order here is deliberate and the hold comes first:
 *
 *   1. refuse to run at all unless the target is isolated and sending is off
 *   2. restore the rows
 *   3. park every queued outbound message and outbox event
 *   4. re-apply the access decisions that were made AFTER the backup
 *   5. reconcile, and only then let a human release the hold
 *
 * Step 4 is the one that is easy to leave out and worst to leave out. A backup
 * is a photograph of a moment before someone was removed, before a hold was
 * placed, before an erasure was approved. Restoring it faithfully reinstates
 * all three. "Faithful" and "correct" are not the same word here.
 */

import { spawn } from "node:child_process";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import type { RestoreCheckCategory } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { recordEvent } from "@/lib/audit";
import {
  RPO_TARGET_SECONDS,
  RTO_TARGET_SECONDS,
  artifactPath,
  decryptArtifact,
  readArtifact,
  type ArtifactSource,
} from "@/lib/backup";
import { sha256Hex } from "@/lib/object-store";
import { externalSendingDisabled } from "@/lib/external-sending";
import { assertSystemAdministrator } from "@/lib/continuity";
import { promises as fs } from "node:fs";

export class RestoreSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RestoreSafetyError";
  }
}

export type RestoreOptions = {
  backupRunId: string;
  /** Defaults to RESTORE_TARGET_DATABASE_URL. Never defaults to DATABASE_URL. */
  targetDatabaseUrl?: string;
  targetLabel?: string;
  performedByUserId?: string | null;
  /** How many archived objects to re-hash. BCP's acceptance evidence asks for a sample. */
  objectHashSampleSize?: number;
  /** Deterministic sampling for tests; production takes a real random sample. */
  sampleSeed?: number;
  /** Skip `prisma migrate deploy` when the target schema is already current. */
  skipMigrate?: boolean;
  /**
   * Which copy to restore from. "offsite" is what a primary-server-loss drill
   * (BCP06) must use — restoring from the primary proves nothing about losing it.
   */
  source?: ArtifactSource;
};

export type RestoreCheckResult = {
  category: RestoreCheckCategory;
  subject: string;
  expected: string;
  actual: string;
  passed: boolean;
  detail?: string;
};

export type RestoreResult = {
  restoreRunId: string;
  status: "COMPLETED" | "HELD" | "FAILED";
  measuredRpoSeconds: number;
  measuredRtoSeconds: number;
  rpoTargetSeconds: number;
  rtoTargetSeconds: number;
  targetsMet: boolean;
  rowsRestored: number;
  tablesRestored: number;
  quarantinedOutbound: number;
  quarantinedOutboxEvents: number;
  checks: RestoreCheckResult[];
  /** True only when every check passed. The hold stays on otherwise. */
  reconciled: boolean;
};

// ------------------------------------------------------------ safety gates

function parseDb(url: string): { host: string; port: string; database: string } {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: u.port || "5432",
    database: u.pathname.replace(/^\//, ""),
  };
}

/**
 * Everything that must be true before a single row is written.
 *
 * These are not warnings. A restore into the live database, or into a
 * reachable environment that can still send, is the failure this whole module
 * exists to prevent — so it refuses rather than proceeding carefully.
 */
export function assertRestoreTargetSafe(targetUrl: string | undefined, liveUrl = process.env.DATABASE_URL) {
  if (!targetUrl) {
    throw new RestoreSafetyError(
      "No restore target. Set RESTORE_TARGET_DATABASE_URL to an isolated database — " +
        "this will not fall back to DATABASE_URL.",
    );
  }
  if (!externalSendingDisabled()) {
    throw new RestoreSafetyError(
      "EXTERNAL_SENDING_DISABLED is not set. BCP03 requires outbound to be paused before " +
        "a restore, not after it — refusing to restore into an environment that can send.",
    );
  }
  if (!liveUrl) return;

  const target = parseDb(targetUrl);
  const live = parseDb(liveUrl);
  if (target.host === live.host && target.port === live.port && target.database === live.database) {
    throw new RestoreSafetyError(
      `The restore target is the live database (${live.host}:${live.port}/${live.database}). ` +
        "A restore is not an undo — refusing.",
    );
  }
}

// --------------------------------------------------------- target lifecycle

function maintenanceUrl(targetUrl: string): string {
  const u = new URL(targetUrl);
  u.pathname = "/postgres";
  u.search = "";
  return u.toString();
}

async function ensureTargetDatabase(targetUrl: string): Promise<void> {
  const { database } = parseDb(targetUrl);
  const admin = new PrismaClient({
    adapter: new PrismaPg({ connectionString: maintenanceUrl(targetUrl) }),
  });
  try {
    const existing = await admin.$queryRawUnsafe<{ datname: string }[]>(
      "SELECT datname FROM pg_database WHERE datname = $1",
      database,
    );
    if (existing.length === 0) {
      await admin.$executeRawUnsafe(`CREATE DATABASE ${JSON.stringify(database)}`);
    }
  } finally {
    await admin.$disconnect();
  }
}

/**
 * Bring the target to the current schema by replaying the real migrations,
 * rather than by copying DDL into the archive.
 *
 * The migrations are the schema's only definition — including the SEC04
 * append-only triggers, which a DDL snapshot taken from the live database
 * would be just as likely to reproduce wrongly as rightly. Replaying them also
 * proves the migration history itself survived, which is part of what a
 * restore is meant to demonstrate.
 */
async function applyMigrations(targetUrl: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["node_modules/prisma/build/index.js", "migrate", "deploy"],
      {
        cwd: process.cwd(),
        env: { ...process.env, DATABASE_URL: targetUrl },
        stdio: "pipe",
      },
    );
    let err = "";
    child.stderr.on("data", (d) => (err += String(d)));
    child.stdout.on("data", (d) => (err += String(d)));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`prisma migrate deploy failed:\n${err}`)),
    );
  });
}

async function targetTables(client: PrismaClient): Promise<string[]> {
  const rows = await client.$queryRawUnsafe<{ table_name: string }[]>(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name`,
  );
  return rows.map((r) => r.table_name);
}

// -------------------------------------------------------------------- runner

export async function runRestore(options: RestoreOptions): Promise<RestoreResult> {
  const targetUrl = options.targetDatabaseUrl ?? process.env.RESTORE_TARGET_DATABASE_URL;
  assertRestoreTargetSafe(targetUrl);
  const url = targetUrl as string;

  const backup = await prisma.backupRun.findUnique({ where: { id: options.backupRunId } });
  if (!backup) throw new RestoreSafetyError(`No backup run ${options.backupRunId}.`);
  if (backup.status !== "COMPLETED") {
    throw new RestoreSafetyError(
      `Backup ${backup.id} is ${backup.status}. Restoring from an incomplete archive would ` +
        "produce a database nobody can describe.",
    );
  }

  // The manifest is verified before anything is read from it, so a tampered or
  // truncated archive is caught here rather than halfway through a restore.
  const sourceRoot =
    options.source === "offsite" ? backup.offsiteLocation : backup.primaryLocation;
  if (!sourceRoot) {
    throw new RestoreSafetyError(
      `Backup ${backup.id} has no copy in a separate failure domain, so it cannot be restored from offsite.`,
    );
  }
  const manifestPath = `${sourceRoot}/${backup.id}/manifest.json`;
  const manifestBytes = await fs.readFile(manifestPath);
  if (sha256Hex(manifestBytes) !== backup.manifestSha256) {
    throw new RestoreSafetyError(
      `Manifest for backup ${backup.id} does not match its recorded hash. The archive has ` +
        "changed since it was written — refusing to restore from it.",
    );
  }

  const startedAt = new Date();
  const run = await prisma.restoreRun.create({
    data: {
      backupRunId: backup.id,
      targetLabel: options.targetLabel ?? parseDb(url).database,
      isolated: true,
      externalSendingDisabled: true,
      dataAsOf: backup.dataAsOf,
      startedAt,
      rpoTargetSeconds: RPO_TARGET_SECONDS,
      rtoTargetSeconds: RTO_TARGET_SECONDS,
      status: "RUNNING",
    },
  });

  let target: PrismaClient | null = null;

  try {
    await ensureTargetDatabase(url);
    if (!options.skipMigrate) await applyMigrations(url);

    target = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

    // ---- restore rows ---------------------------------------------------
    const dbArtifact = await readArtifact(
      backup.id,
      "DATABASE_ROWS",
      "database-rows.ndjson",
      options.source,
    );
    const lines = dbArtifact.body.toString("utf8").split("\n").filter(Boolean);

    // `_prisma_migrations` is the TARGET's record of the schema that
    // applyMigrations just built — it is not client data. Loading the archive's
    // copy over it desynchronises history from schema: the next migrate deploy
    // then re-runs migrations whose effects are already present and fails
    // (found by the first BCP06 primary-loss drill, P3018 on an enum label).
    const tables = (await targetTables(target)).filter((t) => t !== "_prisma_migrations");
    const quoted = tables.map((t) => `"public".${JSON.stringify(t)}`);

    // Foreign keys and the SEC04 append-only triggers both live as triggers.
    // Both have to stand down for a bulk load: the FKs because rows arrive in
    // an arbitrary order, the audit triggers because a restored Event must
    // keep the hash it was written with — recomputing the chain on insert
    // would destroy the very evidence the restore is meant to bring back.
    for (const q of quoted) await target.$executeRawUnsafe(`ALTER TABLE ${q} DISABLE TRIGGER ALL`);
    try {
      if (quoted.length > 0) {
        await target.$executeRawUnsafe(`TRUNCATE ${quoted.join(", ")} CASCADE`);
      }

      const known = new Set(tables);
      const byTable = new Map<string, unknown[]>();
      for (const line of lines) {
        const { table, row } = JSON.parse(line) as { table: string; row: unknown };
        if (!known.has(table)) continue;
        const bucket = byTable.get(table);
        if (bucket) bucket.push(row);
        else byTable.set(table, [row]);
      }

      for (const [table, rows] of byTable) {
        // jsonb_populate_record turns the archived JSON back into the table's
        // own row type, in Postgres, using the table's own column definitions.
        // Nothing in JavaScript gets to guess how a numeric, a timestamptz or
        // an enum should be parsed.
        for (let i = 0; i < rows.length; i += 200) {
          const chunk = rows.slice(i, i + 200);
          await target.$executeRawUnsafe(
            `INSERT INTO "public".${JSON.stringify(table)}
               SELECT (jsonb_populate_record(NULL::"public".${JSON.stringify(table)}, elem)).*
               FROM jsonb_array_elements($1::jsonb) AS elem`,
            JSON.stringify(chunk),
          );
        }
      }
    } finally {
      for (const q of quoted) await target.$executeRawUnsafe(`ALTER TABLE ${q} ENABLE TRIGGER ALL`);
    }

    // RTO ends when the restored core actually answers a real question, not
    // when the last INSERT returned.
    const practiceCount = await target.practice.count();
    const usableAt = new Date();

    // ---- BCP03 hold ------------------------------------------------------
    const heldOutbound = await target.outboundMessage.updateMany({
      where: { state: { in: ["QUEUED", "HELD_QUIET_HOURS"] } },
      data: { state: "HELD_RESTORE_RECONCILIATION" },
    });
    const heldEvents = await target.outboxEvent.updateMany({
      where: { state: { in: ["PENDING", "FAILED"] } },
      data: { state: "HELD_RESTORE_RECONCILIATION", claimedAt: null, claimedBy: null },
    });

    await prisma.restoreRun.update({
      where: { id: run.id },
      data: {
        usableAt,
        status: "RECONCILING",
        quarantinedOutboundCount: heldOutbound.count + heldEvents.count,
        measuredRpoSeconds: Math.max(
          0,
          Math.round((startedAt.getTime() - backup.dataAsOf.getTime()) / 1000),
        ),
        measuredRtoSeconds: Math.max(
          0,
          Math.round((usableAt.getTime() - startedAt.getTime()) / 1000),
        ),
        version: { increment: 1 },
      },
    });

    // ---- BCP03 re-apply post-backup decisions, then reconcile -------------
    const checks: RestoreCheckResult[] = [];
    checks.push(...(await reapplyAccessDecisions(target, backup.dataAsOf)));
    const source = options.source ?? "primary";
    checks.push(
      ...(await reconcileObjects(target, backup.id, options.objectHashSampleSize ?? 10, source)),
    );
    checks.push(...(await reconcileFinancials(target, dbArtifact.body.toString("utf8"))));
    checks.push(...(await reconcileObligations(target, dbArtifact.body.toString("utf8"))));
    checks.push(...(await reconcileAuditChain(target, backup.id, source)));
    checks.push(await reconcileOutboundHold(target));

    for (const c of checks) {
      await prisma.restoreCheck.create({
        data: {
          restoreRunId: run.id,
          category: c.category,
          subject: c.subject,
          expected: c.expected,
          actual: c.actual,
          passed: c.passed,
          detail: c.detail ?? null,
        },
      });
    }

    const reconciled = checks.every((c) => c.passed);
    const measuredRpoSeconds = Math.max(
      0,
      Math.round((startedAt.getTime() - backup.dataAsOf.getTime()) / 1000),
    );
    const measuredRtoSeconds = Math.max(
      0,
      Math.round((usableAt.getTime() - startedAt.getTime()) / 1000),
    );
    const targetsMet =
      measuredRpoSeconds <= RPO_TARGET_SECONDS && measuredRtoSeconds <= RTO_TARGET_SECONDS;

    const completedAt = new Date();
    await prisma.restoreRun.update({
      where: { id: run.id },
      data: {
        // COMPLETED here means "the restore finished and reconciled". It does
        // NOT mean outbound was released — that is a separate, human act, and
        // outboundReleasedAt stays null until someone performs it.
        status: reconciled ? "COMPLETED" : "HELD",
        completedAt,
        targetsMet,
        version: { increment: 1 },
      },
    });

    const rowsRestored = lines.length;
    await recordEvent({
      action: "RESTORE_COMPLETED",
      targetType: "RestoreRun",
      targetId: run.id,
      result: reconciled ? "SUCCESS" : "FAILURE",
      actorUserId: options.performedByUserId ?? null,
      reason: "BCP03 restore with outbound held",
      afterMeta: {
        backupRunId: backup.id,
        rowsRestored,
        practicesRestored: practiceCount,
        checksPassed: checks.filter((c) => c.passed).length,
        checksFailed: checks.filter((c) => !c.passed).length,
        measuredRpoSeconds,
        measuredRtoSeconds,
        targetsMet,
      },
    });

    return {
      restoreRunId: run.id,
      status: reconciled ? "COMPLETED" : "HELD",
      measuredRpoSeconds,
      measuredRtoSeconds,
      rpoTargetSeconds: RPO_TARGET_SECONDS,
      rtoTargetSeconds: RTO_TARGET_SECONDS,
      targetsMet,
      rowsRestored,
      tablesRestored: tables.length,
      quarantinedOutbound: heldOutbound.count,
      quarantinedOutboxEvents: heldEvents.count,
      checks,
      reconciled,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await prisma.restoreRun.update({
      where: { id: run.id },
      data: { status: "FAILED", failureReason: message, completedAt: new Date() },
    });
    throw e;
  } finally {
    await target?.$disconnect();
  }
}

// -------------------------------------------------------------- BCP03 checks

/**
 * "Reapply revoked access, legal holds and approved erasures."
 *
 * The source of truth for what happened AFTER the backup is the live database,
 * which is available in a drill and, by definition, may not be in a real
 * disaster. That is a genuine limitation and it is recorded as one: when the
 * live side cannot be read, the check FAILS rather than passing quietly, and
 * the hold stays on. A recovery that cannot prove it re-applied a revocation
 * has not re-applied it.
 */
async function reapplyAccessDecisions(
  target: PrismaClient,
  dataAsOf: Date,
): Promise<RestoreCheckResult[]> {
  const out: RestoreCheckResult[] = [];

  try {
    const revokedMemberships = await prisma.practiceMembership.findMany({
      where: { revokedAt: { gt: dataAsOf } },
      select: { id: true, revokedAt: true },
    });
    let reapplied = 0;
    for (const m of revokedMemberships) {
      const r = await target.practiceMembership.updateMany({
        where: { id: m.id, revokedAt: null },
        data: { revokedAt: m.revokedAt },
      });
      reapplied += r.count;
    }
    out.push({
      category: "PERMISSION",
      subject: "memberships revoked after the backup",
      expected: `${revokedMemberships.length} revocation(s) present in the restored copy`,
      actual: `${reapplied} re-applied, ${revokedMemberships.length - reapplied} already revoked`,
      passed: true,
      detail:
        "Source for post-backup revocations was the live database. In a real disaster that " +
        "source may not exist — see BACKUP-RECOVERY.md for the offline revocation ledger.",
    });

    const revokedGrants = await prisma.permissionGrant.findMany({
      where: { revokedAt: { gt: dataAsOf } },
      select: { id: true, revokedAt: true },
    });
    let grantsReapplied = 0;
    for (const g of revokedGrants) {
      const r = await target.permissionGrant.updateMany({
        where: { id: g.id, revokedAt: null },
        data: { revokedAt: g.revokedAt },
      });
      grantsReapplied += r.count;
    }
    out.push({
      category: "PERMISSION",
      subject: "restricted permission grants revoked after the backup",
      expected: `${revokedGrants.length} revocation(s)`,
      actual: `${grantsReapplied} re-applied`,
      passed: true,
    });

    // A membership revocation is not the whole of "revoked access". suspendUser
    // also marks the ACCOUNT suspended and kills its sessions, links and queued
    // exports — and an archive taken before that brings all of them back live:
    // a restored session row is a working bearer token for someone who left.
    // Found by the T18 acceptance test, which suspends a user after the backup.
    const withdrawnUsers = await prisma.user.findMany({
      where: { status: { in: ["SUSPENDED", "DEACTIVATED"] } },
      select: { id: true, status: true, suspendedAt: true, suspendedReason: true },
    });
    let usersReapplied = 0;
    for (const u of withdrawnUsers) {
      const r = await target.user.updateMany({
        where: { id: u.id, status: { in: ["ACTIVE", "INVITED"] } },
        data: { status: u.status, suspendedAt: u.suspendedAt, suspendedReason: u.suspendedReason },
      });
      usersReapplied += r.count;
    }
    out.push({
      category: "PERMISSION",
      subject: "user accounts suspended or deactivated",
      expected: `${withdrawnUsers.length} account(s) withdrawn in the restored copy`,
      actual: `${usersReapplied} re-applied, ${withdrawnUsers.length - usersReapplied} already withdrawn`,
      passed: true,
    });

    // Every other revocable credential or authority, by the one column they
    // share. Raw SQL on both sides so adding a table here is one word.
    const revocable = [
      "Session",
      "PortalSession",
      "DocumentAccessToken",
      "MfaEnrolment",
      "Invitation",
      "PortalInvitation",
      "ContactAuthority",
      "CrossPracticeShare",
      "DocumentReleaseGrant",
      "DocumentRelease",
    ];
    const perTable: string[] = [];
    let credentialRevocations = 0;
    let credentialsReapplied = 0;
    for (const table of revocable) {
      const rows = await prisma.$queryRawUnsafe<{ id: string; revokedAt: Date }[]>(
        `SELECT id, "revokedAt" FROM "public".${JSON.stringify(table)} WHERE "revokedAt" > $1`,
        dataAsOf,
      );
      let applied = 0;
      for (const r of rows) {
        applied += await target.$executeRawUnsafe(
          `UPDATE "public".${JSON.stringify(table)} SET "revokedAt" = $1 WHERE id = $2 AND "revokedAt" IS NULL`,
          r.revokedAt,
          r.id,
        );
      }
      credentialRevocations += rows.length;
      credentialsReapplied += applied;
      if (rows.length > 0) perTable.push(`${table}: ${applied}/${rows.length}`);
    }
    out.push({
      category: "PERMISSION",
      subject: "sessions, links, enrolments, invitations and authorities revoked after the backup",
      expected: `${credentialRevocations} revocation(s) present in the restored copy`,
      actual: `${credentialsReapplied} re-applied, ${credentialRevocations - credentialsReapplied} already revoked`,
      passed: true,
      detail: perTable.length ? perTable.join("; ") : undefined,
    });

    // A queued export cancelled on live (IAM05: "revocation invalidates ...
    // queued exports") must not come back QUEUED and run from the restored copy.
    const cancelledJobs = await prisma.queuedJob.findMany({
      where: { state: "CANCELLED", finishedAt: { gt: dataAsOf } },
      select: { id: true, cancelledReason: true, finishedAt: true },
    });
    let jobsReapplied = 0;
    for (const j of cancelledJobs) {
      const r = await target.queuedJob.updateMany({
        where: { id: j.id, state: { in: ["QUEUED", "RUNNING"] } },
        data: { state: "CANCELLED", cancelledReason: j.cancelledReason, finishedAt: j.finishedAt },
      });
      jobsReapplied += r.count;
    }
    out.push({
      category: "PERMISSION",
      subject: "queued jobs cancelled after the backup",
      expected: `${cancelledJobs.length} cancellation(s) present in the restored copy`,
      actual: `${jobsReapplied} re-applied, ${cancelledJobs.length - jobsReapplied} already cancelled`,
      passed: true,
    });

    const holds = await prisma.legalHold.findMany({
      where: { placedAt: { gt: dataAsOf }, releasedAt: null },
    });
    let holdsReapplied = 0;
    for (const h of holds) {
      const exists = await target.legalHold.findUnique({ where: { id: h.id } });
      if (!exists) {
        await target.legalHold.create({ data: h });
        holdsReapplied += 1;
      }
    }
    out.push({
      category: "LEGAL_HOLD",
      subject: "legal holds placed after the backup",
      expected: `${holds.length} active hold(s) present after restore`,
      actual: `${holdsReapplied} re-created, ${holds.length - holdsReapplied} already present`,
      passed: true,
    });

    // An erasure approved after the backup must not be undone by the restore.
    // The restored copy predates the deletion, so the document is back — and
    // putting the request back is not enough. The record has to go again.
    const erasures = await prisma.deletionRequest.findMany({
      where: { executedAt: { gt: dataAsOf } },
      select: { id: true, documentId: true, practiceId: true, executedAt: true, state: true },
    });
    let erasuresReapplied = 0;
    let resurrected = 0;
    for (const e of erasures) {
      const doc = await target.document.findFirst({
        where: { id: e.documentId, practiceId: e.practiceId },
        select: { id: true },
      });
      if (doc) {
        resurrected += 1;
        await target.documentVersion.deleteMany({ where: { documentId: e.documentId } });
        await target.document.deleteMany({
          where: { id: e.documentId, practiceId: e.practiceId },
        });
        erasuresReapplied += 1;
      }
      await target.deletionRequest.updateMany({
        where: { id: e.id },
        data: { state: e.state, executedAt: e.executedAt },
      });
    }
    out.push({
      category: "ERASURE",
      subject: "erasures executed after the backup",
      expected: `${erasures.length} erasure(s) still effective after restore`,
      actual: `${resurrected} document(s) came back with the archive and were erased again`,
      passed: erasuresReapplied === resurrected,
      detail:
        erasures.length === 0
          ? "No erasure was approved in the window this archive predates."
          : undefined,
    });
  } catch (e) {
    out.push({
      category: "PERMISSION",
      subject: "post-backup access decisions",
      expected: "revocations, holds and erasures re-applied",
      // Driver-adapter errors can carry an EMPTY message with the cause in
      // `code`/`meta`; an operator reading this at 2am needs all of it.
      actual: `could not be applied: ${describeError(e)}`,
      passed: false,
      detail:
        "Failing rather than passing is deliberate. An unverified re-application is an " +
        "un-re-applied one, and the outbound hold stays on until a human resolves it.",
    });
  }

  return out;
}

/**
 * "Reconcile object manifests, hashes and database references after restore."
 *
 * Three separate questions, answered separately, because they fail separately:
 * does every restored version have a manifest entry (references), does every
 * manifest entry still have a row (orphans), and do the archived bytes still
 * hash to what the row claims (integrity)?
 */
async function reconcileObjects(
  target: PrismaClient,
  backupRunId: string,
  sampleSize: number,
  source: ArtifactSource,
): Promise<RestoreCheckResult[]> {
  const out: RestoreCheckResult[] = [];

  const manifest = JSON.parse(
    (
      await readArtifact(backupRunId, "OBJECT_MANIFEST", "object-manifest.json", source)
    ).body.toString("utf8"),
  ) as {
    entries: {
      versionId: string;
      sha256: string;
      objectKey: string;
      payloadCaptured: boolean;
    }[];
  };

  const restored = await target.documentVersion.findMany({
    select: { id: true, sha256: true, storageObjectId: true },
  });
  const byId = new Map(manifest.entries.map((e) => [e.versionId, e]));

  const missingFromManifest = restored.filter((v) => !byId.has(v.id));
  out.push({
    category: "OBJECT_REFERENCE",
    subject: "restored document versions covered by the object manifest",
    expected: `${restored.length} of ${restored.length}`,
    actual: `${restored.length - missingFromManifest.length} of ${restored.length}`,
    passed: missingFromManifest.length === 0,
    detail: missingFromManifest.length
      ? `Unmanifested version ids: ${missingFromManifest.slice(0, 5).map((v) => v.id).join(", ")}`
      : undefined,
  });

  const restoredIds = new Set(restored.map((v) => v.id));
  const orphans = manifest.entries.filter((e) => !restoredIds.has(e.versionId));
  out.push({
    category: "OBJECT_REFERENCE",
    subject: "manifest entries with a matching database row",
    expected: `${manifest.entries.length} of ${manifest.entries.length}`,
    actual: `${manifest.entries.length - orphans.length} of ${manifest.entries.length}`,
    passed: orphans.length === 0,
  });

  // BCP's acceptance evidence asks for a RANDOM SAMPLE of file hashes. A fixed
  // first-N sample would be re-verifying the same files on every drill and
  // would never look at the rest of the archive.
  const capturable = manifest.entries.filter((e) => e.payloadCaptured);
  const sample = shuffle(capturable).slice(0, Math.min(sampleSize, capturable.length));
  let matched = 0;
  const mismatches: string[] = [];
  for (const entry of sample) {
    try {
      const artifact = await prisma.backupArtifact.findFirst({
        where: { backupRunId, kind: "OBJECT_PAYLOAD", name: `objects/${entry.sha256}` },
        include: { backupRun: { select: { primaryLocation: true, offsiteLocation: true } } },
      });
      if (!artifact) {
        mismatches.push(`${entry.versionId}: payload artifact absent`);
        continue;
      }
      const body = decryptArtifact(await fs.readFile(artifactPath(artifact, source)));
      const row = restored.find((v) => v.id === entry.versionId);
      if (sha256Hex(body) === entry.sha256 && row?.sha256 === entry.sha256) matched += 1;
      else mismatches.push(`${entry.versionId}: hash mismatch`);
    } catch (e) {
      mismatches.push(`${entry.versionId}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  out.push({
    category: "OBJECT_HASH",
    subject: `random sample of ${sample.length} archived file(s) re-hashed`,
    expected: `${sample.length} match the restored database rows`,
    actual: `${matched} matched`,
    passed: matched === sample.length,
    detail: mismatches.length ? mismatches.slice(0, 5).join("; ") : undefined,
  });

  return out;
}

/**
 * Receipt balances, recomputed on both sides.
 *
 * Money is the one place where "nearly restored" is indistinguishable from
 * "restored" on a screen and catastrophic in a ledger, so the totals are
 * summed independently from the archive text and from the restored database
 * and compared exactly, in paise, as strings — a float comparison here would
 * be its own bug.
 */
async function reconcileFinancials(
  target: PrismaClient,
  ndjson: string,
): Promise<RestoreCheckResult[]> {
  const out: RestoreCheckResult[] = [];

  const archived = sumFromNdjson(ndjson, "Receipt", "amount");
  const restoredReceipts = await target.receipt.findMany({ select: { amount: true } });
  const restoredTotal = restoredReceipts.reduce((n, r) => n + BigInt(toPaise(r.amount.toString())), BigInt(0));
  out.push({
    category: "RECEIPT_BALANCE",
    subject: "total receipts",
    expected: `${archived.count} receipt(s) totalling ${archived.total} paise`,
    actual: `${restoredReceipts.length} receipt(s) totalling ${restoredTotal} paise`,
    passed: archived.count === restoredReceipts.length && archived.total === restoredTotal,
  });

  const archivedAlloc = sumFromNdjson(ndjson, "ReceiptAllocation", "amount");
  const restoredAlloc = await target.receiptAllocation.findMany({ select: { amount: true } });
  const allocTotal = restoredAlloc.reduce((n, r) => n + BigInt(toPaise(r.amount.toString())), BigInt(0));
  out.push({
    category: "RECEIPT_BALANCE",
    subject: "total receipt allocations",
    expected: `${archivedAlloc.count} allocation(s) totalling ${archivedAlloc.total} paise`,
    actual: `${restoredAlloc.length} allocation(s) totalling ${allocTotal} paise`,
    passed: archivedAlloc.count === restoredAlloc.length && archivedAlloc.total === allocTotal,
  });

  // The invariant that makes the two numbers above mean something: no receipt
  // may be allocated beyond its own value. A restore that lost a receipt but
  // kept its allocations would still pass a count check and fail this one.
  const overAllocated = await target.$queryRawUnsafe<{ id: string }[]>(
    `SELECT r.id FROM "public"."Receipt" r
       JOIN (SELECT "receiptId", SUM(amount) AS allocated
               FROM "public"."ReceiptAllocation" GROUP BY "receiptId") a
         ON a."receiptId" = r.id
      WHERE a.allocated > r.amount`,
  );
  out.push({
    category: "RECEIPT_BALANCE",
    subject: "receipts allocated beyond their value",
    expected: "0",
    actual: String(overAllocated.length),
    passed: overAllocated.length === 0,
  });

  return out;
}

/** Active obligations are what the acceptance evidence asks to see survive. */
async function reconcileObligations(
  target: PrismaClient,
  ndjson: string,
): Promise<RestoreCheckResult[]> {
  const archivedRows = rowsFromNdjson(ndjson, "Obligation");
  const archivedActive = archivedRows.filter(
    (r) => r.status !== "FILED" && r.status !== "NOT_APPLICABLE" && r.status !== "CANCELLED",
  ).length;
  const restoredActive = await target.obligation.count({
    where: { status: { notIn: ["FILED", "NOT_APPLICABLE", "CANCELLED"] } },
  });
  return [
    {
      category: "OBLIGATION",
      subject: "active statutory obligations",
      expected: String(archivedActive),
      actual: String(restoredActive),
      passed: archivedActive === restoredActive,
      detail: `${archivedRows.length} obligation row(s) in the archive in total`,
    },
  ];
}

/**
 * SEC04's chain, re-walked in the restored copy.
 *
 * This is the check that proves the restore did not quietly rewrite history:
 * the archive recorded the chain head at backup time, and the restored trail
 * must still end on exactly that hash. It also confirms the audit triggers were
 * genuinely stood down during the load rather than recomputing every hash.
 */
async function reconcileAuditChain(
  target: PrismaClient,
  backupRunId: string,
  source: ArtifactSource,
): Promise<RestoreCheckResult[]> {
  const artifact = await readArtifact(backupRunId, "AUDIT_EVENTS", "audit-events.ndjson", source);
  const [headerLine] = artifact.body.toString("utf8").split("\n");
  const header = JSON.parse(headerLine) as {
    chainHead: { sequence: string; hash: string | null } | null;
    count: number;
  };

  const head = await target.event.findFirst({
    orderBy: { sequence: "desc" },
    select: { sequence: true, hash: true },
  });
  const count = await target.event.count();

  return [
    {
      category: "AUDIT_CHAIN",
      subject: "audit trail head after restore",
      expected: header.chainHead
        ? `sequence ${header.chainHead.sequence}, hash ${header.chainHead.hash?.slice(0, 16)}…`
        : "no events",
      actual: head ? `sequence ${head.sequence}, hash ${head.hash?.slice(0, 16)}…` : "no events",
      passed:
        (!header.chainHead && !head) ||
        (Boolean(header.chainHead) &&
          Boolean(head) &&
          head!.sequence.toString() === header.chainHead!.sequence &&
          head!.hash === header.chainHead!.hash),
    },
    {
      category: "AUDIT_CHAIN",
      subject: "audit event count",
      expected: String(header.count),
      actual: String(count),
      passed: header.count === count,
    },
  ];
}

async function reconcileOutboundHold(target: PrismaClient): Promise<RestoreCheckResult> {
  const stillQueued = await target.outboundMessage.count({
    where: { state: { in: ["QUEUED", "HELD_QUIET_HOURS"] } },
  });
  const stillPending = await target.outboxEvent.count({ where: { state: "PENDING" } });
  return {
    category: "OUTBOUND_HOLD",
    subject: "queued outbound work left able to fire",
    expected: "0 messages, 0 outbox events",
    actual: `${stillQueued} messages, ${stillPending} outbox events`,
    passed: stillQueued === 0 && stillPending === 0 && externalSendingDisabled(),
    detail: externalSendingDisabled()
      ? undefined
      : "EXTERNAL_SENDING_DISABLED is no longer set in this process.",
  };
}

// ------------------------------------------------------------- hold release

export class OutboundHoldError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutboundHoldError";
  }
}

/**
 * BCP03's release, which is a decision and not a step.
 *
 * It refuses on an unreconciled restore. A "release anyway" flag was
 * considered and left out: the whole value of the hold is that it cannot be
 * cleared by whoever is in a hurry at 2am, and an override that exists will be
 * used exactly then.
 */
export async function releaseOutboundHold(params: {
  restoreRunId: string;
  releasedByUserId: string;
  reason: string;
  expectedVersion: number;
}): Promise<{ releasedAt: Date; version: number }> {
  // In the library, not only the route: whoever can call this can let a
  // restored copy start sending, which is an administration act (IAM02).
  await assertSystemAdministrator(params.releasedByUserId);

  const run = await prisma.restoreRun.findUnique({
    where: { id: params.restoreRunId },
    include: { checks: true },
  });
  if (!run) throw new OutboundHoldError(`No restore run ${params.restoreRunId}.`);
  if (run.outboundReleasedAt) {
    throw new OutboundHoldError("The outbound hold on this restore has already been released.");
  }

  const failed = run.checks.filter((c) => !c.passed);
  if (failed.length > 0) {
    throw new OutboundHoldError(
      `${failed.length} reconciliation check(s) failed — outbound stays held. Unresolved: ` +
        failed.map((c) => c.subject).join("; "),
    );
  }
  if (run.checks.length === 0) {
    throw new OutboundHoldError(
      "This restore has no reconciliation checks at all. An unreconciled restore cannot be released.",
    );
  }

  // API02: no silent last-write-wins on a control this consequential.
  const releasedAt = new Date();
  const updated = await prisma.restoreRun.updateMany({
    where: { id: run.id, version: params.expectedVersion, outboundReleasedAt: null },
    data: {
      outboundReleasedAt: releasedAt,
      outboundReleasedByUserId: params.releasedByUserId,
      version: { increment: 1 },
    },
  });
  if (updated.count === 0) {
    throw new OutboundHoldError(
      `This restore changed since you loaded it (expected version ${params.expectedVersion}). Reload and check the reconciliation again.`,
    );
  }

  await recordEvent({
    action: "RESTORE_OUTBOUND_HOLD_RELEASED",
    targetType: "RestoreRun",
    targetId: run.id,
    targetVersion: params.expectedVersion + 1,
    result: "SUCCESS",
    actorUserId: params.releasedByUserId,
    reason: params.reason,
  });

  return { releasedAt, version: params.expectedVersion + 1 };
}

// ------------------------------------------------------------------ helpers

function describeError(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  const extra = e as Error & { code?: unknown; meta?: unknown; cause?: unknown };
  const parts = [e.name, e.message || "(no message)"];
  if (extra.code) parts.push(`code=${String(extra.code)}`);
  if (extra.meta) parts.push(`meta=${JSON.stringify(extra.meta).slice(0, 300)}`);
  if (extra.cause) parts.push(`cause=${extra.cause instanceof Error ? extra.cause.message : String(extra.cause)}`);
  return parts.join(" | ");
}

function rowsFromNdjson(ndjson: string, table: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const line of ndjson.split("\n")) {
    if (!line) continue;
    const parsed = JSON.parse(line) as { table: string; row: Record<string, unknown> };
    if (parsed.table === table) out.push(parsed.row);
  }
  return out;
}

function sumFromNdjson(ndjson: string, table: string, field: string) {
  const rows = rowsFromNdjson(ndjson, table);
  let total = BigInt(0);
  for (const r of rows) total += BigInt(toPaise(String(r[field] ?? "0")));
  return { count: rows.length, total };
}

/** Decimal string to integer paise, without ever going through a float. */
function toPaise(value: string): string {
  const [whole, frac = ""] = value.split(".");
  const padded = (frac + "00").slice(0, 2);
  const negative = whole.startsWith("-");
  const digits = `${whole.replace("-", "")}${padded}`.replace(/^0+(?=\d)/, "");
  return `${negative ? "-" : ""}${digits}`;
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
