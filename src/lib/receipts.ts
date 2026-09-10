/**
 * Receipts and allocations — FIN04 (PRD §25).
 *
 *   "Record receipts against the correct bank account and invoice, including
 *    part payments, advances, deductions / TDS credits, refunds and write
 *    offs. Separate cash received from tax deducted and credit notes. Prevent
 *    over allocation and preserve reconciliation adjustments."
 *
 * The acceptance evidence is one sentence: "Allocate a part payment and TDS
 * deduction; cash, credited tax and balance remain distinct." That is the
 * whole design. A ₹100 invoice settled by ₹90 cash and ₹10 TDS is NOT a ₹100
 * payment — the client banked ₹90 with the practice and handed ₹10 to the tax
 * authority on the practice's behalf, and the practice has to claim that ₹10
 * back with a certificate. Netting them into one figure loses the fact that
 * makes the ₹10 recoverable, so they are separate rows with separate kinds and
 * `settlementOf()` reports them separately, never summed into "received".
 *
 * Over-allocation is refused by re-reading the live allocations inside the
 * same transaction as the write. Checking the balance before the transaction
 * and trusting it afterwards is how two concurrent allocations each pass and
 * together over-allocate.
 *
 * Nothing here deletes or edits an allocation. FIN04 says "preserve
 * reconciliation adjustments", so a mistake is REVERSED by a row pointing at
 * the row it corrects; both stay visible to whoever reconciles.
 */

import { Prisma } from "@/generated/prisma/client";
import type { AllocationKind } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { recordEvent } from "@/lib/audit";
import { assertCan } from "@/lib/permissions";

export class ReceiptError extends Error {
  readonly status = 409;
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "ReceiptError";
  }
}

/** Kinds that represent money the practice actually banked. */
const CASH_KINDS: AllocationKind[] = ["PAYMENT", "ADVANCE"];

function money(value: number | Prisma.Decimal): string {
  return new Prisma.Decimal(value).toFixed(2);
}

// ---------------------------------------------------------------- FIN04 receipt

export async function recordReceipt(params: {
  userId: string;
  practiceId: string;
  clientRelationshipId: string;
  bankAccountId: string;
  amount: number;
  receivedAt: Date;
  method: string;
  reference?: string;
  currency?: string;
}) {
  await assertCan(params.userId, params.practiceId, "invoice.draft");

  if (params.amount <= 0) {
    throw new ReceiptError("A receipt must be for a positive amount.", "INVALID_AMOUNT");
  }

  const relationship = await prisma.clientRelationship.findFirst({
    where: { id: params.clientRelationshipId, practiceId: params.practiceId },
    select: { id: true },
  });
  if (!relationship) {
    throw new ReceiptError("No such client in this practice.", "CLIENT_NOT_FOUND");
  }

  // FIN04 "against the correct bank account", and ORG02: the account must
  // belong to THIS practice and be live on the day the money arrived. A
  // receipt posted to a closed account, or to the other firm's account, is
  // precisely the reconciliation break this prevents.
  const account = await prisma.practiceBankAccount.findFirst({
    where: {
      id: params.bankAccountId,
      practiceId: params.practiceId,
      archivedAt: null,
      effectiveFrom: { lte: params.receivedAt },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: params.receivedAt } }],
    },
    select: { id: true, verifiedAt: true },
  });
  if (!account) {
    throw new ReceiptError(
      "No bank account of this practice was in effect for that date.",
      "BANK_ACCOUNT_NOT_FOUND",
    );
  }
  if (!account.verifiedAt) {
    throw new ReceiptError(
      "That bank account has not been verified; verify it before posting receipts to it.",
      "BANK_ACCOUNT_UNVERIFIED",
    );
  }

  const receipt = await prisma.receipt.create({
    data: {
      practiceId: params.practiceId,
      clientRelationshipId: params.clientRelationshipId,
      bankAccountId: account.id,
      amount: money(params.amount),
      currency: params.currency ?? "INR",
      receivedAt: params.receivedAt,
      method: params.method,
      reference: params.reference ?? null,
    },
  });

  await recordEvent({
    action: "RECEIPT_RECORDED",
    targetType: "Receipt",
    targetId: receipt.id,
    result: "SUCCESS",
    practiceId: params.practiceId,
    actorUserId: params.userId,
    afterMeta: { amount: money(params.amount), method: params.method },
  });

  return receipt;
}

// ---------------------------------------------------------------- FIN04 allocate

/**
 * Allocate part of a receipt to an invoice.
 *
 * PAYMENT and ADVANCE draw on the receipt's own money and are limited by what
 * is left of it. TDS and WRITE_OFF do not: no money arrived for them, so they
 * settle the invoice without drawing down a receipt. That asymmetry is the
 * requirement's "separate cash received from tax deducted" expressed as a
 * constraint rather than a label.
 */
export async function allocateReceipt(params: {
  userId: string;
  practiceId: string;
  invoiceId: string;
  kind: AllocationKind;
  amount: number;
  /** Required for PAYMENT, ADVANCE and REFUND; must be absent otherwise. */
  receiptId?: string;
}) {
  await assertCan(params.userId, params.practiceId, "invoice.draft");

  if (params.amount <= 0) {
    throw new ReceiptError("An allocation must be for a positive amount.", "INVALID_AMOUNT");
  }
  if (params.kind === "CREDIT_NOTE") {
    throw new ReceiptError(
      "A credit note allocation is created by issuing the credit note, not by hand.",
      "USE_CREDIT_NOTE",
    );
  }

  const needsReceipt = params.kind === "PAYMENT" || params.kind === "ADVANCE" || params.kind === "REFUND";
  if (needsReceipt && !params.receiptId) {
    throw new ReceiptError(
      `A ${params.kind} allocation must name the receipt the money came from.`,
      "RECEIPT_REQUIRED",
    );
  }
  if (!needsReceipt && params.receiptId) {
    throw new ReceiptError(
      `A ${params.kind} allocation is not cash and must not name a receipt.`,
      "RECEIPT_NOT_ALLOWED",
    );
  }

  const amount = new Prisma.Decimal(money(params.amount));

  const allocation = await prisma.$transaction(async (tx) => {
    const invoice = await tx.invoice.findFirst({
      where: { id: params.invoiceId, practiceId: params.practiceId },
      select: { id: true, total: true, status: true, currency: true, clientRelationshipId: true },
    });
    if (!invoice) {
      throw new ReceiptError("No such invoice in this practice.", "INVOICE_NOT_FOUND");
    }
    if (invoice.status === "DRAFT" || invoice.status === "APPROVED") {
      throw new ReceiptError(
        "Money cannot be allocated to an invoice that has not been issued.",
        "NOT_ISSUED",
      );
    }
    if (invoice.status === "CANCELLED") {
      throw new ReceiptError(
        "That invoice was cancelled; nothing can be allocated to it.",
        "CANCELLED",
      );
    }

    let receipt = null;
    if (params.receiptId) {
      receipt = await tx.receipt.findFirst({
        where: { id: params.receiptId, practiceId: params.practiceId, archivedAt: null },
        select: { id: true, amount: true, currency: true, clientRelationshipId: true },
      });
      if (!receipt) {
        throw new ReceiptError("No such receipt in this practice.", "RECEIPT_NOT_FOUND");
      }
      // A receipt from one client cannot settle another client's invoice.
      if (receipt.clientRelationshipId !== invoice.clientRelationshipId) {
        throw new ReceiptError(
          "That receipt was received from a different client.",
          "CLIENT_MISMATCH",
        );
      }
      if (receipt.currency !== invoice.currency) {
        throw new ReceiptError(
          "Receipt and invoice are in different currencies.",
          "CURRENCY_MISMATCH",
        );
      }

      // Read live INSIDE the transaction: a balance computed before the
      // transaction is a balance two concurrent allocations can both pass.
      const receiptUsed = await sumLive(tx, {
        practiceId: params.practiceId,
        receiptId: receipt.id,
        kinds: CASH_KINDS,
      });
      const refunded = await sumLive(tx, {
        practiceId: params.practiceId,
        receiptId: receipt.id,
        kinds: ["REFUND"],
      });
      const receiptRemaining = receipt.amount.minus(receiptUsed).plus(refunded);
      if (params.kind !== "REFUND" && amount.greaterThan(receiptRemaining)) {
        throw new ReceiptError(
          `That receipt has only ${receiptRemaining.toFixed(2)} unallocated.`,
          "RECEIPT_OVER_ALLOCATED",
        );
      }
    }

    // FIN04 "Prevent over allocation" — against the INVOICE this time.
    const settled = await sumLive(tx, {
      practiceId: params.practiceId,
      invoiceId: invoice.id,
      kinds: ["PAYMENT", "ADVANCE", "TDS", "WRITE_OFF", "CREDIT_NOTE"],
    });
    const refundedOnInvoice = await sumLive(tx, {
      practiceId: params.practiceId,
      invoiceId: invoice.id,
      kinds: ["REFUND"],
    });
    const outstanding = invoice.total.minus(settled).plus(refundedOnInvoice);

    if (params.kind === "REFUND") {
      // A refund gives money back, so it may not exceed what was settled.
      if (amount.greaterThan(invoice.total.minus(outstanding))) {
        throw new ReceiptError(
          "A refund cannot exceed what has been settled on the invoice.",
          "REFUND_EXCEEDS_SETTLED",
        );
      }
    } else if (amount.greaterThan(outstanding)) {
      throw new ReceiptError(
        `That would over allocate the invoice: ${outstanding.toFixed(2)} is outstanding.`,
        "INVOICE_OVER_ALLOCATED",
      );
    }

    const created = await tx.receiptAllocation.create({
      data: {
        practiceId: params.practiceId,
        receiptId: receipt?.id ?? null,
        invoiceId: invoice.id,
        kind: params.kind,
        amount: money(params.amount),
        createdByUserId: params.userId,
      },
    });

    await refreshInvoiceStatus(tx, params.practiceId, invoice.id);
    return created;
  });

  await recordEvent({
    action: "RECEIPT_ALLOCATED",
    targetType: "INVOICE",
    targetId: params.invoiceId,
    result: "SUCCESS",
    practiceId: params.practiceId,
    actorUserId: params.userId,
    afterMeta: { kind: params.kind, amount: money(params.amount) },
  });

  return allocation;
}

/**
 * FIN04 "preserve reconciliation adjustments". A wrong allocation is not
 * deleted and not edited — it is reversed by a row that points at it. Both
 * rows stay, and the maths ignores the pair.
 */
export async function reverseAllocation(params: {
  userId: string;
  practiceId: string;
  allocationId: string;
  reason: string;
}) {
  await assertCan(params.userId, params.practiceId, "invoice.draft");

  const reversal = await prisma.$transaction(async (tx) => {
    const original = await tx.receiptAllocation.findFirst({
      where: { id: params.allocationId, practiceId: params.practiceId },
    });
    if (!original) {
      throw new ReceiptError("No such allocation in this practice.", "NOT_FOUND");
    }
    if (original.reversedAt) {
      throw new ReceiptError("That allocation has already been reversed.", "ALREADY_REVERSED");
    }

    // Conditional update: two simultaneous reversals must not both succeed.
    const claimed = await tx.receiptAllocation.updateMany({
      where: { id: original.id, practiceId: params.practiceId, reversedAt: null },
      data: { reversedAt: new Date(), reversalReason: params.reason },
    });
    if (claimed.count === 0) {
      throw new ReceiptError("That allocation has already been reversed.", "ALREADY_REVERSED");
    }

    const created = await tx.receiptAllocation.create({
      data: {
        practiceId: params.practiceId,
        receiptId: original.receiptId,
        creditNoteId: original.creditNoteId,
        invoiceId: original.invoiceId,
        kind: original.kind,
        amount: original.amount,
        reversalOfId: original.id,
        reversalReason: params.reason,
        reversedAt: new Date(),
        createdByUserId: params.userId,
      },
    });

    await refreshInvoiceStatus(tx, params.practiceId, original.invoiceId);
    return created;
  });

  await recordEvent({
    action: "ALLOCATION_REVERSED",
    targetType: "INVOICE",
    targetId: reversal.invoiceId,
    result: "SUCCESS",
    practiceId: params.practiceId,
    actorUserId: params.userId,
    reason: params.reason,
    beforeMeta: { allocationId: params.allocationId },
  });

  return reversal;
}

// ---------------------------------------------------------------- read model

/**
 * The acceptance evidence, as a return type: cash, credited tax and balance
 * are three separate fields. There is deliberately no "totalReceived" that
 * adds cash to TDS — a caller that wants one has to write the addition itself
 * and own the fact that it lost the distinction.
 */
export type Settlement = {
  invoiceTotal: string;
  cashReceived: string;
  taxDeducted: string;
  creditedByNote: string;
  writtenOff: string;
  refunded: string;
  balance: string;
  status: string;
};

export async function settlementOf(params: {
  practiceId: string;
  invoiceId: string;
}): Promise<Settlement> {
  const invoice = await prisma.invoice.findFirst({
    where: { id: params.invoiceId, practiceId: params.practiceId },
    select: { id: true, total: true, status: true },
  });
  if (!invoice) {
    throw new ReceiptError("No such invoice in this practice.", "INVOICE_NOT_FOUND");
  }

  const rows = await prisma.receiptAllocation.groupBy({
    by: ["kind"],
    where: { practiceId: params.practiceId, invoiceId: invoice.id, reversedAt: null },
    _sum: { amount: true },
  });

  const by = (kind: AllocationKind) =>
    rows.find((r) => r.kind === kind)?._sum.amount ?? new Prisma.Decimal(0);

  const cash = by("PAYMENT").plus(by("ADVANCE"));
  const tds = by("TDS");
  const credited = by("CREDIT_NOTE");
  const writtenOff = by("WRITE_OFF");
  const refunded = by("REFUND");

  const balance = invoice.total
    .minus(cash)
    .minus(tds)
    .minus(credited)
    .minus(writtenOff)
    .plus(refunded);

  return {
    invoiceTotal: invoice.total.toFixed(2),
    cashReceived: cash.toFixed(2),
    taxDeducted: tds.toFixed(2),
    creditedByNote: credited.toFixed(2),
    writtenOff: writtenOff.toFixed(2),
    refunded: refunded.toFixed(2),
    balance: balance.toFixed(2),
    status: invoice.status,
  };
}

export async function listAllocations(params: { practiceId: string; invoiceId: string }) {
  return prisma.receiptAllocation.findMany({
    where: { practiceId: params.practiceId, invoiceId: params.invoiceId },
    orderBy: { createdAt: "asc" },
    include: {
      receipt: { select: { reference: true, method: true, receivedAt: true } },
      creditNote: { select: { displayNumber: true, reason: true } },
    },
  });
}

// ---------------------------------------------------------------- internals

/** Sum of live (non-reversed, non-reversal) allocations matching a filter. */
async function sumLive(
  tx: Prisma.TransactionClient,
  filter: {
    practiceId: string;
    invoiceId?: string;
    receiptId?: string;
    kinds: AllocationKind[];
  },
): Promise<Prisma.Decimal> {
  const result = await tx.receiptAllocation.aggregate({
    where: {
      practiceId: filter.practiceId,
      ...(filter.invoiceId ? { invoiceId: filter.invoiceId } : {}),
      ...(filter.receiptId ? { receiptId: filter.receiptId } : {}),
      kind: { in: filter.kinds },
      // A reversed row and its reversal both carry reversedAt, so excluding
      // that one field removes the pair in a single condition.
      reversedAt: null,
    },
    _sum: { amount: true },
  });
  return result._sum.amount ?? new Prisma.Decimal(0);
}

/**
 * FIN02's PART_PAID / PAID / CREDITED, derived.
 *
 * Nothing outside this function writes those three statuses. That is the
 * point: a status somebody can type is a status that will eventually disagree
 * with the allocations, and the allocations are the record of fact.
 *
 * Exported so invoicing.ts can call it after issuing a credit note, which
 * settles an invoice without any receipt being involved. It is exported for
 * that reason and no other — the rule is one writer, not no callers. (The T14
 * test caught this: a fully credited invoice sat at ISSUED because the credit
 * note path wrote the allocation and never re-derived the status.)
 */
export async function refreshInvoiceStatus(
  tx: Prisma.TransactionClient,
  practiceId: string,
  invoiceId: string,
) {
  const invoice = await tx.invoice.findFirstOrThrow({
    where: { id: invoiceId, practiceId },
    select: { id: true, total: true, status: true },
  });

  // A cancelled invoice keeps its state; nothing can be allocated to one.
  if (invoice.status === "CANCELLED" || invoice.status === "DRAFT" || invoice.status === "APPROVED") {
    return;
  }

  const rows = await tx.receiptAllocation.groupBy({
    by: ["kind"],
    where: { practiceId, invoiceId, reversedAt: null },
    _sum: { amount: true },
  });
  const by = (kind: AllocationKind) =>
    rows.find((r) => r.kind === kind)?._sum.amount ?? new Prisma.Decimal(0);

  const settled = by("PAYMENT")
    .plus(by("ADVANCE"))
    .plus(by("TDS"))
    .plus(by("WRITE_OFF"))
    .plus(by("CREDIT_NOTE"))
    .minus(by("REFUND"));

  let status: "ISSUED" | "PART_PAID" | "PAID" | "CREDITED";
  if (settled.lessThanOrEqualTo(0)) {
    status = "ISSUED";
  } else if (settled.greaterThanOrEqualTo(invoice.total)) {
    // Fully settled by a credit note is not the same fact as fully paid, and
    // FIN02 gives it its own state.
    status = by("CREDIT_NOTE").greaterThanOrEqualTo(invoice.total) ? "CREDITED" : "PAID";
  } else {
    status = "PART_PAID";
  }

  if (status !== invoice.status) {
    await tx.invoice.update({
      where: { id: invoice.id },
      data: { status, version: { increment: 1 } },
    });
  }
}
