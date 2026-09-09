/**
 * Portal authentication — POR02, POR05 (PRD §17).
 *
 * PRD §17 ends with "Separate portal authentication from internal staff
 * administration." This file is that separation made real: nothing here reads
 * or writes `User`, `Session` or `Invitation`, and a portal token lives in its
 * own cookie so it can never be presented as a staff token or the reverse.
 *
 * The other rule that shapes this file is POR02's last sentence — "public self
 * registration cannot discover existing client accounts." There is deliberately
 * no lookup by email, no "is this address registered" path, and every failed
 * redemption returns ONE response with ONE message. An unknown token, an
 * expired token, a revoked token and an already-used token are indistinguishable
 * from outside, because any difference between them tells an unauthenticated
 * visitor something true about a client of this firm.
 */

import { prisma } from "@/lib/prisma";
import { generateToken, hashToken } from "@/lib/crypto";
import { recordEvent } from "@/lib/audit";
import { assertCan } from "@/lib/permissions";
import type { ContactAuthorityLevel } from "@/generated/prisma/enums";

export class PortalAuthError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(message: string, code: string, status = 401) {
    super(message);
    this.name = "PortalAuthError";
    this.code = code;
    this.status = status;
  }
}

/**
 * The single response every dead invitation gets. It says what to do next
 * without confirming that the token ever existed, which client it belonged to,
 * or which of the four possible reasons applies.
 */
export const INVITATION_UNUSABLE_MESSAGE =
  "This link cannot be used. It may have expired or already been used. " +
  "You can request a new one and the team will send it to the address they hold.";

export const PORTAL_SESSION_COOKIE = "bhv_portal_session";

/** POR02: an invitation is short-lived by design. */
export const INVITATION_TTL_MS = 7 * 24 * 3600_000;

/**
 * Matched to the staff session windows rather than loosened for convenience.
 * A client contact reaches real client records through this cookie; there is
 * no argument for it outliving a staff session.
 */
export const PORTAL_IDLE_TIMEOUT_MS = 30 * 60_000;
export const PORTAL_ABSOLUTE_TIMEOUT_MS = 12 * 3600_000;

// --------------------------------------------------------------- invitations

/**
 * POR02: "Invite a named contact with client, practice and authority scope."
 *
 * The authority scope is not stored on the invitation — it is granted as
 * `ContactAuthority` rows, which is the same record every other part of the
 * system already consults. An invitation that carried its own private notion of
 * authority would be a second answer to "what may this contact do", and the two
 * would eventually disagree.
 */
export async function issuePortalInvitation(params: {
  practiceId: string;
  contactId: string;
  /** Relationships this contact may act for, with the authority on each. */
  grants: { clientRelationshipId: string; authority: ContactAuthorityLevel }[];
  invitedByUserId: string;
  invitedByName: string;
  ttlMs?: number;
  now?: Date;
}) {
  const now = params.now ?? new Date();

  // IAM01: issuing portal access is a client write in THIS practice.
  await assertCan(params.invitedByUserId, params.practiceId, "client.write");

  const contact = await prisma.contact.findUnique({
    where: { id: params.contactId },
    select: { id: true, partyId: true, archivedAt: true },
  });
  if (!contact || contact.archivedAt) {
    throw new PortalAuthError("Not found", "CONTACT_NOT_FOUND", 404);
  }

  if (params.grants.length === 0) {
    throw new PortalAuthError(
      "A portal invitation must name at least one client entity the contact may act for.",
      "INVITATION_UNSCOPED",
      400,
    );
  }

  // Every named relationship must belong to THIS practice. Without this check
  // an invitation could hand a contact a live grant against another firm's
  // client, which is the exact cross-practice disclosure ORG04 exists to stop.
  const relationships = await prisma.clientRelationship.findMany({
    where: {
      id: { in: params.grants.map((g) => g.clientRelationshipId) },
      practiceId: params.practiceId,
      archivedAt: null,
    },
    select: { id: true },
  });
  const reachable = new Set(relationships.map((r) => r.id));
  for (const grant of params.grants) {
    if (!reachable.has(grant.clientRelationshipId)) {
      throw new PortalAuthError("Not found", "RELATIONSHIP_NOT_FOUND", 404);
    }
  }

  const token = generateToken();

  const invitation = await prisma.$transaction(async (tx) => {
    for (const grant of params.grants) {
      const existing = await tx.contactAuthority.findFirst({
        where: {
          contactId: params.contactId,
          clientRelationshipId: grant.clientRelationshipId,
          practiceId: params.practiceId,
          authority: grant.authority,
          revokedAt: null,
        },
        select: { id: true },
      });
      if (!existing) {
        await tx.contactAuthority.create({
          data: {
            practiceId: params.practiceId,
            contactId: params.contactId,
            clientRelationshipId: grant.clientRelationshipId,
            authority: grant.authority,
            effectiveFrom: now,
          },
        });
      }
    }

    return tx.portalInvitation.create({
      data: {
        practiceId: params.practiceId,
        contactId: params.contactId,
        tokenHash: hashToken(token),
        expiresAt: new Date(now.getTime() + (params.ttlMs ?? INVITATION_TTL_MS)),
        invitedByUserId: params.invitedByUserId,
        invitedByName: params.invitedByName,
      },
    });
  });

  await recordEvent({
    action: "PORTAL_INVITATION_ISSUED",
    targetType: "PortalInvitation",
    targetId: invitation.id,
    result: "SUCCESS",
    actorUserId: params.invitedByUserId,
    practiceId: params.practiceId,
    // The token itself is never audited — an audit reader must not be able to
    // redeem an invitation out of the log.
    afterMeta: {
      contactId: params.contactId,
      grants: params.grants.map((g) => ({
        clientRelationshipId: g.clientRelationshipId,
        authority: g.authority,
      })),
      expiresAt: invitation.expiresAt.toISOString(),
    },
  });

  // Returned once. Only the hash is stored.
  return { invitationId: invitation.id, token, expiresAt: invitation.expiresAt };
}

/**
 * Redeem an invitation and open a portal session.
 *
 * Every failure path throws the SAME error with the SAME message — see this
 * file's header. The distinguishing detail goes to the audit log, where staff
 * can see it and an unauthenticated visitor cannot.
 */
export async function acceptPortalInvitation(params: {
  token: string;
  userAgent?: string;
  now?: Date;
}) {
  const now = params.now ?? new Date();

  const invitation = await prisma.portalInvitation.findUnique({
    where: { tokenHash: hashToken(params.token) },
    select: {
      id: true,
      practiceId: true,
      contactId: true,
      expiresAt: true,
      acceptedAt: true,
      revokedAt: true,
      contact: { select: { archivedAt: true } },
    },
  });

  const refuse = async (reason: string, invitationId: string | null) => {
    await recordEvent({
      action: "PORTAL_INVITATION_REFUSED",
      targetType: "PortalInvitation",
      targetId: invitationId ?? "unknown",
      result: "FAILURE",
      practiceId: invitation?.practiceId ?? null,
      reason,
    });
    throw new PortalAuthError(INVITATION_UNUSABLE_MESSAGE, "INVITATION_UNUSABLE", 401);
  };

  if (!invitation) await refuse("No invitation matches the presented token", null);
  // Narrowing: refuse() always throws, but TypeScript cannot see that through
  // the await, so the guard is repeated as a plain check.
  if (!invitation) throw new PortalAuthError(INVITATION_UNUSABLE_MESSAGE, "INVITATION_UNUSABLE", 401);

  if (invitation.revokedAt) await refuse("Invitation revoked", invitation.id);
  if (invitation.acceptedAt) await refuse("Invitation already used (single use)", invitation.id);
  if (invitation.expiresAt <= now) await refuse("Invitation expired", invitation.id);
  if (invitation.contact.archivedAt) await refuse("Contact archived", invitation.id);

  // A contact with no live authority anywhere has nothing to sign in TO. This
  // is checked at redemption rather than only at issue, because authority can
  // be revoked in the days between the two.
  const authorities = await liveAuthorities(invitation.contactId, invitation.practiceId, now);
  if (authorities.length === 0) {
    await refuse("Contact holds no live authority in this practice", invitation.id);
  }

  const token = generateToken();

  const session = await prisma.$transaction(async (tx) => {
    // Single use is enforced by a CONDITIONAL update, not by the read above: two
    // simultaneous redemptions of one link must not both succeed, and the read
    // cannot prevent that on its own.
    const claimed = await tx.portalInvitation.updateMany({
      where: { id: invitation.id, acceptedAt: null, revokedAt: null },
      data: { acceptedAt: now },
    });
    if (claimed.count !== 1) {
      throw new PortalAuthError(INVITATION_UNUSABLE_MESSAGE, "INVITATION_UNUSABLE", 401);
    }

    return tx.portalSession.create({
      data: {
        contactId: invitation.contactId,
        practiceId: invitation.practiceId,
        tokenHash: hashToken(token),
        userAgent: params.userAgent,
        idleExpiresAt: new Date(now.getTime() + PORTAL_IDLE_TIMEOUT_MS),
        absoluteExpiresAt: new Date(now.getTime() + PORTAL_ABSOLUTE_TIMEOUT_MS),
      },
    });
  });

  await recordEvent({
    action: "PORTAL_SESSION_OPENED",
    targetType: "PortalSession",
    targetId: session.id,
    result: "SUCCESS",
    practiceId: invitation.practiceId,
    afterMeta: { contactId: invitation.contactId, viaInvitationId: invitation.id },
  });

  return {
    sessionId: session.id,
    token,
    expiresAt: session.absoluteExpiresAt,
    contactId: invitation.contactId,
    practiceId: invitation.practiceId,
  };
}

/**
 * POR05 "clear recovery for expired links", and the acceptance evidence: "an
 * expired invitation gives a safe renewal request without identifying the
 * client to an unauthenticated visitor."
 *
 * The dead token is the whole request. It is enough for staff to find the row
 * and re-send, and it requires the visitor to name nobody — so the response is
 * the same acknowledgement whether or not the token matched anything.
 */
export async function requestInvitationRenewal(params: { token: string; now?: Date }) {
  const now = params.now ?? new Date();

  const invitation = await prisma.portalInvitation.findUnique({
    where: { tokenHash: hashToken(params.token) },
    select: { id: true, practiceId: true, contactId: true, renewalCount: true },
  });

  if (invitation) {
    await prisma.portalInvitation.update({
      where: { id: invitation.id },
      data: { renewalRequestedAt: now, renewalCount: invitation.renewalCount + 1 },
    });

    await recordEvent({
      action: "PORTAL_INVITATION_RENEWAL_REQUESTED",
      targetType: "PortalInvitation",
      targetId: invitation.id,
      result: "SUCCESS",
      practiceId: invitation.practiceId,
      afterMeta: { contactId: invitation.contactId, renewalCount: invitation.renewalCount + 1 },
    });
  } else {
    // Recorded so a spray of guessed tokens is visible to monitoring, and
    // deliberately WITHOUT the token — the log is not a place to accumulate
    // credential guesses.
    await recordEvent({
      action: "PORTAL_INVITATION_RENEWAL_UNMATCHED",
      targetType: "PortalInvitation",
      targetId: "unknown",
      result: "FAILURE",
      reason: "Renewal requested with a token that matches no invitation",
    });
  }

  // Identical either way.
  return {
    acknowledged: true,
    message:
      "Thanks — we've passed this to the team. If the link belonged to a live " +
      "client account, they'll send a fresh one to the contact details on file.",
  };
}

export async function revokePortalInvitation(params: {
  invitationId: string;
  actorUserId: string;
  reason: string;
}) {
  const invitation = await prisma.portalInvitation.findUniqueOrThrow({
    where: { id: params.invitationId },
    select: { id: true, practiceId: true },
  });
  await assertCan(params.actorUserId, invitation.practiceId, "client.write");

  const updated = await prisma.portalInvitation.update({
    where: { id: invitation.id },
    data: { revokedAt: new Date(), revokedReason: params.reason },
  });

  await recordEvent({
    action: "PORTAL_INVITATION_REVOKED",
    targetType: "PortalInvitation",
    targetId: updated.id,
    result: "SUCCESS",
    actorUserId: params.actorUserId,
    practiceId: updated.practiceId,
    reason: params.reason,
  });

  return updated;
}

// ------------------------------------------------------------------ sessions

export type PortalActor = {
  sessionId: string;
  contactId: string;
  practiceId: string;
};

/**
 * Expiry and revocation are enforced HERE, per request, exactly as AUTH02
 * requires for staff. An unexpired cookie is not evidence of a live session.
 */
export async function validatePortalSession(
  token: string,
  now: Date = new Date(),
): Promise<PortalActor> {
  const session = await prisma.portalSession.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      id: true,
      contactId: true,
      practiceId: true,
      revokedAt: true,
      idleExpiresAt: true,
      absoluteExpiresAt: true,
      contact: { select: { archivedAt: true } },
    },
  });

  if (!session) throw new PortalAuthError("Session not found.", "PORTAL_SESSION_INVALID");
  if (session.revokedAt) throw new PortalAuthError("Session revoked.", "PORTAL_SESSION_REVOKED");
  if (session.absoluteExpiresAt <= now) {
    throw new PortalAuthError("Session expired.", "PORTAL_SESSION_EXPIRED");
  }
  if (session.idleExpiresAt <= now) {
    throw new PortalAuthError("Session expired after inactivity.", "PORTAL_SESSION_IDLE_EXPIRED");
  }
  if (session.contact.archivedAt) {
    throw new PortalAuthError("Session revoked.", "PORTAL_SESSION_REVOKED");
  }

  // A contact whose authority was revoked mid-session loses access on the very
  // next request. Checking only at sign-in would leave a live window after a
  // client told us someone had left.
  const authorities = await liveAuthorities(session.contactId, session.practiceId, now);
  if (authorities.length === 0) {
    await prisma.portalSession.update({
      where: { id: session.id },
      data: { revokedAt: now, revokedReason: "No live authority remains for this contact" },
    });
    throw new PortalAuthError("Session revoked.", "PORTAL_SESSION_REVOKED");
  }

  await prisma.portalSession.update({
    where: { id: session.id },
    data: {
      lastSeenAt: now,
      idleExpiresAt: new Date(
        Math.min(now.getTime() + PORTAL_IDLE_TIMEOUT_MS, session.absoluteExpiresAt.getTime()),
      ),
    },
  });

  return {
    sessionId: session.id,
    contactId: session.contactId,
    practiceId: session.practiceId,
  };
}

export async function revokePortalSession(sessionId: string, reason: string) {
  return prisma.portalSession.update({
    where: { id: sessionId },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
}

/**
 * The cookie attributes a portal session is carried with.
 *
 * `path: "/"`, not `/portal`. A cookie carries ONE path prefix, and the portal
 * spans two — the screens under `/portal` and the API under `/api/portal` — so
 * a narrower path would simply stop the API receiving it. The separation from
 * staff authentication is carried by the cookie NAME instead, which is the part
 * that actually does the work: `requireActor` reads only `bhv_session` and
 * `requirePortalContact` reads only this one, so neither resolver can be handed
 * the other's token whatever path it arrives on.
 */
export function portalCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    expires: expiresAt,
  };
}

// ----------------------------------------------------------------- authority

export type LiveAuthority = {
  clientRelationshipId: string;
  authority: ContactAuthorityLevel;
};

/**
 * The single source of "what may this contact reach right now", used by
 * sign-in, by every request, and by the entity switcher. One function, so the
 * switcher can never offer an entity the request path would refuse.
 */
export async function liveAuthorities(
  contactId: string,
  practiceId: string,
  now: Date = new Date(),
): Promise<LiveAuthority[]> {
  const rows = await prisma.contactAuthority.findMany({
    where: {
      contactId,
      practiceId,
      revokedAt: null,
      effectiveFrom: { lte: now },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
      // An archived or terminated client relationship is not something to
      // hand back to a portal user, however live the grant on it looks.
      clientRelationship: { archivedAt: null },
    },
    select: { clientRelationshipId: true, authority: true },
  });

  return rows.map((r) => ({
    clientRelationshipId: r.clientRelationshipId,
    authority: r.authority,
  }));
}

/**
 * Assert this contact may act for this relationship, optionally at a minimum
 * authority. Throws 404, never 403: a relationship the contact may not reach
 * must not be confirmed to exist, which is the same rule the staff API follows
 * for a practice the caller cannot see.
 */
export async function assertPortalAccess(params: {
  contactId: string;
  practiceId: string;
  clientRelationshipId: string;
  requires?: ContactAuthorityLevel[];
  now?: Date;
}): Promise<LiveAuthority[]> {
  const now = params.now ?? new Date();
  const authorities = await liveAuthorities(params.contactId, params.practiceId, now);
  const forRelationship = authorities.filter(
    (a) => a.clientRelationshipId === params.clientRelationshipId,
  );

  if (forRelationship.length === 0) {
    throw new PortalAuthError("Not found", "PORTAL_ENTITY_NOT_FOUND", 404);
  }

  if (params.requires && params.requires.length > 0) {
    const held = new Set(forRelationship.map((a) => a.authority));
    if (!params.requires.some((r) => held.has(r))) {
      throw new PortalAuthError("Not found", "PORTAL_ENTITY_NOT_FOUND", 404);
    }
  }

  return forRelationship;
}
