import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/session";
import { assertCsrf } from "@/lib/csrf";
import { assertSystemAdministrator } from "@/lib/continuity";
import { runBackup } from "@/lib/backup";
import { recordEvent } from "@/lib/audit";
import { recoveryErrorResponse } from "@/lib/recovery-api";

export const dynamic = "force-dynamic";
// A full backup reads every table and every object; give it room.
export const maxDuration = 300;

/**
 * BCP01: take a backup now. The body may claim an immutable/offline copy only
 * with `immutableCopy: true`, which the engine records as a claim — BCP01's
 * "where feasible" is the operator's to state, not the app's to assume.
 */
export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    await assertCsrf(request);
    await assertSystemAdministrator(userId);
    const body = await request.json().catch(() => ({}));

    const result = await runBackup({
      createdByUserId: userId,
      includeObjectPayloads: true,
      immutableCopy: body.immutableCopy === true,
    });
    await recordEvent({
      action: "BACKUP_RUN",
      targetType: "BackupRun",
      targetId: result.backupRunId,
      result: "SUCCESS",
      actorUserId: userId,
      afterMeta: { artifacts: result.artifacts.length, gaps: result.gaps.length, manifestSha256: result.manifestSha256 },
    });

    return NextResponse.json({
      ok: true,
      backupRunId: result.backupRunId,
      dataAsOf: result.dataAsOf,
      offsite: Boolean(result.offsiteDirectory),
      artifacts: result.artifacts.length,
      gaps: result.gaps,
    });
  } catch (e) {
    return recoveryErrorResponse(e);
  }
}
