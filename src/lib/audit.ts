/**
 * Audit trail — SEC04 (PRD §35).
 *
 * "Capture actor, practice, action, record ID, exact version, time, result and
 *  reason for sensitive changes, grants, exports, approvals and secret
 *  reveals. Keep audit events append only for the application identity, with
 *  independently protected copies / integrity checks. Do not place passwords
 *  or full document bodies in logs."
 *
 * Append-only and the hash chain are enforced by database triggers (see
 * migration 20260909040000). This module is the single writing path, and it
 * strips anything that must never reach a log before the row is created.
 */

import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { currentCorrelationId } from "@/lib/correlation";

/** Actions treated as sensitive; every one of these MUST be audited. */
export const SENSITIVE_ACTIONS = [
  "APPROVAL_RECORDED",
  "INVOICE_ISSUED",
  "FILING_SUBMITTED",
  "DOCUMENT_RELEASED",
  "OBJECT_LINK_ISSUED",
  "EXPORT_RUN",
  "SECRET_REVEALED",
  "PERMISSION_GRANTED",
  "PERMISSION_REVOKED",
  "ROLE_CHANGED",
  "USER_SUSPENDED",
  "CROSS_PRACTICE_SHARE_GRANTED",
  "CROSS_PRACTICE_SHARE_REVOKED",
  "RECOVERY_COMPLETED_MFA_RESET",
  "RECOVERY_COMPLETED_PASSWORD_RESET",
] as const;

export type AuditInput = {
  action: string;
  targetType: string;
  targetId: string;
  /** SEC04: the exact version the action applied to. */
  targetVersion?: number | null;
  result: "SUCCESS" | "FAILURE";
  actorUserId?: string | null;
  actorServiceIdentity?: string | null;
  tenantId?: string | null;
  practiceId?: string | null;
  reason?: string | null;
  correlationId?: string | null;
  beforeMeta?: unknown;
  afterMeta?: unknown;
  ruleVersion?: string | null;
  modelVersion?: string | null;
  errorMessage?: string | null;
};

/**
 * Keys whose values must never be written to the audit trail, and a size cap
 * so a full document body cannot be smuggled through a metadata field.
 */
const FORBIDDEN_KEY = /password|passphrase|secret|privatekey|recoverycode|apikey|totp|token|credential|pin/i;
const MAX_META_STRING = 512;

/** Replaces secret-looking values and truncates anything document-sized. */
export function sanitiseMeta(value: unknown, depth = 0): unknown {
  if (value == null) return value;
  if (depth > 6) return "[truncated: too deep]";

  if (typeof value === "string") {
    return value.length > MAX_META_STRING
      ? `${value.slice(0, MAX_META_STRING)}…[truncated ${value.length} chars]`
      : value;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;

  if (Array.isArray(value)) {
    const capped = value.slice(0, 50).map((v) => sanitiseMeta(v, depth + 1));
    if (value.length > 50) capped.push(`[truncated ${value.length - 50} more]`);
    return capped;
  }

  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      // Keep the key so the shape is auditable, drop the value.
      out[k] = FORBIDDEN_KEY.test(k) ? "[redacted]" : sanitiseMeta(v, depth + 1);
    }
    return out;
  }

  return String(value);
}

/** The single path for writing an audit event. */
export async function recordEvent(input: AuditInput) {
  return prisma.event.create({
    data: {
      tenantId: input.tenantId ?? null,
      practiceId: input.practiceId ?? null,
      actorUserId: input.actorUserId ?? null,
      actorServiceIdentity: input.actorServiceIdentity ?? null,
      targetType: input.targetType,
      targetId: input.targetId,
      targetVersion: input.targetVersion ?? null,
      action: input.action,
      // API01: an event written during a request inherits that request's
      // correlation ID automatically, so the audit trail and the response the
      // caller saw can be tied together without every call site remembering.
      correlationId: input.correlationId ?? currentCorrelationId(),
      beforeMeta: sanitiseMeta(input.beforeMeta) as never,
      afterMeta: sanitiseMeta(input.afterMeta) as never,
      ruleVersion: input.ruleVersion ?? null,
      modelVersion: input.modelVersion ?? null,
      result: input.result,
      errorMessage: input.errorMessage ?? null,
      reason: input.reason ?? null,
    },
  });
}

export type ChainVerification = {
  ok: boolean;
  checked: number;
  firstBadSequence: bigint | null;
  problem: string | null;
};

/**
 * SEC04 integrity check: recompute the chain and confirm nothing has been
 * inserted, edited or removed. Run it as a scheduled job and after any
 * restore drill (BCP03).
 *
 * Mirrors bhv_event_payload() in the migration exactly — if the two ever
 * diverge this returns a mismatch, which is the safe direction to fail.
 */
export async function verifyAuditChain(limit?: number): Promise<ChainVerification> {
  const events = await prisma.event.findMany({
    orderBy: { sequence: "asc" },
    take: limit,
    select: {
      sequence: true, id: true, tenantId: true, practiceId: true,
      actorUserId: true, actorServiceIdentity: true, targetType: true,
      targetId: true, targetVersion: true, action: true, result: true,
      reason: true, createdAt: true, previousHash: true, hash: true,
    },
  });

  let prev: string | null = null;

  for (const e of events) {
    if (e.previousHash !== prev) {
      return {
        ok: false,
        checked: events.length,
        firstBadSequence: e.sequence,
        problem: `previousHash does not match the preceding row's hash — a row was inserted or removed`,
      };
    }

    const payload = [
      e.id ?? "",
      e.tenantId ?? "",
      e.practiceId ?? "",
      e.actorUserId ?? "",
      e.actorServiceIdentity ?? "",
      e.targetType ?? "",
      e.targetId ?? "",
      e.targetVersion?.toString() ?? "",
      e.action ?? "",
      e.result ?? "",
      e.reason ?? "",
      pgTimestamp(e.createdAt),
      prev ?? "GENESIS",
    ].join("|");

    const expected = createHash("sha256").update(payload).digest("hex");

    if (expected !== e.hash) {
      return {
        ok: false,
        checked: events.length,
        firstBadSequence: e.sequence,
        problem: "row contents do not match their recorded hash — the row was altered",
      };
    }

    prev = e.hash;
  }

  return { ok: true, checked: events.length, firstBadSequence: null, problem: null };
}

/**
 * Render a timestamp the way Postgres casts `timestamp(3)` to text, since the
 * trigger hashes `NEW."createdAt"::text`: `YYYY-MM-DD HH:MM:SS[.mmm]`, with
 * trailing zeros in the fractional part dropped and the point omitted at .000.
 */
function pgTimestamp(d: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  const base =
    `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ` +
    `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;

  const ms = d.getUTCMilliseconds();
  if (ms === 0) return base;

  return `${base}.${p(ms, 3).replace(/0+$/, "")}`;
}
