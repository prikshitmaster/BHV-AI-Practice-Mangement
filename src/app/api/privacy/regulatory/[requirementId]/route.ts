import { NextResponse } from "next/server";
import { badRequest, errorResponse, notFound } from "@/lib/api";
import { assertCsrf } from "@/lib/csrf";
import { requireUserId } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { changeRegulatoryState } from "@/lib/privacy-register";
import type { RegulatoryState } from "@/generated/prisma/enums";

export const dynamic = "force-dynamic";

const STATES: RegulatoryState[] = ["ENACTED", "NOTIFIED", "PROSPECTIVE", "OPERATIONAL", "SUPERSEDED"];

/** PRV02: move a requirement to a new legal state; the history is appended. */
export async function POST(request: Request, context: { params: Promise<{ requirementId: string }> }) {
  try {
    const userId = await requireUserId();
    await assertCsrf(request);
    const { requirementId } = await context.params;
    const body = await request.json().catch(() => ({}));
    if (typeof body.expectedVersion !== "number") return badRequest("expectedVersion is required");
    if (!STATES.includes(body.toState)) return badRequest("Unknown regulatory state");
    const sourceDate = new Date(String(body.sourceDate ?? ""));
    if (Number.isNaN(sourceDate.getTime())) return badRequest("sourceDate is required");
    let effectiveFrom: Date | null | undefined;
    if (body.effectiveFrom !== undefined && body.effectiveFrom !== "") {
      effectiveFrom = body.effectiveFrom === null ? null : new Date(String(body.effectiveFrom));
      if (effectiveFrom && Number.isNaN(effectiveFrom.getTime())) return badRequest("effectiveFrom is not a date");
    }

    const stored = await prisma.regulatoryRequirement.findUnique({
      where: { id: requirementId },
      select: { practiceId: true },
    });
    if (!stored) return notFound();

    const row = await changeRegulatoryState({
      actorUserId: userId,
      practiceId: stored.practiceId,
      requirementId,
      expectedVersion: body.expectedVersion,
      toState: body.toState,
      sourceReference: String(body.sourceReference ?? ""),
      sourceDate,
      effectiveFrom,
      supersededByCode: typeof body.supersededByCode === "string" ? body.supersededByCode : null,
      reason: String(body.reason ?? ""),
    });
    return NextResponse.json({ ok: true, version: row.version, state: row.state });
  } catch (e) {
    return errorResponse(e);
  }
}
