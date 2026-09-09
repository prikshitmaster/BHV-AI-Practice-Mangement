import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { assertCsrf } from "@/lib/csrf";
import { requirePortalContact } from "@/lib/portal-session";
import { beginPortalUpload } from "@/lib/portal-upload";

export const dynamic = "force-dynamic";

/**
 * POR03 step 1: declare the file before any bytes move.
 *
 * `resumed: true` in the response is the whole resume story — the client
 * reconnecting after a lost tab gets back the upload already in progress, along
 * with the part numbers we already hold, and sends only what is missing.
 */
export async function POST(request: Request) {
  try {
    const actor = await requirePortalContact();
    await assertCsrf(request);

    const body = await request.json();
    const clientRelationshipId = String(body.clientRelationshipId ?? "").trim();
    const filename = String(body.filename ?? "").trim();
    const declaredMimeType = String(body.declaredMimeType ?? "").trim();
    const expectedBytes = Number(body.expectedBytes);

    if (!clientRelationshipId || !filename || !declaredMimeType) {
      return NextResponse.json(
        {
          error: "Tell us which entity this is for, and the file's name and type.",
          code: "BAD_REQUEST",
        },
        { status: 400 },
      );
    }

    const result = await beginPortalUpload({
      contactId: actor.contactId,
      practiceId: actor.practiceId,
      sessionId: actor.sessionId,
      clientRelationshipId,
      itemId: body.itemId ? String(body.itemId) : null,
      filename,
      declaredMimeType,
      expectedBytes,
      expectedSha256: body.expectedSha256 ? String(body.expectedSha256) : null,
    });

    return NextResponse.json(result);
  } catch (e) {
    return errorResponse(e);
  }
}
