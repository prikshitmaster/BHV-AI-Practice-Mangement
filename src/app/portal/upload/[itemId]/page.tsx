import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { optionalPortalContact } from "@/lib/portal-session";
import { assertPortalAccess, PortalAuthError } from "@/lib/portal-auth";
import { ITEM_STATUS_LABEL, portalItemStatus } from "@/lib/portal";
import { PortalUploader } from "@/components/portal-uploader";
import { EmptyState, Screen } from "@/components/states";

export const dynamic = "force-dynamic";

/**
 * POR03: "Guide the user by service and period."
 *
 * The guidance is the item itself — what document, for which period, why it was
 * asked for, and (when it came back) what needs correcting. A bare file input
 * with no context is what makes clients send the wrong year's accounts.
 */
export default async function PortalUploadPage({
  params,
}: {
  params: Promise<{ itemId: string }>;
}) {
  const actor = await optionalPortalContact();
  if (!actor) redirect("/portal/help");

  const { itemId } = await params;

  const item = await prisma.clientRequestItem.findFirst({
    where: { id: itemId, practiceId: actor.practiceId },
    // NOT selected: ownerUserId, remindersStoppedAt. Who internally chases this
    // item is staff allocation, and POR01 forbids exposing it.
    select: {
      id: true,
      documentType: true,
      description: true,
      periodLabel: true,
      dueDate: true,
      state: true,
      // ClientRequest carries `engagementId` but declares no `engagement`
      // relation, so the service code is read separately below.
      request: {
        select: {
          id: true,
          title: true,
          detail: true,
          clientRelationshipId: true,
          engagementId: true,
          clientRelationship: { select: { party: { select: { legalName: true } } } },
        },
      },
      responses: {
        where: { rejectedAt: { not: null }, supersededAt: null },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { rejectionReason: true },
      },
    },
  });

  // Unknown item and someone else's item are the same answer, before any
  // authority check runs — so a guessed id cannot even confirm existence.
  if (!item) {
    return (
      <div className="portal-page">
        <EmptyState
          title="We can't find that request"
          body="The link may be out of date. Your open requests are on your documents page."
        />
        <p>
          <Link href="/portal">Back to your documents</Link>
        </p>
      </div>
    );
  }

  // The contact must hold a live upload authority for the entity this item
  // belongs to — checked here, and again inside every upload call.
  try {
    await assertPortalAccess({
      contactId: actor.contactId,
      practiceId: actor.practiceId,
      clientRelationshipId: item.request.clientRelationshipId,
      requires: ["UPLOAD", "APPROVE", "SIGNATORY"],
    });
  } catch (e) {
    if (e instanceof PortalAuthError) {
      return (
        <div className="portal-page">
          <EmptyState
            title="We can't find that request"
            body="The link may be out of date. Your open requests are on your documents page."
          />
          <p>
            <Link href="/portal">Back to your documents</Link>
          </p>
        </div>
      );
    }
    throw e;
  }

  const engagement = item.request.engagementId
    ? await prisma.engagement.findFirst({
        where: { id: item.request.engagementId, practiceId: actor.practiceId },
        select: { serviceCode: true },
      })
    : null;

  const status = portalItemStatus(item.state);
  const correctionReason =
    status === "NEEDS_CORRECTION" ? (item.responses[0]?.rejectionReason ?? null) : null;

  return (
    <div className="portal-page">
      <Screen
        title={item.documentType}
        lede={item.request.title}
        breadcrumbs={[{ href: "/portal", label: "Your documents" }]}
      >
        <dl className="portal-context">
          <div>
            <dt>Entity</dt>
            <dd>{item.request.clientRelationship.party.legalName}</dd>
          </div>
          {engagement?.serviceCode ? (
            <div>
              <dt>Service</dt>
              <dd>{engagement.serviceCode}</dd>
            </div>
          ) : null}
          {item.periodLabel ? (
            <div>
              <dt>Period</dt>
              <dd>{item.periodLabel}</dd>
            </div>
          ) : null}
          {item.dueDate ? (
            <div>
              <dt>Needed by</dt>
              <dd>
                {new Date(item.dueDate).toLocaleDateString("en-IN", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                  timeZone: "Asia/Kolkata",
                })}
              </dd>
            </div>
          ) : null}
          <div>
            <dt>Status</dt>
            <dd>{ITEM_STATUS_LABEL[status]}</dd>
          </div>
        </dl>

        {item.description ? <p>{item.description}</p> : null}
        {item.request.detail ? <p className="muted">{item.request.detail}</p> : null}

        {correctionReason ? (
          <div className="state state--error" role="alert">
            <p className="state-title">This needs correcting</p>
            <p className="state-body">{correctionReason}</p>
          </div>
        ) : null}

        {status === "ACCEPTED" ? (
          <EmptyState
            title="This one is done"
            body="The team has accepted this document. You can still send a newer copy if something has changed."
          />
        ) : null}

        <PortalUploader
          clientRelationshipId={item.request.clientRelationshipId}
          itemId={item.id}
          documentType={item.documentType}
        />

        <p>
          <Link href="/portal/help">Something wrong? Contact the team</Link>
        </p>
      </Screen>
    </div>
  );
}
