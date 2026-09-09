/**
 * Portal read model — POR01, POR05 (PRD §17).
 *
 * POR01 lists what the client should see and then says what they must not:
 * "Do not expose internal staff productivity, working papers or discussion."
 *
 * That prohibition is enforced by what these queries SELECT, not by filtering
 * afterwards. Every projection below names its fields explicitly, so an
 * internal field cannot reach a portal screen by being added to a model later
 * — it would have to be added to a select list here first, deliberately. The
 * fields deliberately NOT selected are called out at each query, because the
 * absence of a field is invisible in review unless someone writes it down.
 *
 * Nothing in this file decides access. Authority comes from
 * `liveAuthorities` / `assertPortalAccess` in portal-auth.ts, and every query
 * is bound to a relationship that has already passed one of them.
 */

import { prisma } from "@/lib/prisma";
import { assertPortalAccess, liveAuthorities, type LiveAuthority } from "@/lib/portal-auth";
import type { ContactAuthorityLevel, RequestItemState } from "@/generated/prisma/enums";

// ------------------------------------------------------------------ entities

export type PortalEntity = {
  clientRelationshipId: string;
  legalName: string;
  authorities: ContactAuthorityLevel[];
  canUpload: boolean;
};

/**
 * POR02's "visible entity switcher".
 *
 * Built from exactly the same `liveAuthorities` call that guards every request,
 * so the switcher can never offer an entity the next request would refuse —
 * and, more importantly for the acceptance evidence, can never omit one it
 * would allow. A third entity the contact holds no grant on simply never
 * appears in this list and 404s if named directly.
 */
export async function listPortalEntities(params: {
  contactId: string;
  practiceId: string;
  now?: Date;
}): Promise<PortalEntity[]> {
  const now = params.now ?? new Date();
  const authorities = await liveAuthorities(params.contactId, params.practiceId, now);
  if (authorities.length === 0) return [];

  const byRelationship = new Map<string, ContactAuthorityLevel[]>();
  for (const a of authorities) {
    const held = byRelationship.get(a.clientRelationshipId) ?? [];
    held.push(a.authority);
    byRelationship.set(a.clientRelationshipId, held);
  }

  const relationships = await prisma.clientRelationship.findMany({
    where: {
      id: { in: [...byRelationship.keys()] },
      practiceId: params.practiceId,
      archivedAt: null,
    },
    // NOT selected: acceptanceStatus, confidentiality, terminatedAt. A client's
    // own risk classification is an internal judgement about them and is not
    // theirs to read.
    select: { id: true, party: { select: { legalName: true } } },
  });

  return relationships
    .map((r) => {
      const held = byRelationship.get(r.id) ?? [];
      return {
        clientRelationshipId: r.id,
        legalName: r.party.legalName,
        authorities: held,
        canUpload: held.some((a) => a === "UPLOAD" || a === "APPROVE" || a === "SIGNATORY"),
      };
    })
    .sort((a, b) => a.legalName.localeCompare(b.legalName));
}

// ---------------------------------------------------------------- item state

/**
 * POR03: "Show each item's Received, Needs correction or Accepted state."
 *
 * The internal enum has seven values and the client is owed three of them plus
 * the states that describe their own action. The mapping is explicit rather
 * than a string transform of the enum name, so an internal state added later
 * has to be given a client-facing meaning here instead of leaking its raw name
 * onto a portal screen.
 */
export type PortalItemStatus =
  | "AWAITING_UPLOAD"
  | "RECEIVED"
  | "NEEDS_CORRECTION"
  | "ACCEPTED"
  | "QUESTION_RAISED"
  | "MARKED_UNAVAILABLE"
  | "NO_LONGER_NEEDED";

const ITEM_STATUS: Record<RequestItemState, PortalItemStatus> = {
  OUTSTANDING: "AWAITING_UPLOAD",
  SUBMITTED: "RECEIVED",
  REJECTED: "NEEDS_CORRECTION",
  ACCEPTED: "ACCEPTED",
  QUESTION_RAISED: "QUESTION_RAISED",
  NOT_AVAILABLE: "MARKED_UNAVAILABLE",
  WAIVED: "NO_LONGER_NEEDED",
};

export const ITEM_STATUS_LABEL: Record<PortalItemStatus, string> = {
  AWAITING_UPLOAD: "Awaiting your upload",
  // POR03: "The receipt confirms intake only, not correctness or completion of
  // the audit." The label says received, and stops there.
  RECEIVED: "Received",
  NEEDS_CORRECTION: "Needs correction",
  ACCEPTED: "Accepted",
  QUESTION_RAISED: "Question raised",
  MARKED_UNAVAILABLE: "Marked not available",
  NO_LONGER_NEEDED: "No longer needed",
};

export function portalItemStatus(state: RequestItemState): PortalItemStatus {
  return ITEM_STATUS[state];
}

// -------------------------------------------------------------- portal home

export type PortalRequestItem = {
  id: string;
  documentType: string;
  description: string | null;
  periodLabel: string | null;
  dueDate: Date | null;
  status: PortalItemStatus;
  statusLabel: string;
  correctionReason: string | null;
};

export type PortalRequest = {
  id: string;
  title: string;
  detail: string | null;
  serviceCode: string | null;
  dueDate: Date | null;
  items: PortalRequestItem[];
};

export type PortalAgreedDate = {
  kind: "STATUTORY_DUE" | "DOCUMENT_CUTOFF" | "REQUEST_DUE";
  label: string;
  date: Date;
};

export type PortalDeliverable = {
  releaseId: string;
  documentVersionId: string;
  title: string;
  versionNo: number;
  releasedAt: Date;
  expiresAt: Date | null;
};

export type PortalInvoice = {
  id: string;
  reference: string;
  issuedAt: Date;
  currency: string;
  total: string;
};

export type PortalSupportContact = {
  label: string;
  phone: string | null;
  email: string | null;
  helpUrl: string | null;
  hoursLabel: string | null;
};

export type PortalHome = {
  practice: { id: string; name: string };
  entities: PortalEntity[];
  active: PortalEntity;
  requests: PortalRequest[];
  agreedDates: PortalAgreedDate[];
  deliverables: PortalDeliverable[];
  invoices: PortalInvoice[];
  support: PortalSupportContact[];
};

/**
 * POR01 portal home, for ONE authorised entity.
 *
 * The relationship is checked before anything is read — every query below
 * carries both `practiceId` and `clientRelationshipId`, so a caller who somehow
 * reached this function with an unauthorised id would still read nothing.
 */
export async function loadPortalHome(params: {
  contactId: string;
  practiceId: string;
  clientRelationshipId: string;
  now?: Date;
}): Promise<PortalHome> {
  const now = params.now ?? new Date();

  const held: LiveAuthority[] = await assertPortalAccess({
    contactId: params.contactId,
    practiceId: params.practiceId,
    clientRelationshipId: params.clientRelationshipId,
    now,
  });

  const entities = await listPortalEntities({
    contactId: params.contactId,
    practiceId: params.practiceId,
    now,
  });
  const active = entities.find((e) => e.clientRelationshipId === params.clientRelationshipId);
  if (!active) {
    // Unreachable via assertPortalAccess, but a portal home without an active
    // entity would be a screen with no scope, and that must fail rather than
    // render.
    throw new Error("Authorised relationship missing from entity list");
  }
  void held;

  const scope = {
    practiceId: params.practiceId,
    clientRelationshipId: params.clientRelationshipId,
  };

  const practice = await prisma.practice.findUniqueOrThrow({
    where: { id: params.practiceId },
    // ORG02: the client is shown the registered display name where one is
    // confirmed, because that is the identity the firm trades under with them.
    select: { id: true, name: true, registeredDisplayName: true },
  });

  // ---- pending requests (POR01 "pending requests")

  const requestRows = await prisma.clientRequest.findMany({
    where: {
      ...scope,
      // A request that has not been SENT is still being drafted internally.
      state: { in: ["SENT", "PARTIALLY_RECEIVED", "RECEIVED"] },
      closedAt: null,
    },
    // NOT selected: slaPausedAt / slaPausedTotalMs (an internal SLA clock is
    // staff productivity), closeRule, jobId.
    select: {
      id: true,
      title: true,
      detail: true,
      dueDate: true,
      engagementId: true,
      items: {
        // NOT selected: ownerUserId (who internally owns the item is staff
        // allocation), remindersStoppedAt, version.
        select: {
          id: true,
          sequence: true,
          documentType: true,
          description: true,
          periodLabel: true,
          dueDate: true,
          state: true,
          responses: {
            where: { rejectedAt: { not: null }, supersededAt: null },
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { rejectionReason: true },
          },
        },
        orderBy: { sequence: "asc" },
      },
    },
    orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
  });

  // POR03 guides "by service and period". The service comes from the
  // engagement; the period is already on each item.
  const engagementIds = requestRows
    .map((r) => r.engagementId)
    .filter((id): id is string => id !== null);
  const engagements = engagementIds.length
    ? await prisma.engagement.findMany({
        where: { id: { in: engagementIds }, practiceId: params.practiceId },
        select: { id: true, serviceCode: true },
      })
    : [];
  const serviceByEngagement = new Map(engagements.map((e) => [e.id, e.serviceCode]));

  const requests: PortalRequest[] = requestRows.map((r) => ({
    id: r.id,
    title: r.title,
    detail: r.detail,
    serviceCode: r.engagementId ? (serviceByEngagement.get(r.engagementId) ?? null) : null,
    dueDate: r.dueDate,
    items: r.items.map((i) => {
      const status = portalItemStatus(i.state);
      return {
        id: i.id,
        documentType: i.documentType,
        description: i.description,
        periodLabel: i.periodLabel,
        dueDate: i.dueDate,
        status,
        statusLabel: ITEM_STATUS_LABEL[status],
        // Only shown when the item actually needs correction — otherwise a
        // stale reason from an earlier round would read as a live complaint.
        correctionReason:
          status === "NEEDS_CORRECTION" ? (i.responses[0]?.rejectionReason ?? null) : null,
      };
    }),
  }));

  // ---- upcoming agreed dates (POR01 "upcoming agreed dates")

  const obligations = await prisma.obligation.findMany({
    where: {
      ...scope,
      archivedAt: null,
      filedAt: null,
      currentStatutoryDate: { gte: startOfDay(now) },
    },
    // NOT selected: internalTargetDate and reviewTargetDate. Those are the
    // firm's own working deadlines, not dates agreed with the client — showing
    // them would both mislead and expose internal scheduling.
    select: {
      id: true,
      periodKey: true,
      currentStatutoryDate: true,
      clientDocumentCutoff: true,
    },
    orderBy: { currentStatutoryDate: "asc" },
    take: 25,
  });

  const agreedDates: PortalAgreedDate[] = [];
  for (const o of obligations) {
    agreedDates.push({
      kind: "STATUTORY_DUE",
      label: `Statutory due date — ${o.periodKey}`,
      date: o.currentStatutoryDate,
    });
    if (o.clientDocumentCutoff && o.clientDocumentCutoff >= startOfDay(now)) {
      agreedDates.push({
        kind: "DOCUMENT_CUTOFF",
        label: `Documents needed from you — ${o.periodKey}`,
        date: o.clientDocumentCutoff,
      });
    }
  }
  for (const r of requests) {
    if (r.dueDate && r.dueDate >= startOfDay(now)) {
      agreedDates.push({ kind: "REQUEST_DUE", label: r.title, date: r.dueDate });
    }
  }
  agreedDates.sort((a, b) => a.date.getTime() - b.date.getTime());

  // ---- released deliverables (POR01 "released deliverables")

  const releaseRows = await prisma.documentReleaseRecipient.findMany({
    where: {
      practiceId: params.practiceId,
      contactId: params.contactId,
      clientRelationshipId: params.clientRelationshipId,
      release: {
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
    },
    select: {
      release: {
        select: {
          id: true,
          documentVersionId: true,
          createdAt: true,
          expiresAt: true,
          documentVersion: {
            select: {
              versionNo: true,
              document: {
                select: { title: true, workingPaper: true, clientRelationshipId: true },
              },
            },
          },
        },
      },
    },
  });

  const deliverables: PortalDeliverable[] = releaseRows
    .filter((row) => {
      const doc = row.release.documentVersion.document;
      // DOC04 belt and braces: a release is already a deliberate act, but
      // "internal audit working papers are not automatically client
      // deliverables" is the rule most expensive to get wrong, so a working
      // paper is refused here even if something upstream released one.
      if (doc.workingPaper) return false;
      // And the document must belong to the entity being viewed — a release to
      // this contact for their OTHER company must not surface here.
      return doc.clientRelationshipId === params.clientRelationshipId;
    })
    .map((row) => ({
      releaseId: row.release.id,
      documentVersionId: row.release.documentVersionId,
      title: row.release.documentVersion.document.title,
      versionNo: row.release.documentVersion.versionNo,
      releasedAt: row.release.createdAt,
      expiresAt: row.release.expiresAt,
    }))
    .sort((a, b) => b.releasedAt.getTime() - a.releasedAt.getTime());

  // ---- issued invoices (POR01 "issued invoices")

  const invoiceRows = await prisma.invoice.findMany({
    where: {
      ...scope,
      // DAT02: only an ISSUED invoice is a fact about the client. A draft is
      // internal working material and a cancelled one is not payable.
      status: "ISSUED",
      issuedAt: { not: null },
    },
    // NOT selected: issuedSnapshot (it holds internal particulars alongside the
    // client's), subtotal/taxTotal (R1 tax presentation, T14), version.
    select: {
      id: true,
      sequenceNumber: true,
      currency: true,
      total: true,
      issuedAt: true,
      series: { select: { code: true, fiscalPeriod: true } },
    },
    orderBy: { issuedAt: "desc" },
    take: 25,
  });

  const invoices: PortalInvoice[] = invoiceRows.map((i) => ({
    id: i.id,
    reference: `${i.series.code}/${i.series.fiscalPeriod}/${i.sequenceNumber}`,
    issuedAt: i.issuedAt as Date,
    currency: i.currency,
    total: i.total.toFixed(2),
  }));

  // ---- POR05 support route

  const support = await listSupportContacts(params.practiceId, now);

  return {
    practice: { id: practice.id, name: practice.registeredDisplayName ?? practice.name },
    entities,
    active,
    requests,
    agreedDates,
    deliverables,
    invoices,
    support,
  };
}

/**
 * POR05: "a call / message route using verified firm contact details
 * configured by the owner."
 *
 * Unverified rows are withheld. A support number nobody has checked is worse
 * than none at all — it sends a client with a real problem somewhere unknown,
 * and it is exactly what an attacker would try to insert.
 */
export async function listSupportContacts(
  practiceId: string,
  now: Date = new Date(),
): Promise<PortalSupportContact[]> {
  const rows = await prisma.practiceSupportContact.findMany({
    where: {
      practiceId,
      archivedAt: null,
      verifiedAt: { not: null },
      effectiveFrom: { lte: now },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
    },
    select: { label: true, phone: true, email: true, helpUrl: true, hoursLabel: true },
    orderBy: { effectiveFrom: "asc" },
  });
  return rows;
}

function startOfDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
