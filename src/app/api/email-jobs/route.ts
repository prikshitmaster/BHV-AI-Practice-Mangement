import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { assertPracticeAccess } from "@/lib/practice-scope";
import { requireUserId } from "@/lib/session";
import { assertCsrf } from "@/lib/csrf";
import { badRequest, errorResponse, notFound } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * ORG acceptance path 6 — queued email job.
 *
 * Background work is the easiest place to lose the practice boundary, because
 * the job runs later without the requester's session. Two defences:
 *   1. the scope check happens at ENQUEUE time, here, while an actor exists;
 *   2. the practice identity is written into the job row, so the worker sends
 *      as that practice rather than re-deriving it (COM03 — a staff member
 *      switching practice cannot send a Company invoice from an Associates
 *      identity).
 *
 * The durable BullMQ queue itself is wired up in T12; this endpoint is the
 * authorisation boundary in front of it.
 */
export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    // SEC03: a session-authenticated mutating endpoint without this is
    // CSRF-able — the cookie travels on a cross-site POST by itself.
    await assertCsrf(request);
    const body = (await request.json()) as {
      practiceId?: string;
      invoiceId?: string;
      to?: string;
    };

    if (!body.practiceId || !body.invoiceId || !body.to) {
      return badRequest("practiceId, invoiceId and to are required");
    }

    await assertPracticeAccess(userId, body.practiceId);

    // The subject must also belong to that practice — a permitted practice id
    // plus another practice's invoice is still a leak.
    const invoice = await prisma.invoice.findFirst({
      where: { id: body.invoiceId, practiceId: body.practiceId },
      select: { id: true, practiceId: true, status: true },
    });

    if (!invoice) return notFound();

    const job = await prisma.event.create({
      data: {
        practiceId: body.practiceId,
        actorUserId: userId,
        targetType: "Invoice",
        targetId: invoice.id,
        action: "EMAIL_JOB_ENQUEUED",
        result: "SUCCESS",
        afterMeta: {
          sendAsPracticeId: body.practiceId,
          recipient: body.to,
          invoiceStatus: invoice.status,
        },
      },
      select: { id: true, practiceId: true, createdAt: true },
    });

    return NextResponse.json({ jobId: job.id, sendAsPracticeId: job.practiceId }, { status: 202 });
  } catch (e) {
    return errorResponse(e);
  }
}
