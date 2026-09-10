import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/session";
import { badRequest, errorResponse } from "@/lib/api";
import { assertCsrf } from "@/lib/csrf";
import { sendOutbound } from "@/lib/communication";

export const dynamic = "force-dynamic";

/**
 * COM03/COM04 — send.
 *
 * `confirmedPreviewHash` is mandatory. There is no path through this route that
 * sends something the caller has not confirmed, and the practice identity used
 * is the one resolved server-side from the subject record, never a value taken
 * from this body.
 *
 * A duplicate `dedupKey` returns 200 with `duplicate: true` rather than an
 * error: the caller asked for one logical message and got one. Returning a
 * failure would invite a retry, which is precisely what the key exists to stop.
 */
export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    await assertCsrf(request);
    const body = await request.json();

    const required = ["practiceId", "clientRelationshipId", "confirmedPreviewHash", "dedupKey"];
    const missing = required.filter((k) => !body[k]);
    if (missing.length > 0 || !Array.isArray(body.contactIds)) {
      return badRequest(`Missing: ${[...missing, ...(Array.isArray(body.contactIds) ? [] : ["contactIds"])].join(", ")}`);
    }

    const result = await sendOutbound({
      practiceId: String(body.practiceId),
      actorUserId: userId,
      kind: body.kind ?? "CLIENT_MESSAGE",
      clientRelationshipId: String(body.clientRelationshipId),
      subjectId: body.subjectId ?? null,
      threadId: body.threadId ?? null,
      templateId: body.templateId ?? null,
      subject: String(body.subject ?? ""),
      body: String(body.body ?? ""),
      contactIds: body.contactIds.map(String),
      overrideAddresses: body.overrideAddresses ?? undefined,
      attachedVersionIds: body.attachedVersionIds ?? [],
      portalLinkTokenIds: body.portalLinkTokenIds ?? [],
      confirmedPreviewHash: String(body.confirmedPreviewHash),
      dedupKey: String(body.dedupKey),
    });

    return NextResponse.json({
      messageId: result.message.id,
      state: result.message.state,
      scheduledFor: result.message.scheduledFor,
      sendingPracticeName: result.message.sendingPracticeName,
      duplicate: result.duplicateOf !== null,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
