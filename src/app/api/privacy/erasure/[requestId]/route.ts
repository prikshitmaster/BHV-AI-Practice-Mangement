import { NextResponse } from "next/server";
import { badRequest, errorResponse, notFound } from "@/lib/api";
import { assertCsrf } from "@/lib/csrf";
import { requireUserId } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { actionErasureRequest, reviewErasureRequest, type ItemDecisionInput } from "@/lib/erasure";

export const dynamic = "force-dynamic";

/**
 * PRV06 review and action of one erasure request. `review` records a decision
 * and reason for every item; `action` carries out the ERASE decisions only.
 * The practice is read from the STORED request (IAM01).
 */
export async function POST(request: Request, context: { params: Promise<{ requestId: string }> }) {
  try {
    const userId = await requireUserId();
    await assertCsrf(request);
    const { requestId } = await context.params;
    const body = await request.json().catch(() => ({}));
    if (typeof body.expectedVersion !== "number") return badRequest("expectedVersion is required");

    const stored = await prisma.erasureRequest.findUnique({
      where: { id: requestId },
      select: { practiceId: true },
    });
    if (!stored) return notFound();

    if (body.action === "review") {
      if (!Array.isArray(body.decisions)) return badRequest("decisions must be a list");
      const decisions: ItemDecisionInput[] = [];
      for (const raw of body.decisions as Record<string, unknown>[]) {
        if (typeof raw?.itemId !== "string" || (raw.decision !== "ERASE" && raw.decision !== "RETAIN")) {
          return badRequest("Each decision needs an itemId and ERASE or RETAIN");
        }
        decisions.push({ itemId: raw.itemId, decision: raw.decision, reason: String(raw.reason ?? "") });
      }
      const reviewed = await reviewErasureRequest({
        actorUserId: userId, practiceId: stored.practiceId, requestId,
        expectedVersion: body.expectedVersion, decisions,
      });
      return NextResponse.json({ ok: true, state: reviewed.state, version: reviewed.version });
    }
    if (body.action === "action") {
      const done = await actionErasureRequest({
        actorUserId: userId, practiceId: stored.practiceId, requestId, expectedVersion: body.expectedVersion,
      });
      return NextResponse.json({ ok: true, state: done.state, summary: done.outcomeSummary });
    }
    return badRequest("action must be review or action");
  } catch (e) {
    return errorResponse(e);
  }
}
