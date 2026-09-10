import { NextResponse } from "next/server";
import { badRequest, errorResponse } from "@/lib/api";
import { assertCsrf } from "@/lib/csrf";
import { requireUserId } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { issuePortalInvitation, revokePortalInvitation } from "@/lib/portal-auth";

export const dynamic = "force-dynamic";

/**
 * POR02, staff side: "Invite a named contact with client, practice and
 * authority scope."
 *
 * Deliberately NOT under `/api/portal/*`. Everything under that prefix is
 * reached with a portal session; this is a staff action needing `client.write`,
 * and keeping the two apart means a portal cookie can never be presented to an
 * invitation-issuing endpoint.
 */
export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    await assertCsrf(request);

    const body = await request.json();
    const practiceId = String(body.practiceId ?? "").trim();
    const contactId = String(body.contactId ?? "").trim();
    const grants = Array.isArray(body.grants) ? body.grants : [];

    if (!practiceId || !contactId) {
      return badRequest("practiceId and contactId are required", "BAD_REQUEST");
    }

    const actor = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { fullName: true },
    });

    const invitation = await issuePortalInvitation({
      practiceId,
      contactId,
      grants: grants.map((g: { clientRelationshipId?: unknown; authority?: unknown }) => ({
        clientRelationshipId: String(g.clientRelationshipId ?? ""),
        authority: String(g.authority ?? "VIEW") as never,
      })),
      invitedByUserId: userId,
      invitedByName: actor.fullName,
    });

    // The raw token is returned to the ISSUING STAFF MEMBER once, to be sent to
    // the contact through a channel the firm has verified. It is never stored
    // in plaintext and never appears in the audit trail.
    return NextResponse.json({
      invitationId: invitation.invitationId,
      token: invitation.token,
      expiresAt: invitation.expiresAt,
    });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(request: Request) {
  try {
    const userId = await requireUserId();
    await assertCsrf(request);

    const body = await request.json();
    const invitationId = String(body.invitationId ?? "").trim();
    const reason = String(body.reason ?? "").trim();

    if (!invitationId || !reason) {
      return badRequest("invitationId and a reason are required", "BAD_REQUEST");
    }

    await revokePortalInvitation({ invitationId, actorUserId: userId, reason });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
