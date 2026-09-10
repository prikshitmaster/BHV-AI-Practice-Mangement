/**
 * Invoice identity — FIN02 (PRD §25).
 *
 *   "Provide separate financial year series per practice / registration and
 *    approved numbering policy. Generate Draft, Approved, Issued, Part paid,
 *    Paid, Credited and Cancelled states. Issued particulars are locked;
 *    corrections use reviewed credit / debit notes."
 *
 * Two things in that paragraph do the real work.
 *
 * First, the number. A series belongs to one practice, and the number is
 * allocated by an atomic UPDATE ... RETURNING against the series row, so two
 * simultaneous issues take two different numbers rather than reading the same
 * `nextNumber` and both writing it back. Two practices issuing "1" on the same
 * day is not a collision — they are different series, which is the PRD's own
 * acceptance evidence — and the composite unique on (seriesId, sequenceNumber)
 * is what makes that statement true in the database rather than in a comment.
 *
 * Second, the lock. ISSUED is where editing stops. Everything mutating here
 * refuses to touch an invoice at or past ISSUED, and the particulars as they
 * stood at that instant are copied into `issuedSnapshot` (DAT02) so renaming a
 * client tomorrow cannot alter an invoice that has already gone out. The only
 * way to change an issued figure is a credit note, which is a separate
 * numbered, reviewed document — never a write-back onto the invoice.
 *
 * PART_PAID / PAID / CREDITED are NOT set here. They are derived from
 * allocations in receipts.ts, because a status a human can type is a status
 * that will eventually disagree with the money.
 *
 * FIN03 (place of supply, SAC, reverse charge, e-invoice) is R1. R0 records
 * the tax the fee arrangement agreed and does not compute a treatment.
 */

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { recordEvent } from "@/lib/audit";
import { assertCan } from "@/lib/permissions";
import { assertMayApprove } from "@/lib/separation-of-duties";
import { refreshInvoiceStatus } from "@/lib/receipts";

export class InvoiceError extends Error {
  readonly status = 409;
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "InvoiceError";
  }
}

/** Statuses at or past which the particulars are locked (FIN02). */
const LOCKED_STATUSES = ["ISSUED", "PART_PAID", "PAID", "CREDITED", "CANCELLED"] as const;

function isLocked(status: string): boolean {
  return (LOCKED_STATUSES as readonly string[]).includes(status);
}

function money(value: number | Prisma.Decimal): string {
  return new Prisma.Decimal(value).toFixed(2);
}

// ---------------------------------------------------------------- FIN02 series

export async function createInvoiceSeries(params: {
  userId: string;
  practiceId: string;
  code: string;
  fiscalPeriod: string;
  registrationId?: string;
  kind?: "INVOICE" | "CREDIT_NOTE";
  /** Tokens: {code} {fiscalPeriod} {number}. Fixed once the series is locked. */
  numberFormat?: string;
  startAt?: number;
}) {
  await assertCan(params.userId, params.practiceId, "invoice.draft");

  if (params.registrationId) {
    // FIN02 ties a series to a practice AND optionally a registration. Reading
    // it through the practice scope is what stops another practice's
    // registration being borrowed to number an invoice.
    const registration = await prisma.practiceRegistration.findFirst({
      where: { id: params.registrationId, practiceId: params.practiceId },
      select: { id: true },
    });
    if (!registration) {
      throw new InvoiceError(
        "No such registration in this practice.",
        "REGISTRATION_NOT_FOUND",
      );
    }
  }

  return prisma.invoiceSeries.create({
    data: {
      practiceId: params.practiceId,
      registrationId: params.registrationId ?? null,
      kind: params.kind ?? "INVOICE",
      code: params.code,
      fiscalPeriod: params.fiscalPeriod,
      numberFormat: params.numberFormat ?? "{code}/{fiscalPeriod}/{number}",
      nextNumber: params.startAt ?? 1,
    },
  });
}

/**
 * FIN02 "approved numbering policy": locking freezes the shape of the number.
 * Later invoices in this series keep the form the earlier ones were issued in.
 */
export async function lockInvoiceSeries(params: {
  userId: string;
  practiceId: string;
  seriesId: string;
}) {
  await assertCan(params.userId, params.practiceId, "invoice.approve");

  const claimed = await prisma.invoiceSeries.updateMany({
    where: { id: params.seriesId, practiceId: params.practiceId, lockedAt: null },
    data: { lockedAt: new Date() },
  });
  if (claimed.count === 0) {
    throw new InvoiceError(
      "No unlocked series with that id in this practice.",
      "SERIES_NOT_FOUND",
    );
  }
  return prisma.invoiceSeries.findFirstOrThrow({
    where: { id: params.seriesId, practiceId: params.practiceId },
  });
}

function renderNumber(
  format: string | null,
  parts: { code: string; fiscalPeriod: string; number: number },
): string {
  return (format ?? "{code}/{fiscalPeriod}/{number}")
    .replace("{code}", parts.code)
    .replace("{fiscalPeriod}", parts.fiscalPeriod)
    .replace("{number}", String(parts.number));
}

// ---------------------------------------------------------------- FIN02 draft

export type DraftLine = {
  description: string;
  quantity: number;
  unitAmount: number;
  taxRatePercent?: number;
};

function totalsFor(lines: DraftLine[]) {
  let subtotal = new Prisma.Decimal(0);
  let taxTotal = new Prisma.Decimal(0);

  const computed = lines.map((line, index) => {
    const lineTotal = new Prisma.Decimal(line.quantity).times(line.unitAmount);
    const tax = lineTotal.times(new Prisma.Decimal(line.taxRatePercent ?? 0)).dividedBy(100);
    subtotal = subtotal.plus(lineTotal);
    taxTotal = taxTotal.plus(tax);
    return {
      description: line.description,
      quantity: new Prisma.Decimal(line.quantity).toFixed(4),
      unitAmount: money(line.unitAmount),
      taxRatePercent: new Prisma.Decimal(line.taxRatePercent ?? 0).toFixed(2),
      lineTotal: lineTotal.toFixed(2),
      sortOrder: index,
    };
  });

  return {
    lines: computed,
    subtotal: subtotal.toFixed(2),
    taxTotal: taxTotal.toFixed(2),
    total: subtotal.plus(taxTotal).toFixed(2),
  };
}

export async function draftInvoice(params: {
  userId: string;
  practiceId: string;
  seriesId: string;
  clientRelationshipId: string;
  engagementId?: string;
  feeArrangementId?: string;
  lines: DraftLine[];
  currency?: string;
  dueDate?: Date;
}) {
  await assertCan(params.userId, params.practiceId, "invoice.draft");

  if (params.lines.length === 0) {
    throw new InvoiceError("An invoice needs at least one line.", "NO_LINES");
  }

  const series = await prisma.invoiceSeries.findFirst({
    where: { id: params.seriesId, practiceId: params.practiceId, archivedAt: null },
    select: { id: true, kind: true },
  });
  if (!series) {
    throw new InvoiceError("No such invoice series in this practice.", "SERIES_NOT_FOUND");
  }
  if (series.kind !== "INVOICE") {
    throw new InvoiceError(
      "That series numbers credit notes, not invoices.",
      "WRONG_SERIES_KIND",
    );
  }

  const relationship = await prisma.clientRelationship.findFirst({
    where: { id: params.clientRelationshipId, practiceId: params.practiceId },
    select: { id: true },
  });
  if (!relationship) {
    throw new InvoiceError("No such client in this practice.", "CLIENT_NOT_FOUND");
  }

  // DAT01: a Company invoice cannot reference an Associates engagement. The
  // composite FK enforces it in Postgres; reading it scoped fails earlier and
  // with a message that says what happened.
  if (params.engagementId) {
    const engagement = await prisma.engagement.findFirst({
      where: {
        id: params.engagementId,
        practiceId: params.practiceId,
        clientRelationshipId: params.clientRelationshipId,
      },
      select: { id: true },
    });
    if (!engagement) {
      throw new InvoiceError(
        "No such engagement for this client in this practice.",
        "ENGAGEMENT_NOT_FOUND",
      );
    }
  }

  if (params.feeArrangementId) {
    const arrangement = await prisma.feeArrangement.findFirst({
      where: { id: params.feeArrangementId, practiceId: params.practiceId },
      select: { id: true, status: true },
    });
    if (!arrangement) {
      throw new InvoiceError(
        "No such fee arrangement in this practice.",
        "ARRANGEMENT_NOT_FOUND",
      );
    }
    // FIN01: bill against what was agreed and approved, not a draft proposal.
    if (arrangement.status !== "APPROVED") {
      throw new InvoiceError(
        "An invoice can only be raised against an approved fee arrangement.",
        "ARRANGEMENT_NOT_APPROVED",
      );
    }
  }

  const totals = totalsFor(params.lines);

  // Lines are created in a second statement rather than nested. InvoiceLine
  // reaches its invoice through the composite FK (invoiceId, practiceId), so
  // Prisma treats practiceId as part of that relation and refuses it as a
  // nested-create field — the practice has to be written explicitly.
  const invoice = await prisma.$transaction(async (tx) => {
    const created = await tx.invoice.create({
      data: {
        practiceId: params.practiceId,
        seriesId: series.id,
        clientRelationshipId: params.clientRelationshipId,
        engagementId: params.engagementId ?? null,
        feeArrangementId: params.feeArrangementId ?? null,
        // A draft has no identity yet. FIN02 numbers an invoice when it is
        // ISSUED — numbering at draft would burn numbers on drafts that are
        // abandoned, and a gap in a statutory series has to be explained.
        sequenceNumber: null,
        currency: params.currency ?? "INR",
        status: "DRAFT",
        dueDate: params.dueDate ?? null,
        subtotal: totals.subtotal,
        taxTotal: totals.taxTotal,
        total: totals.total,
      },
    });

    await tx.invoiceLine.createMany({
      data: totals.lines.map((l) => ({
        ...l,
        invoiceId: created.id,
        practiceId: params.practiceId,
      })),
    });

    return tx.invoice.findFirstOrThrow({
      where: { id: created.id, practiceId: params.practiceId },
      include: { lines: { orderBy: { sortOrder: "asc" } } },
    });
  });

  // The action name matters: separation-of-duties.ts reads INVOICE_DRAFTED to
  // decide who authored this invoice, and IAM04 stops that person approving it.
  await recordEvent({
    action: "INVOICE_DRAFTED",
    targetType: "INVOICE",
    targetId: invoice.id,
    result: "SUCCESS",
    practiceId: params.practiceId,
    actorUserId: params.userId,
    afterMeta: { total: totals.total, lineCount: totals.lines.length },
  });

  return invoice;
}

/** Replace the lines of a DRAFT invoice. Refused once issued (FIN02). */
export async function reviseDraftInvoice(params: {
  userId: string;
  practiceId: string;
  invoiceId: string;
  expectedVersion: number;
  lines: DraftLine[];
}) {
  await assertCan(params.userId, params.practiceId, "invoice.draft");

  const invoice = await loadScoped(params.practiceId, params.invoiceId);
  assertEditable(invoice.status);

  const totals = totalsFor(params.lines);

  await prisma.$transaction(async (tx) => {
    const claimed = await tx.invoice.updateMany({
      where: {
        id: invoice.id,
        practiceId: params.practiceId,
        version: params.expectedVersion,
        status: { in: ["DRAFT", "APPROVED"] },
      },
      data: {
        subtotal: totals.subtotal,
        taxTotal: totals.taxTotal,
        total: totals.total,
        // Changing the figures un-approves it. An approval is of particulars,
        // and these are no longer the particulars that were approved.
        status: "DRAFT",
        approvedAt: null,
        approvedByUserId: null,
        approvedByName: null,
        version: { increment: 1 },
      },
    });
    if (claimed.count === 0) {
      throw new InvoiceError(
        `The invoice has changed since it was loaded (expected version ${params.expectedVersion}).`,
        "VERSION_CONFLICT",
      );
    }

    await tx.invoiceLine.deleteMany({
      where: { invoiceId: invoice.id, practiceId: params.practiceId },
    });
    await tx.invoiceLine.createMany({
      data: totals.lines.map((l) => ({
        ...l,
        invoiceId: invoice.id,
        practiceId: params.practiceId,
      })),
    });
  });

  await recordEvent({
    action: "INVOICE_DRAFTED",
    targetType: "INVOICE",
    targetId: invoice.id,
    targetVersion: params.expectedVersion,
    result: "SUCCESS",
    practiceId: params.practiceId,
    actorUserId: params.userId,
    afterMeta: { total: totals.total },
  });

  return prisma.invoice.findFirstOrThrow({
    where: { id: invoice.id, practiceId: params.practiceId },
    include: { lines: { orderBy: { sortOrder: "asc" } } },
  });
}

// ---------------------------------------------------------------- FIN02 approve

export async function approveInvoice(params: {
  userId: string;
  approverName: string;
  practiceId: string;
  invoiceId: string;
  expectedVersion: number;
}) {
  await assertCan(params.userId, params.practiceId, "invoice.approve");

  const invoice = await loadScoped(params.practiceId, params.invoiceId);
  if (invoice.status !== "DRAFT") {
    throw new InvoiceError(
      `Only a draft invoice can be approved (this one is ${invoice.status}).`,
      "NOT_DRAFT",
    );
  }

  // IAM04: the person who drafted it cannot be the person who approves it,
  // unless the practice's threshold says this one does not need independent
  // review at all, or a disclosed self-review exception exists.
  await assertMayApprove({
    practiceId: params.practiceId,
    subjectType: "INVOICE",
    subjectId: invoice.id,
    subjectVersion: params.expectedVersion,
    approverUserId: params.userId,
    amount: invoice.total,
  });

  const claimed = await prisma.invoice.updateMany({
    where: {
      id: invoice.id,
      practiceId: params.practiceId,
      version: params.expectedVersion,
      status: "DRAFT",
    },
    data: {
      status: "APPROVED",
      approvedByUserId: params.userId,
      approvedByName: params.approverName,
      approvedAt: new Date(),
      version: { increment: 1 },
    },
  });
  if (claimed.count === 0) {
    throw new InvoiceError(
      `The invoice has changed since it was loaded (expected version ${params.expectedVersion}).`,
      "VERSION_CONFLICT",
    );
  }

  await recordEvent({
    action: "INVOICE_APPROVED",
    targetType: "INVOICE",
    targetId: invoice.id,
    targetVersion: params.expectedVersion,
    result: "SUCCESS",
    practiceId: params.practiceId,
    actorUserId: params.userId,
  });

  return prisma.invoice.findFirstOrThrow({
    where: { id: invoice.id, practiceId: params.practiceId },
  });
}

// ---------------------------------------------------------------- FIN02 issue

/**
 * Allocate the next number in a series, atomically.
 *
 * `UPDATE ... RETURNING` under the row lock Postgres already takes is what
 * makes two simultaneous issues take two numbers. Reading `nextNumber` and
 * writing it back from application code is the version of this that looks
 * right and silently double-issues under load.
 */
async function allocateNumber(
  tx: Prisma.TransactionClient,
  seriesId: string,
  practiceId: string,
): Promise<{ number: number; display: string }> {
  const rows = await tx.$queryRaw<
    { nextNumber: number; code: string; fiscalPeriod: string; numberFormat: string | null }[]
  >`
    UPDATE "InvoiceSeries"
       SET "nextNumber" = "nextNumber" + 1
     WHERE "id" = ${seriesId}
       AND "practiceId" = ${practiceId}
       AND "archivedAt" IS NULL
    RETURNING "nextNumber" - 1 AS "nextNumber", "code", "fiscalPeriod", "numberFormat"
  `;

  if (rows.length === 0) {
    throw new InvoiceError("No such invoice series in this practice.", "SERIES_NOT_FOUND");
  }

  const row = rows[0];
  return {
    number: Number(row.nextNumber),
    display: renderNumber(row.numberFormat, {
      code: row.code,
      fiscalPeriod: row.fiscalPeriod,
      number: Number(row.nextNumber),
    }),
  };
}

export async function issueInvoice(params: {
  userId: string;
  practiceId: string;
  invoiceId: string;
  expectedVersion: number;
  issueDate?: Date;
}) {
  await assertCan(params.userId, params.practiceId, "invoice.issue");

  const invoice = await prisma.invoice.findFirst({
    where: { id: params.invoiceId, practiceId: params.practiceId },
    include: {
      lines: { orderBy: { sortOrder: "asc" } },
      series: { select: { id: true, code: true, fiscalPeriod: true, registrationId: true } },
      clientRelationship: {
        select: {
          id: true,
          party: { select: { legalName: true, type: true } },
        },
      },
      practice: {
        select: { name: true, registeredDisplayName: true },
      },
    },
  });
  if (!invoice) {
    throw new InvoiceError("No such invoice in this practice.", "NOT_FOUND");
  }
  if (invoice.status !== "APPROVED") {
    throw new InvoiceError(
      `An invoice must be approved before it is issued (this one is ${invoice.status}).`,
      "NOT_APPROVED",
    );
  }

  const issueDate = params.issueDate ?? new Date();

  const issued = await prisma.$transaction(async (tx) => {
    // Claim the invoice FIRST. If this returns 0 the number is never
    // allocated, so a losing concurrent issue does not burn a sequence number
    // and leave a gap somebody later has to explain.
    const claimed = await tx.invoice.updateMany({
      where: {
        id: invoice.id,
        practiceId: params.practiceId,
        version: params.expectedVersion,
        status: "APPROVED",
      },
      data: { version: { increment: 1 } },
    });
    if (claimed.count === 0) {
      throw new InvoiceError(
        `The invoice has changed since it was loaded (expected version ${params.expectedVersion}).`,
        "VERSION_CONFLICT",
      );
    }

    const allocated = await allocateNumber(tx, invoice.seriesId, params.practiceId);

    // DAT02: the particulars as they stand at this instant, copied. Nothing
    // reads through to live master data after this point.
    const snapshot = {
      issuedAt: issueDate.toISOString(),
      number: allocated.display,
      sequenceNumber: allocated.number,
      series: {
        code: invoice.series.code,
        fiscalPeriod: invoice.series.fiscalPeriod,
        registrationId: invoice.series.registrationId,
      },
      practice: {
        name: invoice.practice.registeredDisplayName ?? invoice.practice.name,
      },
      client: {
        legalName: invoice.clientRelationship.party.legalName,
        type: invoice.clientRelationship.party.type,
      },
      currency: invoice.currency,
      subtotal: invoice.subtotal.toFixed(2),
      taxTotal: invoice.taxTotal.toFixed(2),
      total: invoice.total.toFixed(2),
      approvedByName: invoice.approvedByName,
      lines: invoice.lines.map((l) => ({
        description: l.description,
        quantity: l.quantity.toString(),
        unitAmount: l.unitAmount.toFixed(2),
        taxRatePercent: l.taxRatePercent.toFixed(2),
        lineTotal: l.lineTotal.toFixed(2),
      })),
    };

    await tx.invoice.update({
      where: { id: invoice.id },
      data: {
        status: "ISSUED",
        sequenceNumber: allocated.number,
        displayNumber: allocated.display,
        issueDate,
        issuedAt: new Date(),
        issuedSnapshot: snapshot as never,
      },
    });

    return { number: allocated.number, display: allocated.display };
  });

  await recordEvent({
    action: "INVOICE_ISSUED",
    targetType: "INVOICE",
    targetId: invoice.id,
    targetVersion: params.expectedVersion,
    result: "SUCCESS",
    practiceId: params.practiceId,
    actorUserId: params.userId,
    afterMeta: { number: issued.display, total: invoice.total.toFixed(2) },
  });

  return prisma.invoice.findFirstOrThrow({
    where: { id: invoice.id, practiceId: params.practiceId },
    include: { lines: { orderBy: { sortOrder: "asc" } } },
  });
}

export async function cancelInvoice(params: {
  userId: string;
  practiceId: string;
  invoiceId: string;
  expectedVersion: number;
  reason: string;
}) {
  await assertCan(params.userId, params.practiceId, "invoice.issue");

  const invoice = await loadScoped(params.practiceId, params.invoiceId);

  // FIN02: once money has moved against it, cancelling would erase a settled
  // position. That correction is a credit note.
  const settled = await prisma.receiptAllocation.count({
    where: { invoiceId: invoice.id, practiceId: params.practiceId, reversedAt: null },
  });
  if (settled > 0) {
    throw new InvoiceError(
      "This invoice has receipts or credits allocated against it; correct it with a credit note rather than cancelling it.",
      "ALREADY_SETTLED",
    );
  }

  const claimed = await prisma.invoice.updateMany({
    where: {
      id: invoice.id,
      practiceId: params.practiceId,
      version: params.expectedVersion,
      status: { in: ["DRAFT", "APPROVED", "ISSUED"] },
    },
    data: { status: "CANCELLED", cancelledAt: new Date(), version: { increment: 1 } },
  });
  if (claimed.count === 0) {
    throw new InvoiceError(
      `The invoice has changed since it was loaded (expected version ${params.expectedVersion}).`,
      "VERSION_CONFLICT",
    );
  }

  await recordEvent({
    action: "INVOICE_CANCELLED",
    targetType: "INVOICE",
    targetId: invoice.id,
    targetVersion: params.expectedVersion,
    result: "SUCCESS",
    practiceId: params.practiceId,
    actorUserId: params.userId,
    reason: params.reason,
  });

  return prisma.invoice.findFirstOrThrow({
    where: { id: invoice.id, practiceId: params.practiceId },
  });
}

// ---------------------------------------------------------------- FIN02 credit note

export async function draftCreditNote(params: {
  userId: string;
  practiceId: string;
  invoiceId: string;
  seriesId: string;
  amount: number;
  reason: string;
}) {
  await assertCan(params.userId, params.practiceId, "invoice.draft");

  const invoice = await loadScoped(params.practiceId, params.invoiceId);
  if (!["ISSUED", "PART_PAID", "PAID", "CREDITED"].includes(invoice.status)) {
    throw new InvoiceError(
      "Only an issued invoice can be credited; an unissued one is still editable.",
      "NOT_ISSUED",
    );
  }

  const series = await prisma.invoiceSeries.findFirst({
    where: { id: params.seriesId, practiceId: params.practiceId, archivedAt: null },
    select: { id: true, kind: true },
  });
  if (!series || series.kind !== "CREDIT_NOTE") {
    throw new InvoiceError(
      "A credit note needs a credit note series in this practice.",
      "SERIES_NOT_FOUND",
    );
  }

  if (params.amount <= 0) {
    throw new InvoiceError("A credit note must be for a positive amount.", "INVALID_AMOUNT");
  }
  if (new Prisma.Decimal(params.amount).greaterThan(invoice.total)) {
    throw new InvoiceError(
      "A credit note cannot exceed the invoice it corrects.",
      "EXCEEDS_INVOICE",
    );
  }

  const note = await prisma.creditNote.create({
    data: {
      practiceId: params.practiceId,
      seriesId: series.id,
      invoiceId: invoice.id,
      sequenceNumber: null,
      reason: params.reason,
      amount: money(params.amount),
      currency: invoice.currency,
    },
  });

  await recordEvent({
    action: "CREDIT_NOTE_DRAFTED",
    targetType: "INVOICE",
    targetId: invoice.id,
    result: "SUCCESS",
    practiceId: params.practiceId,
    actorUserId: params.userId,
    afterMeta: { creditNoteId: note.id, amount: money(params.amount) },
  });

  return note;
}

/**
 * FIN02 says corrections use *reviewed* credit notes. A correction one person
 * can raise and issue alone is not reviewed, so the reviewer may not be the
 * person who drafted it — and unlike an invoice there is no threshold that
 * waives it, because a credit note reduces revenue that was already reported.
 */
export async function issueCreditNote(params: {
  userId: string;
  reviewerName: string;
  practiceId: string;
  creditNoteId: string;
  expectedVersion: number;
}) {
  await assertCan(params.userId, params.practiceId, "invoice.approve");

  const note = await prisma.creditNote.findFirst({
    where: { id: params.creditNoteId, practiceId: params.practiceId },
    include: { invoice: { select: { id: true, displayNumber: true, currency: true } } },
  });
  if (!note) {
    throw new InvoiceError("No such credit note in this practice.", "NOT_FOUND");
  }
  if (note.status !== "DRAFT") {
    throw new InvoiceError(
      `A credit note can only be issued from DRAFT (this one is ${note.status}).`,
      "NOT_DRAFT",
    );
  }

  const drafters = await prisma.event.findMany({
    where: {
      practiceId: params.practiceId,
      action: "CREDIT_NOTE_DRAFTED",
      result: "SUCCESS",
      targetId: note.invoiceId,
    },
    select: { actorUserId: true, afterMeta: true },
  });
  const draftedByThisUser = drafters.some(
    (e) =>
      e.actorUserId === params.userId &&
      (e.afterMeta as { creditNoteId?: string } | null)?.creditNoteId === note.id,
  );
  if (draftedByThisUser) {
    throw new InvoiceError(
      "A credit note must be reviewed by someone other than the person who raised it.",
      "REVIEW_REQUIRED",
    );
  }

  const issued = await prisma.$transaction(async (tx) => {
    const claimed = await tx.creditNote.updateMany({
      where: {
        id: note.id,
        practiceId: params.practiceId,
        version: params.expectedVersion,
        status: "DRAFT",
      },
      data: { version: { increment: 1 } },
    });
    if (claimed.count === 0) {
      throw new InvoiceError(
        `The credit note has changed since it was loaded (expected version ${params.expectedVersion}).`,
        "VERSION_CONFLICT",
      );
    }

    const allocated = await allocateNumber(tx, note.seriesId, params.practiceId);

    await tx.creditNote.update({
      where: { id: note.id },
      data: {
        status: "ISSUED",
        sequenceNumber: allocated.number,
        displayNumber: allocated.display,
        reviewedByUserId: params.userId,
        reviewedByName: params.reviewerName,
        reviewedAt: new Date(),
        issuedAt: new Date(),
        issuedSnapshot: {
          number: allocated.display,
          reason: note.reason,
          amount: note.amount.toFixed(2),
          currency: note.currency,
          invoiceNumber: note.invoice.displayNumber,
          reviewedByName: params.reviewerName,
        } as never,
      },
    });

    // FIN04: the credit lands on the invoice as its own allocation kind, so
    // "cash received" and "credited" never merge into one number.
    await tx.receiptAllocation.create({
      data: {
        practiceId: params.practiceId,
        receiptId: null,
        creditNoteId: note.id,
        invoiceId: note.invoiceId,
        kind: "CREDIT_NOTE",
        amount: note.amount,
        createdByUserId: params.userId,
      },
    });

    // The credit changes what is outstanding, so the derived status has to be
    // recomputed by the one function allowed to write it. Writing "CREDITED"
    // here instead would put a second author on those statuses, which is the
    // thing receipts.ts exists to prevent.
    await refreshInvoiceStatus(tx, params.practiceId, note.invoiceId);

    return allocated;
  });

  await recordEvent({
    action: "CREDIT_NOTE_ISSUED",
    targetType: "INVOICE",
    targetId: note.invoiceId,
    result: "SUCCESS",
    practiceId: params.practiceId,
    actorUserId: params.userId,
    afterMeta: { creditNoteId: note.id, number: issued.display },
  });

  return prisma.creditNote.findFirstOrThrow({
    where: { id: note.id, practiceId: params.practiceId },
  });
}

// ---------------------------------------------------------------- helpers

async function loadScoped(practiceId: string, invoiceId: string) {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, practiceId },
  });
  if (!invoice) {
    throw new InvoiceError("No such invoice in this practice.", "NOT_FOUND");
  }
  return invoice;
}

function assertEditable(status: string) {
  if (isLocked(status)) {
    throw new InvoiceError(
      `Issued particulars are locked. Correct invoice in state ${status} with a credit note.`,
      "ISSUED_LOCKED",
    );
  }
}

/** Read model for a list screen. Scoped, like everything else. */
export async function listInvoices(params: { practiceId: string; clientRelationshipId?: string }) {
  return prisma.invoice.findMany({
    where: {
      practiceId: params.practiceId,
      ...(params.clientRelationshipId
        ? { clientRelationshipId: params.clientRelationshipId }
        : {}),
    },
    orderBy: [{ issuedAt: "desc" }, { createdAt: "desc" }],
    include: {
      clientRelationship: { select: { party: { select: { legalName: true } } } },
      series: { select: { code: true, fiscalPeriod: true } },
    },
  });
}
