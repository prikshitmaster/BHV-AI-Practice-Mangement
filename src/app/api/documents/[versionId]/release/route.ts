import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/session";
import { errorResponse } from "@/lib/api";
import { assertCsrf } from "@/lib/csrf";
import { issueAccessToken, releaseVersion } from "@/lib/documents";

export const dynamic = "force-dynamic";

/**
 * DOC04 — a reviewer releases this EXACT version to named contacts.
 *
 * The version id comes from the URL, but it is never trusted on its own:
 * `releaseVersion` re-reads it under the practice scope, so a version id from
 * another firm resolves to nothing.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ versionId: string }> },
) {
  try {
    const { versionId } = await params;
    const userId = await requireUserId();
    await assertCsrf(request);

    const body = (await request.json()) as {
      practiceId?: string;
      contactIds?: string[];
      expiresAt?: string;
      reason?: string;
      issueLinks?: boolean;
    };

    if (!body.practiceId || !body.contactIds?.length) {
      return NextResponse.json(
        { error: "practiceId and at least one contactId are required" },
        { status: 400 },
      );
    }

    const release = await releaseVersion({
      actorUserId: userId,
      practiceId: body.practiceId,
      versionId,
      contactIds: body.contactIds,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
      reason: body.reason,
    });

    // The plaintext tokens are returned once, here, and only their hashes are
    // stored. There is no endpoint that can read a link back later.
    const links = body.issueLinks
      ? await Promise.all(
          release.recipients.map(async (r) => {
            const t = await issueAccessToken({
              practiceId: body.practiceId!,
              documentVersionId: versionId,
              releaseId: release.id,
              issuedToContactId: r.contactId,
              issuedByUserId: userId,
              purpose: "CLIENT_DELIVERABLE",
            });
            return { contactId: r.contactId, token: t.token, expiresAt: t.expiresAt };
          }),
        )
      : [];

    return NextResponse.json({
      releaseId: release.id,
      versionId,
      recipients: release.recipients.map((r) => ({
        contactId: r.contactId,
        name: r.contactNameAtRelease,
      })),
      links,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
