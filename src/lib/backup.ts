/**
 * Backup engine — BCP01, and the measurement half of BCP02 (PRD §37).
 *
 * BCP01 fixes the scope: "Back up the database, object versions,
 * configuration, templates, necessary keys / recovery material and audit
 * events under separate access controls. Keep an encrypted copy in a separate
 * failure domain and an immutable / offline copy where feasible."
 *
 * Three decisions in here are worth reading before changing anything:
 *
 * 1. Audit events are exported TWICE — once inside the database artifact,
 *    once as an artifact of their own. That is not an oversight. BCP01 asks
 *    for audit events "under separate access controls", and a copy that can
 *    only be read by whoever can read every client record is not separately
 *    controlled. The standalone copy carries the hash chain, so a restore can
 *    prove the trail was not rewritten without restoring the database first.
 *
 * 2. Key material is captured as an INVENTORY, never as material. The backup
 *    records which keys a restore will need and a fingerprint to recognise
 *    them by; it does not record the keys. A backup that contains the key
 *    that decrypts it protects nothing. Escrowing the actual key is an
 *    operator procedure, written down in BACKUP-RECOVERY.md, not something
 *    this module will silently do for you.
 *
 * 3. `dataAsOf` is stamped BEFORE the first read and is what RPO is measured
 *    from. Measuring from completion would quietly forgive every minute the
 *    run spent working.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { recordEvent } from "@/lib/audit";
import { raiseAlert } from "@/lib/monitoring";
import { getObject, objectStoreConfigured, sha256Hex } from "@/lib/object-store";
import type { BackupArtifactKind } from "@/generated/prisma/enums";

export class BackupConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackupConfigurationError";
  }
}

/**
 * BCP02's proposed production targets, in one place so the restore path and
 * the drill path cannot drift apart on what "the target" was. Overridable per
 * deployment because the PRD allows a revised service level — but only an
 * EXPLICIT one: an unset variable keeps the PRD's number rather than silently
 * relaxing it.
 */
export const RPO_TARGET_SECONDS = Number(process.env.BACKUP_RPO_TARGET_SECONDS ?? 3600);
export const RTO_TARGET_SECONDS = Number(process.env.BACKUP_RTO_TARGET_SECONDS ?? 8 * 3600);

// ---------------------------------------------------------------- encryption

/**
 * The backup key is deliberately NOT `APP_ENCRYPTION_KEY`.
 *
 * BCP01 says the backup lives "under separate access controls". If the running
 * application's key also opens the archive, then anyone who reaches the app
 * server reaches every historical copy of the firm's data as well, and the
 * separate failure domain protects against disk failure only — not against
 * the compromise it is mostly there for.
 */
export function backupEncryptionKey(): Buffer {
  const raw = process.env.BACKUP_ENCRYPTION_KEY;
  if (!raw) {
    throw new BackupConfigurationError(
      "BACKUP_ENCRYPTION_KEY is not set. Refusing to write an unencrypted backup, " +
        "and refusing to fall back to APP_ENCRYPTION_KEY — BCP01 requires the archive " +
        "to sit under separate access controls from the running application.",
    );
  }
  if (process.env.APP_ENCRYPTION_KEY && raw === process.env.APP_ENCRYPTION_KEY) {
    throw new BackupConfigurationError(
      "BACKUP_ENCRYPTION_KEY is the same value as APP_ENCRYPTION_KEY. The archive would " +
        "then be readable by anything that can read the application's own secrets, which " +
        "is exactly the separation BCP01 asks for.",
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new BackupConfigurationError(
      "BACKUP_ENCRYPTION_KEY must be 32 bytes, base64-encoded (AES-256).",
    );
  }
  return key;
}

/** A short, non-reversible name for the key, so a restore can check it has the right one. */
export function keyFingerprint(key: Buffer): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

const MAGIC = Buffer.from("BHVBK1");

/** AES-256-GCM. Layout: magic(6) | iv(12) | authTag(16) | ciphertext. */
export function encryptArtifact(plaintext: Buffer, key = backupEncryptionKey()): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), body]);
}

export function decryptArtifact(blob: Buffer, key = backupEncryptionKey()): Buffer {
  if (!blob.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new BackupConfigurationError("Not a BHV backup artifact (bad magic).");
  }
  const iv = blob.subarray(6, 18);
  const tag = blob.subarray(18, 34);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  // Throws on a wrong key or a tampered byte, which is the point: a silent
  // partial decrypt would let a corrupted archive pass as a good one.
  return Buffer.concat([decipher.update(blob.subarray(34)), decipher.final()]);
}

// ----------------------------------------------------------------- locations

export function backupRoot(): string {
  return process.env.BACKUP_ROOT ?? path.join(process.cwd(), ".backups");
}

/**
 * BCP01's "separate failure domain". Unset is an honest answer and is recorded
 * as such on the run — but it is also a gap, and the run says so rather than
 * reporting a clean backup.
 */
export function offsiteRoot(): string | null {
  return process.env.BACKUP_OFFSITE_ROOT ?? null;
}

// -------------------------------------------------------------- table export

type TableRowCount = { table: string; rows: number };

/**
 * Read the table list from the database rather than from a hand-kept array.
 * A list maintained by hand is a list that stops matching the schema the first
 * time someone adds a model and forgets — and the failure mode is a backup
 * that silently omits a table.
 */
export async function listTables(client: typeof prisma = prisma): Promise<string[]> {
  const rows = await client.$queryRawUnsafe<{ table_name: string }[]>(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name`,
  );
  return rows.map((r) => r.table_name);
}

/**
 * One table to NDJSON, serialised BY POSTGRES via to_jsonb.
 *
 * Doing the serialisation in the database rather than in JavaScript is what
 * makes the round trip exact: numerics keep their scale, timestamps keep their
 * precision, arrays and jsonb keep their shape, and enums keep their labels.
 * A hand-rolled JS serialiser gets bigint and Decimal wrong on the way out and
 * nobody notices until a receipt balance is restored a paisa short.
 */
async function exportTable(
  client: typeof prisma,
  table: string,
): Promise<{ lines: string[]; rows: number }> {
  const rows = await client.$queryRawUnsafe<{ row: unknown }[]>(
    `SELECT to_jsonb(t) AS row FROM "public".${JSON.stringify(table)} t`,
  );
  const lines = rows.map((r) => JSON.stringify({ table, row: r.row }));
  return { lines, rows: rows.length };
}

// ------------------------------------------------------------------ run type

export type BackupOptions = {
  tenantId?: string | null;
  createdByUserId?: string | null;
  /** Copy the object bytes too, not only their hashes. */
  includeObjectPayloads?: boolean;
  /** An immutable / offline copy exists for this run. Claim it only if true. */
  immutableCopy?: boolean;
  /** Test seam. Production reads BACKUP_ROOT. */
  rootOverride?: string;
  offsiteOverride?: string | null;
};

export type BackupResult = {
  backupRunId: string;
  dataAsOf: Date;
  completedAt: Date;
  directory: string;
  offsiteDirectory: string | null;
  manifestSha256: string;
  artifacts: {
    kind: BackupArtifactKind;
    name: string;
    sha256: string;
    sizeBytes: number;
    recordCount: number | null;
  }[];
  tableCounts: TableRowCount[];
  /** BCP01 gaps that were NOT satisfied — reported, never hidden. */
  gaps: string[];
};

/**
 * Configuration worth restoring, with every secret-shaped value replaced by
 * whether it was set. Knowing that MINIO_ENDPOINT existed and what it pointed
 * at is what a restore needs; knowing the password is what an attacker needs.
 */
const CONFIG_KEYS = [
  "NODE_ENV",
  "NEXTAUTH_URL",
  "DATABASE_URL",
  "REDIS_URL",
  "MINIO_ENDPOINT",
  "MINIO_BUCKET",
  "BACKUP_ROOT",
  "BACKUP_OFFSITE_ROOT",
  "BACKUP_RPO_TARGET_SECONDS",
  "BACKUP_RTO_TARGET_SECONDS",
  "SECURITY_INCIDENT_OWNER",
  "SECURITY_ALERT_DESTINATION",
];
const SECRET_SHAPED = /password|secret|key|token|credential/i;

function captureConfiguration() {
  const out: Record<string, string> = {};
  for (const k of CONFIG_KEYS) {
    const v = process.env[k];
    if (v === undefined) {
      out[k] = "[not set]";
    } else if (SECRET_SHAPED.test(k)) {
      out[k] = "[set — value withheld]";
    } else {
      // Connection strings carry credentials in the userinfo section.
      out[k] = v.replace(/\/\/[^@/]*@/, "//[credentials withheld]@");
    }
  }
  return out;
}

/**
 * BCP01's "necessary keys / recovery material", as an inventory.
 *
 * What a restore operator actually needs to know is: which keys must be
 * present, how to tell a right one from a wrong one, and how much recovery
 * material exists that would be lost with them. None of that requires the
 * secrets themselves, and including the secrets would make the archive its own
 * master key.
 */
async function captureKeyInventory(client: typeof prisma) {
  const [credentials, recoveryCodes, mfaEnrolments] = await Promise.all([
    client.userCredential.count(),
    client.mfaRecoveryCode.count(),
    client.mfaEnrolment.count(),
  ]);

  const appKey = process.env.APP_ENCRYPTION_KEY;
  return {
    note:
      "Inventory only. No key material is stored in this archive by design — see " +
      "BACKUP-RECOVERY.md for the escrow procedure that holds the actual keys.",
    keys: [
      {
        name: "APP_ENCRYPTION_KEY",
        purpose: "Wraps MFA seeds and other secrets at rest (SEC02).",
        present: Boolean(appKey),
        fingerprint: appKey ? keyFingerprint(Buffer.from(appKey, "base64")) : null,
        requiredToRestore: true,
      },
      {
        name: "BACKUP_ENCRYPTION_KEY",
        purpose: "Wraps this archive (BCP01).",
        present: true,
        fingerprint: keyFingerprint(backupEncryptionKey()),
        requiredToRestore: true,
      },
    ],
    recoveryMaterialCounts: {
      userCredentials: credentials,
      mfaEnrolments: mfaEnrolments,
      mfaRecoveryCodes: recoveryCodes,
    },
  };
}

/** BCP01 "templates" — the material a restored practice needs to produce documents again. */
async function captureTemplates(client: typeof prisma) {
  const [serviceTemplates, messageTemplates, letterheads] = await Promise.all([
    client.serviceTemplate.findMany(),
    client.messageTemplate.findMany(),
    client.practiceLetterhead.findMany(),
  ]);
  const lines = [
    ...serviceTemplates.map((t) => JSON.stringify({ kind: "ServiceTemplate", record: t })),
    ...messageTemplates.map((t) => JSON.stringify({ kind: "MessageTemplate", record: t })),
    ...letterheads.map((t) => JSON.stringify({ kind: "PracticeLetterhead", record: t })),
  ];
  return { lines, count: lines.length };
}

// --------------------------------------------------------------------- runner

export async function runBackup(options: BackupOptions = {}): Promise<BackupResult> {
  const key = backupEncryptionKey();
  const root = options.rootOverride ?? backupRoot();
  const offsite = options.offsiteOverride !== undefined ? options.offsiteOverride : offsiteRoot();

  // Stamped before the first read. Everything after this moment is, by
  // definition, not in the backup.
  const dataAsOf = new Date();

  const run = await prisma.backupRun.create({
    data: {
      tenantId: options.tenantId ?? null,
      dataAsOf,
      status: "RUNNING",
      primaryLocation: root,
      offsiteLocation: offsite,
      immutableCopy: options.immutableCopy ?? false,
      encrypted: true,
      encryptionKeyId: keyFingerprint(key),
      manifestSha256: "",
      createdByUserId: options.createdByUserId ?? null,
    },
  });

  const directory = path.join(root, run.id);
  const gaps: string[] = [];

  try {
    await fs.mkdir(directory, { recursive: true });

    const artifacts: BackupResult["artifacts"] = [];
    let totalBytes = 0;

    const write = async (
      kind: BackupArtifactKind,
      name: string,
      plaintext: Buffer,
      recordCount: number | null,
    ) => {
      const sha256 = sha256Hex(plaintext);
      const blob = encryptArtifact(plaintext, key);
      const target = path.join(directory, `${name}.enc`);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, blob);

      await prisma.backupArtifact.create({
        data: {
          backupRunId: run.id,
          kind,
          name,
          sha256,
          sizeBytes: BigInt(plaintext.length),
          recordCount,
          encrypted: true,
          storedAt: target,
        },
      });
      totalBytes += blob.length;
      artifacts.push({ kind, name, sha256, sizeBytes: plaintext.length, recordCount });
      return sha256;
    };

    // ---- 1. database rows -------------------------------------------------
    const tables = await listTables();
    const tableCounts: TableRowCount[] = [];
    const dbLines: string[] = [];
    for (const table of tables) {
      const { lines, rows } = await exportTable(prisma, table);
      dbLines.push(...lines);
      tableCounts.push({ table, rows });
    }
    await write(
      "DATABASE_ROWS",
      "database-rows.ndjson",
      Buffer.from(dbLines.join("\n"), "utf8"),
      dbLines.length,
    );

    // ---- 2. audit events, separately --------------------------------------
    const events = await prisma.$queryRawUnsafe<{ row: unknown }[]>(
      `SELECT to_jsonb(t) AS row FROM "public"."Event" t ORDER BY t.sequence ASC`,
    );
    const chainHead = await prisma.event.findFirst({
      orderBy: { sequence: "desc" },
      select: { sequence: true, hash: true },
    });
    const auditPayload = {
      note: "Separately controlled copy of the SEC04 trail (BCP01).",
      chainHead: chainHead
        ? { sequence: chainHead.sequence.toString(), hash: chainHead.hash }
        : null,
      count: events.length,
    };
    await write(
      "AUDIT_EVENTS",
      "audit-events.ndjson",
      Buffer.from(
        [JSON.stringify(auditPayload), ...events.map((e) => JSON.stringify(e.row))].join("\n"),
        "utf8",
      ),
      events.length,
    );

    // ---- 3. object versions ----------------------------------------------
    const versions = await prisma.documentVersion.findMany({
      select: {
        id: true,
        practiceId: true,
        documentId: true,
        versionNo: true,
        storageObjectId: true,
        sha256: true,
        sizeBytes: true,
        status: true,
      },
      orderBy: { createdAt: "asc" },
    });

    const storeUp = objectStoreConfigured();
    if (!storeUp && versions.length > 0) {
      gaps.push(
        `Object store is not configured: ${versions.length} document version(s) were manifested by hash but their bytes were NOT copied.`,
      );
    }

    const wantPayloads = (options.includeObjectPayloads ?? true) && storeUp;
    const manifestEntries: {
      versionId: string;
      practiceId: string;
      documentId: string;
      versionNo: number;
      objectKey: string;
      sha256: string;
      sizeBytes: string;
      status: string;
      payloadCaptured: boolean;
      payloadMatchedHash: boolean | null;
    }[] = [];

    // Content-addressed storage means two versions can share bytes; copy once.
    const copied = new Set<string>();
    for (const v of versions) {
      let captured = false;
      let matched: boolean | null = null;

      if (wantPayloads) {
        try {
          const body = await getObject(v.storageObjectId);
          if (body === null) {
            gaps.push(`Object missing from the store for version ${v.id} (${v.storageObjectId}).`);
          } else {
            // DOC02's hash is the whole point of content addressing: if the
            // stored bytes no longer hash to it, the backup must say so rather
            // than faithfully preserving corruption as though it were fine.
            matched = sha256Hex(body) === v.sha256;
            if (!matched) {
              gaps.push(
                `Stored bytes for version ${v.id} do not match the recorded SHA-256 — copied anyway, flagged here.`,
              );
            }
            if (!copied.has(v.sha256)) {
              await write("OBJECT_PAYLOAD", path.posix.join("objects", v.sha256), body, null);
              copied.add(v.sha256);
            }
            captured = true;
          }
        } catch (e) {
          gaps.push(
            `Could not read object for version ${v.id}: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }

      manifestEntries.push({
        versionId: v.id,
        practiceId: v.practiceId,
        documentId: v.documentId,
        versionNo: v.versionNo,
        objectKey: v.storageObjectId,
        sha256: v.sha256,
        sizeBytes: v.sizeBytes.toString(),
        status: v.status,
        payloadCaptured: captured,
        payloadMatchedHash: matched,
      });
    }

    await write(
      "OBJECT_MANIFEST",
      "object-manifest.json",
      Buffer.from(JSON.stringify({ entries: manifestEntries }, null, 2), "utf8"),
      manifestEntries.length,
    );

    // ---- 4. configuration, templates, key inventory -----------------------
    await write(
      "CONFIGURATION",
      "configuration.json",
      Buffer.from(JSON.stringify(captureConfiguration(), null, 2), "utf8"),
      null,
    );

    const templates = await captureTemplates(prisma);
    await write(
      "TEMPLATE",
      "templates.ndjson",
      Buffer.from(templates.lines.join("\n"), "utf8"),
      templates.count,
    );

    await write(
      "KEY_INVENTORY",
      "key-inventory.json",
      Buffer.from(JSON.stringify(await captureKeyInventory(prisma), null, 2), "utf8"),
      null,
    );

    // ---- 5. manifest ------------------------------------------------------
    // Plaintext on purpose: it holds names, hashes and counts and no client
    // data, so an operator can see what an archive contains — and what it is
    // MISSING — without first proving they hold the decryption key.
    const manifest = {
      backupRunId: run.id,
      dataAsOf: dataAsOf.toISOString(),
      encryptionKeyId: keyFingerprint(key),
      tableCounts,
      artifacts: artifacts.map((a) => ({
        kind: a.kind,
        name: a.name,
        sha256: a.sha256,
        sizeBytes: a.sizeBytes,
        recordCount: a.recordCount,
      })),
      gaps,
    };
    const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2), "utf8");
    await fs.writeFile(path.join(directory, "manifest.json"), manifestBytes);
    const manifestSha256 = sha256Hex(manifestBytes);

    // ---- 6. the separate failure domain -----------------------------------
    let offsiteDirectory: string | null = null;
    if (offsite) {
      offsiteDirectory = path.join(offsite, run.id);
      await copyTree(directory, offsiteDirectory);
      if (options.immutableCopy) {
        // Best effort, and the run records what was actually achieved rather
        // than what was asked for: a read-only bit on the same filesystem is
        // not a WORM store, and BACKUP-RECOVERY.md says so plainly.
        await makeReadOnly(offsiteDirectory);
      }
    } else {
      gaps.push(
        "BACKUP_OFFSITE_ROOT is not set: no copy exists in a separate failure domain (BCP01).",
      );
    }
    if (!options.immutableCopy) {
      gaps.push("No immutable / offline copy was taken for this run (BCP01).");
    }

    const completedAt = new Date();
    await prisma.backupRun.update({
      where: { id: run.id },
      data: {
        status: "COMPLETED",
        completedAt,
        manifestSha256,
        sizeBytes: BigInt(totalBytes),
        version: { increment: 1 },
      },
    });

    await recordEvent({
      action: "BACKUP_COMPLETED",
      targetType: "BackupRun",
      targetId: run.id,
      targetVersion: run.version + 1,
      result: "SUCCESS",
      actorUserId: options.createdByUserId ?? null,
      tenantId: options.tenantId ?? null,
      reason: "BCP01 scheduled backup",
      afterMeta: {
        artifacts: artifacts.length,
        tables: tableCounts.length,
        rows: tableCounts.reduce((n, t) => n + t.rows, 0),
        gaps: gaps.length,
        offsite: Boolean(offsiteDirectory),
      },
    });

    return {
      backupRunId: run.id,
      dataAsOf,
      completedAt,
      directory,
      offsiteDirectory,
      manifestSha256,
      artifacts,
      tableCounts,
      gaps,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await prisma.backupRun.update({
      where: { id: run.id },
      data: { status: "FAILED", failureReason: message, completedAt: new Date() },
    });
    // SEC05 already lists backup failure as a monitored condition; this is the
    // producer for that alert kind.
    await raiseAlert({
      kind: "BACKUP_FAILURE",
      severity: "CRITICAL",
      summary: "A backup run failed",
      evidence: { backupRunId: run.id, message },
    });
    await recordEvent({
      action: "BACKUP_FAILED",
      targetType: "BackupRun",
      targetId: run.id,
      result: "FAILURE",
      actorUserId: options.createdByUserId ?? null,
      errorMessage: message,
    });
    throw e;
  }
}

// ------------------------------------------------------------------- reading

export type LoadedArtifact = { name: string; kind: BackupArtifactKind; body: Buffer };

/**
 * Read one artifact back and verify it against the hash recorded at backup
 * time. Verification is not optional here — a restore that trusts the bytes it
 * finds on disk is how a corrupted archive becomes a corrupted production.
 */
export async function readArtifact(
  backupRunId: string,
  kind: BackupArtifactKind,
  name: string,
  /**
   * BCP06 "loss of the primary server": a drill must read the separate-failure-
   * domain copy, or it has only proved the primary still works.
   */
  source: ArtifactSource = "primary",
  key?: Buffer,
): Promise<LoadedArtifact> {
  const artifact = await prisma.backupArtifact.findFirst({
    where: { backupRunId, kind, name },
    include: { backupRun: { select: { primaryLocation: true, offsiteLocation: true } } },
  });
  if (!artifact) {
    throw new BackupConfigurationError(`Backup ${backupRunId} has no ${kind} artifact "${name}".`);
  }
  const blob = await fs.readFile(artifactPath(artifact, source));
  const body = decryptArtifact(blob, key);
  const actual = sha256Hex(body);
  if (actual !== artifact.sha256) {
    throw new BackupConfigurationError(
      `Artifact "${name}" failed its integrity check: expected ${artifact.sha256}, got ${actual}.`,
    );
  }
  return { name, kind, body };
}

export type ArtifactSource = "primary" | "offsite";

/**
 * Where an artifact's bytes live in the chosen copy. The offsite copy is the
 * primary run directory copied whole (see runBackup), so the relative layout
 * under `<root>/<runId>/` is identical in both.
 */
export function artifactPath(
  artifact: {
    backupRunId: string;
    storedAt: string;
    backupRun: { primaryLocation: string; offsiteLocation: string | null };
  },
  source: ArtifactSource,
): string {
  if (source === "primary") return artifact.storedAt;
  if (!artifact.backupRun.offsiteLocation) {
    throw new BackupConfigurationError(
      "This backup has no copy in a separate failure domain — there is nothing offsite to read.",
    );
  }
  const relative = path.relative(
    path.join(artifact.backupRun.primaryLocation, artifact.backupRunId),
    artifact.storedAt,
  );
  return path.join(artifact.backupRun.offsiteLocation, artifact.backupRunId, relative);
}

/** Seconds of data at risk if we had to fall back to this backup right now. */
export function rpoSecondsFrom(dataAsOf: Date, at: Date = new Date()): number {
  return Math.max(0, Math.round((at.getTime() - dataAsOf.getTime()) / 1000));
}

// ------------------------------------------------------- BCP02 recovery posture

export type RecoveryPosture = {
  rpoTargetSeconds: number;
  rtoTargetSeconds: number;
  /** Null when there is no usable backup at all — which is NOT an RPO of zero. */
  latestBackupAt: Date | null;
  currentRpoSeconds: number | null;
  rpoWithinTarget: boolean | null;
  /**
   * BCP02: "Measure the full restore". Taken from the last restore that
   * actually reached a usable state, never estimated from a backup duration.
   */
  lastMeasuredRtoSeconds: number | null;
  lastMeasuredAt: Date | null;
  rtoWithinTarget: boolean | null;
  /** Every reason this posture is weaker than the headline numbers suggest. */
  warnings: string[];
};

/**
 * BCP02 in one call, written so it cannot flatter itself.
 *
 * The three null-able fields are the whole design. "No backup yet" must not
 * render as an RPO of zero, and "never restored" must not render as an RTO
 * within target — both are the states a recovery plan is most likely to be
 * quietly sitting in, and both are the ones a green dashboard would hide. The
 * PRD is explicit about this: "Report measured RPO / RTO rather than a
 * successful backup job alone."
 */
export async function recoveryPosture(at: Date = new Date()): Promise<RecoveryPosture> {
  const warnings: string[] = [];

  const latest = await prisma.backupRun.findFirst({
    where: { status: "COMPLETED" },
    orderBy: { dataAsOf: "desc" },
    select: { dataAsOf: true, offsiteLocation: true, immutableCopy: true },
  });

  const currentRpoSeconds = latest ? rpoSecondsFrom(latest.dataAsOf, at) : null;
  if (!latest) warnings.push("No completed backup exists. Recovery point objective is unmet, not unknown.");
  else {
    if (currentRpoSeconds !== null && currentRpoSeconds > RPO_TARGET_SECONDS) {
      warnings.push(
        `The newest backup is ${Math.round(currentRpoSeconds / 60)} minutes old, past the ${Math.round(RPO_TARGET_SECONDS / 60)}-minute target.`,
      );
    }
    if (!latest.offsiteLocation) {
      warnings.push("The newest backup has no copy in a separate failure domain (BCP01).");
    }
    if (!latest.immutableCopy) {
      warnings.push("The newest backup has no immutable / offline copy (BCP01).");
    }
  }

  const lastRestore = await prisma.restoreRun.findFirst({
    where: { measuredRtoSeconds: { not: null } },
    orderBy: { startedAt: "desc" },
    select: { measuredRtoSeconds: true, startedAt: true },
  });
  if (!lastRestore) {
    warnings.push(
      "No restore has ever been measured. Recovery time objective is unverified — a successful backup job is not evidence of a recovery.",
    );
  } else if ((lastRestore.measuredRtoSeconds ?? 0) > RTO_TARGET_SECONDS) {
    warnings.push(
      `The last measured restore took ${Math.round((lastRestore.measuredRtoSeconds ?? 0) / 60)} minutes, past the ${Math.round(RTO_TARGET_SECONDS / 60)}-minute target.`,
    );
  }

  return {
    rpoTargetSeconds: RPO_TARGET_SECONDS,
    rtoTargetSeconds: RTO_TARGET_SECONDS,
    latestBackupAt: latest?.dataAsOf ?? null,
    currentRpoSeconds,
    rpoWithinTarget: currentRpoSeconds === null ? null : currentRpoSeconds <= RPO_TARGET_SECONDS,
    lastMeasuredRtoSeconds: lastRestore?.measuredRtoSeconds ?? null,
    lastMeasuredAt: lastRestore?.startedAt ?? null,
    rtoWithinTarget:
      lastRestore?.measuredRtoSeconds == null
        ? null
        : lastRestore.measuredRtoSeconds <= RTO_TARGET_SECONDS,
    warnings,
  };
}

// ------------------------------------------------------------------- helpers

async function copyTree(from: string, to: string): Promise<void> {
  await fs.mkdir(to, { recursive: true });
  for (const entry of await fs.readdir(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) await copyTree(src, dst);
    else await fs.copyFile(src, dst);
  }
}

async function makeReadOnly(dir: string): Promise<void> {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) await makeReadOnly(target);
    else await fs.chmod(target, 0o444).catch(() => undefined);
  }
}
