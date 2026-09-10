import { NextResponse } from "next/server";
import { badRequest, errorResponse, notFound } from "@/lib/api";
import { assertCsrf } from "@/lib/csrf";
import { requireUserId } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { issueCreditNote } from "@/lib/invoicing";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ creditNoteId: string }> },
) {
  try {
    const userId = await requireUserId();
    await assertCsrf(request);

    const { creditNoteId } = await context.params;
    const body = await request.json();

    if (typeof body.expectedVersion !== "number") {
      return badRequest("expectedVersion is required", "BAD_REQUEST");
    }

    const note = await prisma.creditNote.findUnique({
      where: { id: creditNoteId },
      select: { practiceId: true },
    });
    if (!note) {
      return notFound();
    }

    const actor = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { fullName: true },
    });

    const issued = await issueCreditNote({
      userId,
      reviewerName: actor.fullName,
      practiceId: note.practiceId,
      creditNoteId,
      expectedVersion: body.expectedVersion,
    });

    return NextResponse.json({ ok: true, number: issued.displayNumber, status: issued.status });
  } catch (e) {
    return errorResponse(e);
  }
}
