import { NextResponse } from "next/server";
import { badRequest, errorResponse } from "@/lib/api";
import { assertCsrf } from "@/lib/csrf";
import { requireUserId } from "@/lib/session";
import { listRegulatoryRequirements, recordRegulatoryRequirement } from "@/lib/privacy-register";
import type { RegulatoryState } from "@/generated/prisma/enums";

export const dynamic = "force-dynamic";

const STATES: RegulatoryState[] = ["ENACTED", "NOTIFIED", "PROSPECTIVE", "OPERATIONAL", "SUPERSEDED"];

function optionalDate(v: unknown): Date | null | "bad" {
  if (v === undefined || v === null || v === "") return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? "bad" : d;
}

/** PRV02: this practice's regulatory register with each requirement's history. */
export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    const practiceId = new URL(request.url).searchParams.get("practiceId");
    if (!practiceId) return badRequest("practiceId is required");
    return NextResponse.json({ requirements: await listRegulatoryRequirements(userId, practiceId) });
  } catch (e) {
    return errorResponse(e);
  }
}

/** PRV02: record a requirement. The honesty rules on state live in the library. */
export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    await assertCsrf(request);
    const body = await request.json().catch(() => ({}));
    if (typeof body.practiceId !== "string") return badRequest("practiceId is required");
    if (!STATES.includes(body.state)) return badRequest("Unknown regulatory state");
    const sourceDate = optionalDate(body.sourceDate);
    const effectiveFrom = optionalDate(body.effectiveFrom);
    if (sourceDate === null || sourceDate === "bad") return badRequest("sourceDate is required");
    if (effectiveFrom === "bad") return badRequest("effectiveFrom is not a date");
    const row = await recordRegulatoryRequirement({
      actorUserId: userId,
      practiceId: body.practiceId,
      reason: String(body.reason ?? ""),
      input: {
        code: String(body.code ?? ""),
        title: String(body.title ?? ""),
        instrument: String(body.instrument ?? ""),
        state: body.state,
        sourceReference: String(body.sourceReference ?? ""),
        sourceDate,
        effectiveFrom,
        effectiveRule: String(body.effectiveRule ?? ""),
        supersededByCode: typeof body.supersededByCode === "string" ? body.supersededByCode : null,
      },
    });
    return NextResponse.json({ ok: true, id: row.id }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
