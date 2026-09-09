import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { requirePortalContact } from "@/lib/portal-session";
import { getPortalUploadStatus } from "@/lib/portal-upload";

export const dynamic = "force-dynamic";

/**
 * What a resuming client asks before sending anything: which parts do you
 * already have? Answering this accurately is what stops a resumed transfer
 * re-sending — and re-filing — bytes we already hold.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ uploadId: string }> },
) {
  try {
    const actor = await requirePortalContact();
    const { uploadId } = await params;

    const status = await getPortalUploadStatus({
      uploadId,
      contactId: actor.contactId,
    });

    return NextResponse.json(status);
  } catch (e) {
    return errorResponse(e);
  }
}
