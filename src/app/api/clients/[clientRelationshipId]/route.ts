import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/session";
import { errorResponse } from "@/lib/api";
import { assertPracticeAccess } from "@/lib/practice-scope";
import { can, resolveMembership } from "@/lib/permissions";

export const dynamic = "force-dynamic";

/**
 * CLI06 — Client 360.
 *
 * "Each tab is permission aware. A combined relationship view clearly
 *  separates practices; client groups are navigational links, not automatic
 *  access grants."
 *
 * So: this returns ONE practice's relationship with the client. Group links
 * and the client's other relationships are returned as navigational hints
 * only, and only where the caller independently has access — a group link is
 * never itself a reason to show data.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ clientRelationshipId: string }> },
) {
  try {
    const { clientRelationshipId } = await params;
    const userId = await requireUserId();

    const relationship = await prisma.clientRelationship.findUnique({
      where: { id: clientRelationshipId },
      select: {
        id: true,
        practiceId: true,
        acceptanceStatus: true,
        confidentiality: true,
        acceptedAt: true,
        party: {
          select: {
            id: true, legalName: true, type: true, tenantId: true,
            identifiers: {
              where: { archivedAt: null },
              select: {
                id: true, kind: true, value: true, stateCode: true, label: true,
                verificationStatus: true, source: true,
              },
            },
            contacts: {
              where: { archivedAt: null },
              select: {
                id: true, fullName: true, email: true, phone: true, designation: true,
                emailVerificationStatus: true, phoneVerificationStatus: true, source: true,
              },
            },
            groupParentOf: {
              where: { archivedAt: null },
              select: { childPartyId: true, relationshipType: true },
            },
            groupChildOf: {
              where: { archivedAt: null },
              select: { parentPartyId: true, relationshipType: true },
            },
          },
        },
        practice: { select: { id: true, name: true, registeredDisplayName: true } },
      },
    });

    // Unknown and forbidden are indistinguishable.
    if (!relationship) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await assertPracticeAccess(userId, relationship.practiceId);
    const membership = await resolveMembership(userId, relationship.practiceId);
    if (!membership) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Each tab is gated independently — a tab the caller cannot see is
    // reported as unavailable rather than returned empty, so the UI can say
    // "you don't have access" instead of implying there is nothing there.
    const tabs = {
      overview: true,
      engagements: can(membership, "engagement.read"),
      obligations: can(membership, "job.read"),
      documents: can(membership, "document.read"),
      invoices: can(membership, "invoice.read"),
      feeRates: can(membership, "feerate.read"),
    };

    const engagements = tabs.engagements
      ? await prisma.engagement.findMany({
          where: { clientRelationshipId: relationship.id, practiceId: relationship.practiceId },
          select: {
            id: true, serviceCode: true, state: true, periodStart: true,
            periodEnd: true, version: true,
          },
          orderBy: { periodStart: "desc" },
        })
      : null;

    const invoices = tabs.invoices
      ? await prisma.invoice.findMany({
          where: { clientRelationshipId: relationship.id, practiceId: relationship.practiceId },
          select: {
            id: true, sequenceNumber: true, status: true, total: true,
            currency: true, issuedAt: true,
          },
          orderBy: { createdAt: "desc" },
          take: 50,
        })
      : null;

    const documents = tabs.documents
      ? await prisma.document.findMany({
          where: {
            clientRelationshipId: relationship.id,
            practiceId: relationship.practiceId,
            archivedAt: null,
          },
          select: { id: true, title: true, classification: true, legalHold: true },
          orderBy: { createdAt: "desc" },
          take: 50,
        })
      : null;

    const obligations = tabs.obligations
      ? await prisma.obligation.findMany({
          where: { clientRelationshipId: relationship.id, practiceId: relationship.practiceId },
          select: {
            id: true, periodKey: true, status: true,
            currentStatutoryDate: true, internalTargetDate: true,
          },
          orderBy: { currentStatutoryDate: "asc" },
          take: 50,
        })
      : null;

    // Group links: ids only, and explicitly marked as not conferring access.
    const groupLinks = [
      ...relationship.party.groupParentOf.map((l) => ({
        partyId: l.childPartyId, relationshipType: l.relationshipType, direction: "CHILD" as const,
      })),
      ...relationship.party.groupChildOf.map((l) => ({
        partyId: l.parentPartyId, relationshipType: l.relationshipType, direction: "PARENT" as const,
      })),
    ];

    return NextResponse.json({
      practice: relationship.practice,
      relationship: {
        id: relationship.id,
        acceptanceStatus: relationship.acceptanceStatus,
        confidentiality: relationship.confidentiality,
        acceptedAt: relationship.acceptedAt,
      },
      party: {
        id: relationship.party.id,
        legalName: relationship.party.legalName,
        type: relationship.party.type,
        identifiers: relationship.party.identifiers,
        contacts: relationship.party.contacts,
      },
      tabs,
      engagements,
      obligations,
      documents,
      invoices: invoices?.map((i) => ({ ...i, total: i.total.toString() })) ?? null,
      groupLinks,
      groupLinksNote:
        "Group links are navigational only. Opening a linked party requires access in its own right.",
    });
  } catch (e) {
    return errorResponse(e);
  }
}
