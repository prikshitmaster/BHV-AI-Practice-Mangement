import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/session";
import { assertSystemAdministrator } from "@/lib/continuity";
import { recoveryOverview } from "@/lib/recovery-overview";
import { recoveryErrorResponse } from "@/lib/recovery-api";

export const dynamic = "force-dynamic";

/** BCP02/BCP06: measured posture, recent backups/restores, drill cadence and the production gate. */
export async function GET() {
  try {
    const userId = await requireUserId();
    await assertSystemAdministrator(userId);
    return NextResponse.json(await recoveryOverview());
  } catch (e) {
    return recoveryErrorResponse(e);
  }
}
