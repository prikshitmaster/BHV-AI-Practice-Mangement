/**
 * Connector configuration — INT01 (PRD §31). INT02 (synchronisation) is R1.
 *
 * INT01: "Store practice, owner, purpose, environment, scope, provider,
 *  credential reference and status. Test connections without disclosing
 *  secrets. Development and production credentials are separate; rotating one
 *  practice's token cannot disrupt the other practice."
 *
 * Four mechanisms carry that sentence:
 *
 *  1. Only a REFERENCE is stored (`env:NAME` or `vault:path`). The format guard
 *     refuses anything else, so a pasted token cannot land in the database, and
 *     references to the platform's own secrets (database, encryption keys) are
 *     refused — a connector must never be a way to read those.
 *  2. `credentialRef` is unique across every practice and environment, and a
 *     reference retired by rotation can never be reused. Two practices can
 *     therefore never share a token, so rotating one touches one row only; and
 *     a development connector can never point at the production secret.
 *  3. The runtime refuses a connector whose environment is not its own — a
 *     PRODUCTION connector is never tested or used from a development build,
 *     and vice versa. The secret is not even read in that case.
 *  4. A connection test runs through a probe seam, and whatever the probe says
 *     (or throws) is scrubbed of the secret before it is returned, stored or
 *     audited. If any fragment of the secret survives, the message is withheld.
 *
 * No live external integration ships here (PROGRESS.md hard constraint): the
 * default probe proves the reference resolves, and says in words that it has
 * not contacted the remote service.
 */

import type {
  ConnectorEnvironment,
  ConnectorStatus,
  ConnectorTestResult,
} from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { recordEvent } from "@/lib/audit";
import { assertCan, resolveMembership } from "@/lib/permissions";
import { versionConflict } from "@/lib/concurrency";

export class ConnectorError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "ConnectorError";
  }
}

// ------------------------------------------------------------ environment

let runtimeOverride: ConnectorEnvironment | null = null;

/**
 * The environment THIS process runs as. A production build is always
 * PRODUCTION — APP_ENVIRONMENT may say TEST for a staging deployment, but can
 * never downgrade a production build to DEVELOPMENT.
 */
export function runtimeEnvironment(): ConnectorEnvironment {
  if (runtimeOverride) return runtimeOverride;
  const declared = process.env.APP_ENVIRONMENT?.toUpperCase();
  if (process.env.NODE_ENV === "production") {
    return declared === "TEST" ? "TEST" : "PRODUCTION";
  }
  return declared === "TEST" || declared === "PRODUCTION" ? declared : "DEVELOPMENT";
}

/** Test seam only. Refused in a production build. */
export function setRuntimeEnvironmentForTests(env: ConnectorEnvironment | null) {
  if (process.env.NODE_ENV === "production") {
    throw new ConnectorError("The runtime environment cannot be overridden in production", "REFUSED", 403);
  }
  runtimeOverride = env;
}

// ------------------------------------------------------------ references

const REF_PATTERN = /^(env:[A-Z][A-Z0-9_]{2,99}|vault:[a-z0-9][a-z0-9_./-]{2,199})$/;

/** Platform secrets no connector may reference. */
const RESERVED_ENV = new Set([
  "DATABASE_URL",
  "DIRECT_URL",
  "SHADOW_DATABASE_URL",
  "APP_ENCRYPTION_KEY",
  "BACKUP_ENCRYPTION_KEY",
  "SESSION_SECRET",
]);

export function validateCredentialRef(ref: string): string {
  const r = ref.trim();
  if (!REF_PATTERN.test(r)) {
    throw new ConnectorError(
      "Enter a credential REFERENCE such as env:SMTP_COMPANY_PROD_TOKEN or vault:bhv/company/smtp — never the secret itself.",
      "CREDENTIAL_REF_FORMAT",
    );
  }
  if (r.startsWith("env:") && RESERVED_ENV.has(r.slice(4))) {
    throw new ConnectorError(
      "That reference names a platform secret. Connectors must use a credential of their own.",
      "CREDENTIAL_REF_RESERVED",
    );
  }
  return r;
}

/** In use now, or retired by a rotation — either way unavailable. */
async function assertRefUnused(ref: string) {
  const [live, retired] = await Promise.all([
    prisma.connectorConfig.findUnique({ where: { credentialRef: ref }, select: { id: true } }),
    prisma.connectorCredentialRotation.findFirst({ where: { previousRef: ref }, select: { id: true } }),
  ]);
  if (live || retired) {
    // Deliberately does not say which practice or connector holds it.
    throw new ConnectorError(
      "This credential reference is in use, or was used before, by another connector. Each connector — per practice and per environment — needs its own credential.",
      "CREDENTIAL_REF_IN_USE",
      409,
    );
  }
}

type VaultResolver = (path: string) => Promise<string | null>;
let vaultResolver: VaultResolver | null = null;

/** Attach the firm's secret store. None is configured by default. */
export function setVaultResolver(fn: VaultResolver | null) {
  vaultResolver = fn;
}

async function resolveSecret(ref: string): Promise<{ secret: string } | { refused: string }> {
  if (ref.startsWith("env:")) {
    const v = process.env[ref.slice(4)];
    return v ? { secret: v } : { refused: `The reference ${ref} does not resolve in this environment.` };
  }
  if (!vaultResolver) return { refused: "No secret vault is configured for this deployment." };
  const v = await vaultResolver(ref.slice(6));
  return v ? { secret: v } : { refused: `The reference ${ref} does not resolve in the vault.` };
}

// ------------------------------------------------------------ probes

export type ConnectorProbe = (input: {
  provider: string;
  secret: string;
  scope: string[];
}) => Promise<{ ok: boolean; message: string }>;

const probes = new Map<string, ConnectorProbe>();

export function setConnectorProbe(provider: string, probe: ConnectorProbe | null) {
  if (probe) probes.set(provider, probe);
  else probes.delete(provider);
}

const defaultProbe: ConnectorProbe = async ({ provider }) => ({
  ok: true,
  message: `Credential reference resolves. No live probe is registered for provider "${provider}", so the remote service was not contacted.`,
});

const PROBE_TIMEOUT_MS = 10_000;
const MESSAGE_LIMIT = 500;

/**
 * Remove the secret from probe output. Replaces the secret and its common
 * encodings; if any 8-character fragment still survives, the whole message
 * is withheld rather than trusting partial redaction.
 */
export function scrubSecret(text: string, secret: string): string {
  let out = text;
  if (secret.length >= 4) {
    const forms = [secret, encodeURIComponent(secret), Buffer.from(secret).toString("base64")];
    for (const f of forms) out = out.split(f).join("[redacted]");
    const win = Math.min(8, secret.length);
    for (let i = 0; i + win <= secret.length; i++) {
      if (out.includes(secret.slice(i, i + win))) {
        return "Probe output withheld: it contained part of the credential.";
      }
    }
  }
  return out.length > MESSAGE_LIMIT ? `${out.slice(0, MESSAGE_LIMIT)}…` : out;
}

// ------------------------------------------------------------ CRUD

export type ConnectorInput = {
  name: string;
  provider: string;
  purpose: string;
  ownerUserId: string;
  environment: ConnectorEnvironment;
  scope: string[];
  credentialRef: string;
};

const ENVIRONMENTS: ConnectorEnvironment[] = ["DEVELOPMENT", "TEST", "PRODUCTION"];

function required(v: string | undefined | null, field: string) {
  const t = v?.trim();
  if (!t) throw new ConnectorError(`${field} is required`, "FIELD_REQUIRED");
  return t;
}

async function assertOwnerIsMember(ownerUserId: string, practiceId: string) {
  if (!(await resolveMembership(ownerUserId, practiceId))) {
    throw new ConnectorError("The owner must be a current member of this practice", "OWNER_NOT_MEMBER");
  }
}

/** Public shape — the secret is never part of it (it is never loaded). */
const PUBLIC_SELECT = {
  id: true,
  practiceId: true,
  name: true,
  provider: true,
  purpose: true,
  ownerUserId: true,
  environment: true,
  scope: true,
  credentialRef: true,
  credentialVersion: true,
  credentialRotatedAt: true,
  status: true,
  lastTestedAt: true,
  lastTestResult: true,
  lastTestMessage: true,
  lastTestCredentialVersion: true,
  version: true,
  createdAt: true,
  updatedAt: true,
} as const;

export async function createConnector(params: {
  actorUserId: string;
  practiceId: string;
  input: ConnectorInput;
}) {
  await assertCan(params.actorUserId, params.practiceId, "connector.manage");
  const i = params.input;
  const name = required(i.name, "Name");
  const provider = required(i.provider, "Provider").toLowerCase();
  const purpose = required(i.purpose, "Purpose");
  if (!ENVIRONMENTS.includes(i.environment)) {
    throw new ConnectorError("Choose Development, Test or Production", "FIELD_REQUIRED");
  }
  const scope = i.scope.map((s) => s.trim()).filter(Boolean);
  if (!scope.length) throw new ConnectorError("Name at least one scope the connector may use", "FIELD_REQUIRED");
  const credentialRef = validateCredentialRef(i.credentialRef ?? "");
  await assertOwnerIsMember(required(i.ownerUserId, "Owner"), params.practiceId);
  await assertRefUnused(credentialRef);

  let row;
  try {
    row = await prisma.connectorConfig.create({
      data: {
        practiceId: params.practiceId,
        name,
        provider,
        purpose,
        ownerUserId: i.ownerUserId,
        environment: i.environment,
        scope,
        credentialRef,
        createdByUserId: params.actorUserId,
      },
      select: PUBLIC_SELECT,
    });
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") {
      throw new ConnectorError(
        "A connector with this name already exists for this environment, or the credential reference is taken.",
        "CONNECTOR_DUPLICATE",
        409,
      );
    }
    throw e;
  }

  await recordEvent({
    action: "CONNECTOR_CREATED",
    targetType: "ConnectorConfig",
    targetId: row.id,
    targetVersion: row.version,
    result: "SUCCESS",
    actorUserId: params.actorUserId,
    practiceId: params.practiceId,
    afterMeta: { name, provider, environment: i.environment, credentialRef },
  });
  return row;
}

export async function listConnectors(actorUserId: string, practiceId: string) {
  await assertCan(actorUserId, practiceId, "connector.manage");
  return prisma.connectorConfig.findMany({
    where: { practiceId },
    select: PUBLIC_SELECT,
    orderBy: [{ environment: "asc" }, { name: "asc" }],
  });
}

export async function getConnector(actorUserId: string, practiceId: string, connectorId: string) {
  await assertCan(actorUserId, practiceId, "connector.manage");
  const row = await prisma.connectorConfig.findFirst({
    where: { id: connectorId, practiceId },
    select: {
      ...PUBLIC_SELECT,
      rotations: { orderBy: { rotatedAt: "desc" }, take: 20 },
      testRuns: { orderBy: { testedAt: "desc" }, take: 20 },
    },
  });
  if (!row) throw new ConnectorError("Not found", "NOT_FOUND", 404);
  return row;
}

async function loadScoped(practiceId: string, connectorId: string) {
  const row = await prisma.connectorConfig.findFirst({ where: { id: connectorId, practiceId } });
  if (!row) throw new ConnectorError("Not found", "NOT_FOUND", 404);
  return row;
}

async function conflict(connectorId: string, expectedVersion: number) {
  const row = await prisma.connectorConfig.findUnique({ where: { id: connectorId }, select: { version: true } });
  return versionConflict({
    subjectType: "ConnectorConfig",
    subjectId: connectorId,
    expectedVersion,
    currentVersion: row?.version ?? -1,
  });
}

/**
 * Amend purpose/owner/scope or change status, version-checked (API02).
 * ACTIVE requires a PASSED test on the CURRENT credential version — a
 * connector cannot be switched on against a credential nobody has proven.
 */
export async function updateConnector(params: {
  actorUserId: string;
  practiceId: string;
  connectorId: string;
  expectedVersion: number;
  purpose?: string;
  ownerUserId?: string;
  scope?: string[];
  status?: ConnectorStatus;
}) {
  await assertCan(params.actorUserId, params.practiceId, "connector.manage");
  const current = await loadScoped(params.practiceId, params.connectorId);
  if (current.status === "RETIRED") {
    throw new ConnectorError("A retired connector cannot be changed", "CONNECTOR_RETIRED", 409);
  }
  if (params.ownerUserId) await assertOwnerIsMember(params.ownerUserId, params.practiceId);
  const scope = params.scope?.map((s) => s.trim()).filter(Boolean);
  if (scope && !scope.length) throw new ConnectorError("Name at least one scope", "FIELD_REQUIRED");
  if (params.status === "ACTIVE") {
    if (
      current.lastTestResult !== "PASSED" ||
      current.lastTestCredentialVersion !== current.credentialVersion
    ) {
      throw new ConnectorError(
        "Run a passing connection test on the current credential before activating",
        "TEST_REQUIRED",
        409,
      );
    }
  }

  const { count } = await prisma.connectorConfig.updateMany({
    where: { id: current.id, practiceId: params.practiceId, version: params.expectedVersion },
    data: {
      ...(params.purpose !== undefined ? { purpose: required(params.purpose, "Purpose") } : {}),
      ...(params.ownerUserId ? { ownerUserId: params.ownerUserId } : {}),
      ...(scope ? { scope } : {}),
      ...(params.status ? { status: params.status } : {}),
      version: { increment: 1 },
    },
  });
  if (count !== 1) throw await conflict(current.id, params.expectedVersion);

  await recordEvent({
    action: "CONNECTOR_UPDATED",
    targetType: "ConnectorConfig",
    targetId: current.id,
    targetVersion: params.expectedVersion + 1,
    result: "SUCCESS",
    actorUserId: params.actorUserId,
    practiceId: params.practiceId,
    beforeMeta: { status: current.status },
    afterMeta: { status: params.status ?? current.status },
  });
  return prisma.connectorConfig.findUniqueOrThrow({ where: { id: current.id }, select: PUBLIC_SELECT });
}

/**
 * Rotate to a NEW reference. Touches exactly this connector's row; the old
 * reference is retired for good. The last test no longer counts, because it
 * proved a different credential.
 */
export async function rotateCredential(params: {
  actorUserId: string;
  practiceId: string;
  connectorId: string;
  expectedVersion: number;
  newCredentialRef: string;
  reason: string;
}) {
  await assertCan(params.actorUserId, params.practiceId, "connector.manage");
  const reason = required(params.reason, "Reason for rotation");
  const current = await loadScoped(params.practiceId, params.connectorId);
  if (current.status === "RETIRED") {
    throw new ConnectorError("A retired connector cannot be rotated", "CONNECTOR_RETIRED", 409);
  }
  const newRef = validateCredentialRef(params.newCredentialRef ?? "");
  if (newRef === current.credentialRef) {
    throw new ConnectorError("Rotation needs a new credential reference", "CREDENTIAL_REF_UNCHANGED");
  }
  await assertRefUnused(newRef);

  const nextCredentialVersion = current.credentialVersion + 1;
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.connectorConfig.updateMany({
      where: { id: current.id, practiceId: params.practiceId, version: params.expectedVersion },
      data: {
        credentialRef: newRef,
        credentialVersion: nextCredentialVersion,
        credentialRotatedAt: new Date(),
        lastTestResult: null,
        lastTestMessage: null,
        lastTestCredentialVersion: null,
        version: { increment: 1 },
      },
    });
    if (count !== 1) throw await conflict(current.id, params.expectedVersion);
    await tx.connectorCredentialRotation.create({
      data: {
        connectorId: current.id,
        practiceId: params.practiceId,
        previousRef: current.credentialRef,
        newRef,
        credentialVersion: nextCredentialVersion,
        reason,
        rotatedByUserId: params.actorUserId,
      },
    });
  });

  await recordEvent({
    action: "CONNECTOR_CREDENTIAL_ROTATED",
    targetType: "ConnectorConfig",
    targetId: current.id,
    targetVersion: params.expectedVersion + 1,
    result: "SUCCESS",
    actorUserId: params.actorUserId,
    practiceId: params.practiceId,
    reason,
    beforeMeta: { credentialRef: current.credentialRef, credentialVersion: current.credentialVersion },
    afterMeta: { credentialRef: newRef, credentialVersion: nextCredentialVersion },
  });
  return prisma.connectorConfig.findUniqueOrThrow({ where: { id: current.id }, select: PUBLIC_SELECT });
}

// ------------------------------------------------------------ testing

export type ConnectorTestOutcome = {
  result: ConnectorTestResult;
  message: string;
  runtimeEnvironment: ConnectorEnvironment;
  credentialVersion: number;
};

/**
 * INT01 "Test connections without disclosing secrets." The returned, stored
 * and audited message has always been through `scrubSecret`.
 */
export async function testConnector(params: {
  actorUserId: string;
  practiceId: string;
  connectorId: string;
}): Promise<ConnectorTestOutcome> {
  await assertCan(params.actorUserId, params.practiceId, "connector.manage");
  const c = await loadScoped(params.practiceId, params.connectorId);
  const runtime = runtimeEnvironment();
  const started = Date.now();

  let result: ConnectorTestResult;
  let message: string;

  if (c.status === "RETIRED") {
    result = "REFUSED";
    message = "This connector is retired.";
  } else if (c.environment !== runtime) {
    // The secret is not read at all: a production credential never enters a
    // development process, and a development credential never serves production.
    result = "REFUSED";
    message = `This is a ${c.environment} connector and this system is running as ${runtime}. Test it from a ${c.environment} deployment.`;
  } else {
    const resolved = await resolveSecret(c.credentialRef);
    if ("refused" in resolved) {
      result = "REFUSED";
      message = resolved.refused;
    } else {
      const probe = probes.get(c.provider) ?? defaultProbe;
      let raw: { ok: boolean; message: string };
      try {
        raw = await Promise.race([
          probe({ provider: c.provider, secret: resolved.secret, scope: c.scope }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`Probe timed out after ${PROBE_TIMEOUT_MS / 1000} s`)), PROBE_TIMEOUT_MS),
          ),
        ]);
      } catch (e) {
        raw = { ok: false, message: e instanceof Error ? e.message : String(e) };
      }
      result = raw.ok ? "PASSED" : "FAILED";
      message = scrubSecret(String(raw.message ?? ""), resolved.secret);
    }
  }

  const durationMs = Date.now() - started;
  const now = new Date();
  await prisma.$transaction([
    prisma.connectorTestRun.create({
      data: {
        connectorId: c.id,
        practiceId: c.practiceId,
        result,
        message,
        credentialVersion: c.credentialVersion,
        runtimeEnvironment: runtime,
        durationMs,
        testedByUserId: params.actorUserId,
      },
    }),
    // Test outcome is operational state, not a configuration edit, so it does
    // not bump `version` — a test must not make someone's open form stale.
    prisma.connectorConfig.updateMany({
      where: { id: c.id, practiceId: c.practiceId, credentialVersion: c.credentialVersion },
      data: {
        lastTestedAt: now,
        lastTestResult: result,
        lastTestMessage: message,
        lastTestCredentialVersion: c.credentialVersion,
      },
    }),
  ]);

  await recordEvent({
    action: "CONNECTOR_TESTED",
    targetType: "ConnectorConfig",
    targetId: c.id,
    targetVersion: c.version,
    result: result === "PASSED" ? "SUCCESS" : "FAILURE",
    actorUserId: params.actorUserId,
    practiceId: c.practiceId,
    afterMeta: { result, message, runtime, credentialVersion: c.credentialVersion },
  });

  return { result, message, runtimeEnvironment: runtime, credentialVersion: c.credentialVersion };
}

/**
 * For future connector code (R1/R2): the ONLY way to obtain a connector's
 * secret. Refuses a connector that is not ACTIVE or not of this runtime's
 * environment. Never call this from a route that returns its value.
 */
export async function resolveConnectorCredential(practiceId: string, connectorId: string): Promise<string> {
  const c = await loadScoped(practiceId, connectorId);
  if (c.status !== "ACTIVE") throw new ConnectorError("Connector is not active", "CONNECTOR_INACTIVE", 409);
  if (c.environment !== runtimeEnvironment()) {
    throw new ConnectorError("Connector environment does not match this runtime", "ENVIRONMENT_MISMATCH", 409);
  }
  const r = await resolveSecret(c.credentialRef);
  if ("refused" in r) throw new ConnectorError(r.refused, "CREDENTIAL_UNRESOLVED", 409);
  return r.secret;
}
