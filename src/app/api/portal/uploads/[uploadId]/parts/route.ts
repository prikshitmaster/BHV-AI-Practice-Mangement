import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { assertCsrf } from "@/lib/csrf";
import { requirePortalContact } from "@/lib/portal-session";
import { appendPortalUploadPart } from "@/lib/portal-upload";

export const dynamic = "force-dynamic";

/**
 * POR03 step 2: one part.
 *
 * The body is raw bytes rather than multipart, because a resuming client needs
 * to send an exact byte range of a file it already has open, and wrapping that
 * in a form encoding buys nothing. The part number comes from the query string
 * and is what makes the call idempotent — re-sending part 3 replaces part 3.
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ uploadId: string }> },
) {
  try {
    const actor = await requirePortalContact();
    await assertCsrf(request);

    const { uploadId } = await params;
    const partParam = new URL(request.url).searchParams.get("part");
    const partNumber = Number(partParam);

    if (partParam === null || !Number.isInteger(partNumber)) {
      return NextResponse.json(
        { error: "Which part is this?", code: "NO_PART_NUMBER" },
        { status: 400 },
      );
    }

    const body = Buffer.from(await request.arrayBuffer());

    const status = await appendPortalUploadPart({
      uploadId,
      contactId: actor.contactId,
      partNumber,
      body,
    });

    return NextResponse.json(status);
  } catch (e) {
    return errorResponse(e);
  }
}
