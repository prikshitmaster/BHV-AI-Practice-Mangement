import { NextResponse } from "next/server";
import { badRequest, errorResponse } from "@/lib/api";
import { assertCsrf } from "@/lib/csrf";
import { requireUserId } from "@/lib/session";
import { practiceScopeFilter } from "@/lib/practice-scope";
import { prisma } from "@/lib/prisma";
import { recordReceipt } from "@/lib/receipts";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    const requested = new URL(request.url).searchParams.get("practiceId") ?? undefined;
    const scope = await practiceScopeFilter(userId, requested);

    const receipts = await prisma.receipt.findMany({
      where: { ...scope, archivedAt: null },
      orderBy: { receivedAt: "desc" },
      take: 100,
      include: { bankAccount: { select: { label: true } } },
    });

    return NextResponse.json({
      receipts: receipts.map((r) => ({
        id: r.id,
        amount: r.amount.toFixed(2),
        currency: r.currency,
        receivedAt: r.receivedAt,
        method: r.method,
        reference: r.reference,
        bankAccount: r.bankAccount?.label ?? null,
      })),
    });
  } catch (e) {
    return errorResponse(e);
  }
}

/** FIN04: a receipt names the bank account the money actually landed in. */
export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    await assertCsrf(request);

    const body = await request.json();
    const practiceId = String(body.practiceId ?? "").trim();
    const clientRelationshipId = String(body.clientRelationshipId ?? "").trim();
    const bankAccountId = String(body.bankAccountId ?? "").trim();
    const amount = Number(body.amount);

    if (!practiceId || !clientRelationshipId || !bankAccountId || !Number.isFinite(amount)) {
      return badRequest("practiceId, clientRelationshipId, bankAccountId and amount are required", "BAD_REQUEST");
    }

    const receipt = await recordReceipt({
      userId,
      practiceId,
      clientRelationshipId,
      bankAccountId,
      amount,
      receivedAt: body.receivedAt ? new Date(body.receivedAt) : new Date(),
      method: String(body.method ?? "NEFT"),
      reference: body.reference ? String(body.reference) : undefined,
    });

    return NextResponse.json({ ok: true, receiptId: receipt.id });
  } catch (e) {
    return errorResponse(e);
  }
}
