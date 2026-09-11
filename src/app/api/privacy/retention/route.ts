import { NextResponse } from "next/server";
import { badRequest, errorResponse } from "@/lib/api";
import { assertCsrf } from "@/lib/csrf";
import { requireUserId } from "@/lib/session";
import { assertCan } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { createRetentionPolicy, retentionDecision } from "@/lib/retention";
import type { RetentionCoverage, RetentionTrigger } from "@/generated/prisma/enums";

export const dynamic = "force-dynamic";

const TRIGGERS: RetentionTrigger[] = [
  "CREATED",
  "ENGAGEMENT_CLOSED",
  "FINANCIAL_YEAR_END",
  "RELATIONSHIP_ENDED",
  "LAST_ACTIVITY",
];
const COVERAGE: RetentionCoverage[] = ["ORIGINAL", "DERIVATIVE", "EMAIL", "AI_OUTPUT", "ICT_LOG", "BACKUP"];

/**
 * PRV06: this practice's schedules, or — with `recordClass` and
 * `triggerDate` — the decision the schedule gives for one record.
 */
export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    const url = new URL(request.url);
    const practiceId = url.searchParams.get("practiceId");
    if (!practiceId) return badRequest("practiceId is required");
    await assertCan(userId, practiceId, "privacy.manage");

    const recordClass = url.searchParams.get("recordClass");
    if (recordClass) {
      const triggerDate = new Date(url.searchParams.get("triggerDate") ?? "");
      if (Number.isNaN(triggerDate.getTime())) return badRequest("triggerDate is required");
      return NextResponse.json({ decision: await retentionDecision({ practiceId, recordClass, triggerDate }) });
    }
    const policies = await prisma.retentionPolicy.findMany({
      where: { practiceId },
      orderBy: [{ recordClass: "asc" }, { direction: "asc" }, { effectiveFrom: "asc" }],
    });
    return NextResponse.json({ policies });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    await assertCsrf(request);
    const body = await request.json().catch(() => ({}));
    if (typeof body.practiceId !== "string") return badRequest("practiceId is required");
    if (body.direction !== "RETAIN_AT_LEAST" && body.direction !== "DELETE_AFTER") {
      return badRequest("direction must be RETAIN_AT_LEAST or DELETE_AFTER");
    }
    if (!TRIGGERS.includes(body.trigger)) return badRequest("Unknown trigger");
    const covers = Array.isArray(body.covers) ? body.covers : [];
    if (covers.some((c: unknown) => !COVERAGE.includes(c as RetentionCoverage))) {
      return badRequest("Unknown coverage");
    }
    const effectiveFrom = new Date(String(body.effectiveFrom ?? ""));
    if (Number.isNaN(effectiveFrom.getTime())) return badRequest("effectiveFrom is required");

    const row = await createRetentionPolicy({
      actorUserId: userId,
      practiceId: body.practiceId,
      input: {
        recordClass: String(body.recordClass ?? ""),
        direction: body.direction,
        trigger: body.trigger,
        retainYears: typeof body.retainYears === "number" ? body.retainYears : 0,
        retainDays: typeof body.retainDays === "number" ? body.retainDays : null,
        basis: String(body.basis ?? ""),
        covers,
        effectiveFrom,
        regulatoryRequirementCode:
          typeof body.regulatoryRequirementCode === "string" && body.regulatoryRequirementCode
            ? body.regulatoryRequirementCode
            : null,
      },
    });
    return NextResponse.json({ ok: true, id: row.id }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
