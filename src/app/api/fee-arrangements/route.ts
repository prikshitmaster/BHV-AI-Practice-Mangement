import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { assertCsrf } from "@/lib/csrf";
import { requireUserId } from "@/lib/session";
import { practiceScopeFilter } from "@/lib/practice-scope";
import { prisma } from "@/lib/prisma";
import { createFeeArrangement } from "@/lib/fees";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    const url = new URL(request.url);
    const scope = await practiceScopeFilter(userId, url.searchParams.get("practiceId") ?? undefined);
    const engagementId = url.searchParams.get("engagementId") ?? undefined;

    const arrangements = await prisma.feeArrangement.findMany({
      where: { ...scope, ...(engagementId ? { engagementId } : {}) },
      orderBy: [{ engagementId: "asc" }, { revisionNumber: "desc" }],
      take: 100,
    });

    return NextResponse.json({
      arrangements: arrangements.map((a) => ({
        id: a.id,
        engagementId: a.engagementId,
        basis: a.basis,
        status: a.status,
        currency: a.currency,
        agreedAmount: a.agreedAmount?.toFixed(2) ?? null,
        agreedRateAmount: a.agreedRateAmount?.toFixed(2) ?? null,
        agreedRateUnit: a.agreedRateUnit,
        taxTreatment: a.taxTreatment,
        revisionNumber: a.revisionNumber,
        supersededAt: a.supersededAt,
        version: a.version,
      })),
    });
  } catch (e) {
    return errorResponse(e);
  }
}

/**
 * FIN01. The pricing guard lives in the library, not here, so it applies
 * equally to this route, to a screen action and to a future import — a rate
 * cannot become optional by arriving through a different door.
 */
export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    await assertCsrf(request);

    const body = await request.json();
    const practiceId = String(body.practiceId ?? "").trim();
    const engagementId = String(body.engagementId ?? "").trim();
    const basis = String(body.basis ?? "").trim();
    const taxTreatment = String(body.taxTreatment ?? "").trim();

    if (!practiceId || !engagementId || !basis || !taxTreatment) {
      return NextResponse.json(
        {
          error: "practiceId, engagementId, basis and taxTreatment are required",
          code: "BAD_REQUEST",
        },
        { status: 400 },
      );
    }

    const arrangement = await createFeeArrangement({
      userId,
      practiceId,
      engagementId,
      basis: basis as never,
      agreedAmount: body.agreedAmount === undefined ? undefined : Number(body.agreedAmount),
      agreedRateAmount:
        body.agreedRateAmount === undefined ? undefined : Number(body.agreedRateAmount),
      agreedRateUnit: body.agreedRateUnit ? String(body.agreedRateUnit) : undefined,
      recurrenceLabel: body.recurrenceLabel ? String(body.recurrenceLabel) : undefined,
      taxTreatment,
      taxRatePercent: body.taxRatePercent === undefined ? undefined : Number(body.taxRatePercent),
      effectiveFrom: body.effectiveFrom ? new Date(body.effectiveFrom) : new Date(),
      effectiveTo: body.effectiveTo ? new Date(body.effectiveTo) : undefined,
    });

    return NextResponse.json({
      ok: true,
      arrangementId: arrangement.id,
      version: arrangement.version,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
