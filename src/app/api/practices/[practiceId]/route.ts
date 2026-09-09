import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { assertPracticeAccess } from "@/lib/practice-scope";
import { requireUserId } from "@/lib/session";
import { errorResponse } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * ORG acceptance path 1 — direct URL access.
 * Guessing or pasting another practice's id must return 404, not its record.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ practiceId: string }> },
) {
  try {
    const { practiceId } = await params;
    const userId = await requireUserId();

    await assertPracticeAccess(userId, practiceId);

    const practice = await prisma.practice.findUnique({
      where: { id: practiceId },
      select: {
        id: true,
        name: true,
        registeredDisplayName: true,
        constitution: true,
        documentNamespace: true,
        bankAccounts: {
          where: { archivedAt: null },
          select: { id: true, label: true, bankName: true, accountNumber: true, ifsc: true },
        },
        invoiceSeries: {
          where: { archivedAt: null },
          select: { id: true, code: true, fiscalPeriod: true, nextNumber: true },
        },
      },
    });

    if (!practice) return NextResponse.json({ error: "Not found" }, { status: 404 });

    return NextResponse.json({ practice });
  } catch (e) {
    return errorResponse(e);
  }
}
