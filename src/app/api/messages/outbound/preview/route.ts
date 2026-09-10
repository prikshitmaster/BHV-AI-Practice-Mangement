import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/session";
import { badRequest, errorResponse } from "@/lib/api";
import { assertCsrf } from "@/lib/csrf";
import { buildOutboundPreview } from "@/lib/communication";

export const dynamic = "force-dynamic";

/**
 * COM03 — the confirmation screen's content.
 *
 * Everything the requirement names is returned together (sender practice,
 * From / Reply-to, recipients, attachments and versions) plus the hash that
 * the send will be checked against. Nothing is sent here, and the response
 * carries the refusals the send WOULD make — an unauthorised recipient, an
 * unverified changed address, an attachment that should be a portal link — so
 * the sender sees them before committing rather than as a failure afterwards.
 */
export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    await assertCsrf(request);
    const body = await request.json();

    if (!body.practiceId || !body.clientRelationshipId || !Array.isArray(body.contactIds)) {
      return badRequest("practiceId, clientRelationshipId and contactIds are required", "BAD_REQUEST");
    }

    return NextResponse.json(
      await buildOutboundPreview({
        practiceId: String(body.practiceId),
        actorUserId: userId,
        kind: body.kind ?? "CLIENT_MESSAGE",
        clientRelationshipId: String(body.clientRelationshipId),
        threadId: body.threadId ?? null,
        subject: String(body.subject ?? ""),
        body: String(body.body ?? ""),
        templateId: body.templateId ?? null,
        contactIds: body.contactIds.map(String),
        overrideAddresses: body.overrideAddresses ?? undefined,
        attachedVersionIds: body.attachedVersionIds ?? [],
        portalLinkTokenIds: body.portalLinkTokenIds ?? [],
      }),
    );
  } catch (e) {
    return errorResponse(e);
  }
}
