import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAccessiblePracticeIds, findActiveShare } from "@/lib/practice-scope";
import { requireUserId } from "@/lib/session";
import { apiError, errorResponse, notFound } from "@/lib/api";
import { issueAccessToken } from "@/lib/documents";

export const dynamic = "force-dynamic";

/**
 * ORG acceptance path 5 — object link.
 *
 * The dangerous shortcut here is minting a storage URL from the version id
 * alone, because the object store itself has no idea what a practice is. The
 * scope check therefore happens BEFORE any link exists, and the only way to
 * reach another practice's file is an explicit, unexpired ORG05 grant pinned
 * to this exact version.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ versionId: string }> },
) {
  try {
    const { versionId } = await params;
    const userId = await requireUserId();

    const version = await prisma.documentVersion.findUnique({
      where: { id: versionId },
      select: {
        id: true,
        practiceId: true,
        versionNo: true,
        storageObjectId: true,
        mimeType: true,
        scanVerdict: true,
        document: { select: { legalHold: true } },
      },
    });

    // Unknown id and forbidden id must be indistinguishable.
    if (!version) return notFound();

    const allowed = await getAccessiblePracticeIds(userId);
    let via: "membership" | "share" = "membership";

    if (!allowed.includes(version.practiceId)) {
      // ORG05: a grant is the only other way in — and it is pinned to this
      // version number, so a newer version does not inherit access.
      const share = allowed.length
        ? await findActiveShare({
            receivingPracticeId: allowed[0],
            subjectType: "DOCUMENT_VERSION",
            subjectId: version.id,
            subjectVersion: version.versionNo,
          })
        : null;

      if (!share) {
        await prisma.event.create({
          data: {
            actorUserId: userId,
            targetType: "DocumentVersion",
            targetId: version.id,
            action: "OBJECT_LINK_DENIED",
            result: "FAILURE",
            reason: "No membership and no active cross-practice grant",
          },
        });
        return notFound();
      }

      await prisma.crossPracticeShare.update({
        where: { id: share.id },
        data: { lastAccessedAt: new Date(), accessCount: { increment: 1 } },
      });
      via = "share";
    }

    // DOC02: an unscanned or infected original is never handed out.
    if (version.scanVerdict !== "CLEAN") {
      return apiError(409, "DOCUMENT_NOT_AVAILABLE", "Document not available", {
        scanVerdict: version.scanVerdict,
      });
    }

    // T11 (DOC04): the link handed back is a token bound to a row that is
    // re-authorised on every redemption, NOT a presigned object-store URL.
    // A presigned URL would stay valid for its full lifetime even after this
    // user is suspended, which is exactly what DOC04 forbids. The plaintext
    // token is returned once and only its hash is stored.
    const link = await issueAccessToken({
      practiceId: version.practiceId,
      documentVersionId: version.id,
      issuedToUserId: userId,
      issuedByUserId: userId,
      purpose: via === "share" ? "CROSS_PRACTICE_SHARE" : "STAFF_ACCESS",
      ttlMs: 5 * 60_000,
    });

    return NextResponse.json({
      versionId: version.id,
      url: `/api/documents/link?t=${link.token}`,
      expiresAt: link.expiresAt.toISOString(),
      via,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
