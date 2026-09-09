import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { assertPracticeAccess } from "@/lib/practice-scope";
import { requireUserId } from "@/lib/session";
import { errorResponse } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * ORG05 — explicit cross-practice sharing.
 *
 * A grant must name the receiving practice, the purpose and an expiry, and is
 * pinned to one exact subject version so a later version does not inherit it.
 * Only the practice that OWNS the subject may share it.
 */
export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const body = (await request.json()) as {
      sharingPracticeId?: string;
      receivingPracticeId?: string;
      subjectType?: "DOCUMENT_VERSION" | "CONTACT_FIELD";
      subjectId?: string;
      subjectVersion?: number;
      purpose?: string;
      expiresAt?: string;
    };

    if (
      !body.sharingPracticeId ||
      !body.receivingPracticeId ||
      !body.subjectType ||
      !body.subjectId ||
      !body.purpose ||
      !body.expiresAt
    ) {
      return NextResponse.json(
        {
          error:
            "sharingPracticeId, receivingPracticeId, subjectType, subjectId, purpose and expiresAt are required",
        },
        { status: 400 },
      );
    }

    if (body.sharingPracticeId === body.receivingPracticeId) {
      return NextResponse.json(
        { error: "A practice cannot grant itself access" },
        { status: 400 },
      );
    }

    const expiresAt = new Date(body.expiresAt);
    if (Number.isNaN(expiresAt.getTime()) || expiresAt <= new Date()) {
      return NextResponse.json(
        { error: "expiresAt must be a future date — grants cannot be open-ended" },
        { status: 400 },
      );
    }

    // Only the owning practice may share, and the caller must be in it.
    await assertPracticeAccess(userId, body.sharingPracticeId);

    if (body.subjectType === "DOCUMENT_VERSION") {
      const owned = await prisma.documentVersion.findFirst({
        where: { id: body.subjectId, practiceId: body.sharingPracticeId },
        select: { id: true, versionNo: true },
      });
      if (!owned) return NextResponse.json({ error: "Not found" }, { status: 404 });

      // Pin the grant to the version that actually exists right now.
      body.subjectVersion = owned.versionNo;
    }

    const actor = await prisma.user.findUnique({
      where: { id: userId },
      select: { fullName: true },
    });

    const share = await prisma.crossPracticeShare.create({
      data: {
        sharingPracticeId: body.sharingPracticeId,
        receivingPracticeId: body.receivingPracticeId,
        subjectType: body.subjectType,
        subjectId: body.subjectId,
        subjectVersion: body.subjectVersion ?? null,
        purpose: body.purpose,
        expiresAt,
        grantedByUserId: userId,
        grantedByName: actor?.fullName ?? "Unknown",
      },
    });

    await prisma.event.create({
      data: {
        practiceId: body.sharingPracticeId,
        actorUserId: userId,
        targetType: "CrossPracticeShare",
        targetId: share.id,
        action: "CROSS_PRACTICE_SHARE_GRANTED",
        result: "SUCCESS",
        afterMeta: {
          receivingPracticeId: body.receivingPracticeId,
          subjectType: body.subjectType,
          subjectId: body.subjectId,
          subjectVersion: body.subjectVersion ?? null,
          purpose: body.purpose,
          expiresAt: expiresAt.toISOString(),
        },
      },
    });

    return NextResponse.json({ share }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}

/** Revocation removes FUTURE access; it cannot retract downloaded copies. */
export async function DELETE(request: Request) {
  try {
    const userId = await requireUserId();
    const shareId = new URL(request.url).searchParams.get("shareId");

    if (!shareId) {
      return NextResponse.json({ error: "shareId is required" }, { status: 400 });
    }

    const share = await prisma.crossPracticeShare.findUnique({
      where: { id: shareId },
      select: { id: true, sharingPracticeId: true, accessCount: true, revokedAt: true },
    });

    if (!share) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await assertPracticeAccess(userId, share.sharingPracticeId);

    const actor = await prisma.user.findUnique({
      where: { id: userId },
      select: { fullName: true },
    });

    const revoked = await prisma.crossPracticeShare.update({
      where: { id: shareId },
      data: { revokedAt: new Date(), revokedByName: actor?.fullName ?? "Unknown" },
    });

    await prisma.event.create({
      data: {
        practiceId: share.sharingPracticeId,
        actorUserId: userId,
        targetType: "CrossPracticeShare",
        targetId: share.id,
        action: "CROSS_PRACTICE_SHARE_REVOKED",
        result: "SUCCESS",
        afterMeta: {
          // Stated plainly rather than implying the data was clawed back.
          alreadyAccessedTimes: share.accessCount,
          note: "Revocation blocks future access only; downloaded copies cannot be retracted.",
        },
      },
    });

    return NextResponse.json({ share: revoked });
  } catch (e) {
    return errorResponse(e);
  }
}
