import { NextResponse } from "next/server";
import { badRequest } from "@/lib/api";
import { requireUserId } from "@/lib/session";
import { assertCsrf } from "@/lib/csrf";
import { runDrill } from "@/lib/drills";
import { recoveryErrorResponse } from "@/lib/recovery-api";
import type { DrillScenario } from "@/generated/prisma/enums";

export const dynamic = "force-dynamic";
// The primary-loss scenario performs a full restore inside the request.
export const maxDuration = 300;

const SCENARIOS: DrillScenario[] = [
  "SCHEDULED_QUARTERLY",
  "PRIMARY_SERVER_LOSS",
  "KEY_SERVICE_UNAVAILABLE",
  "SOLE_ADMINISTRATOR_DEPARTED",
];

/**
 * BCP06: run a drill. The system administrator check is inside runDrill.
 * Findings are produced by the drill itself — nothing in this body can add or
 * remove one; the body supplies only the owner, due date, notes and the
 * attestations the system cannot see for itself (escrow, custodians).
 */
export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    await assertCsrf(request);
    const body = await request.json().catch(() => ({}));

    if (!SCENARIOS.includes(body.scenario)) return badRequest("Unknown drill scenario");
    if (typeof body.remediationOwnerName !== "string") {
      return badRequest("remediationOwnerName is required", "REMEDIATION_OWNER_REQUIRED");
    }
    const due = body.remediationDueAt ? new Date(body.remediationDueAt) : null;
    if (due && Number.isNaN(due.getTime())) return badRequest("remediationDueAt is not a date");

    const escrow =
      body.escrow && typeof body.escrow.retrievedByName === "string" && typeof body.escrow.keyFingerprint === "string"
        ? { retrievedByName: body.escrow.retrievedByName, keyFingerprint: body.escrow.keyFingerprint }
        : null;
    const custodians = Array.isArray(body.keyCustodianNames)
      ? (body.keyCustodianNames as unknown[]).filter((n): n is string => typeof n === "string")
      : undefined;

    const outcome = await runDrill({
      scenario: body.scenario,
      performedByUserId: userId,
      remediationOwnerName: body.remediationOwnerName,
      remediationDueAt: due,
      notes: typeof body.notes === "string" ? body.notes : null,
      backupRunId: typeof body.backupRunId === "string" ? body.backupRunId : undefined,
      escrow,
      keyCustodianNames: custodians,
      departingUserId: typeof body.departingUserId === "string" ? body.departingUserId : undefined,
    });
    return NextResponse.json({ ok: true, ...outcome });
  } catch (e) {
    return recoveryErrorResponse(e);
  }
}
