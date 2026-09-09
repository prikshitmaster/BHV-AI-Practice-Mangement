import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { assertCsrf } from "@/lib/csrf";
import { requirePortalContact } from "@/lib/portal-session";
import { completePortalUpload } from "@/lib/portal-upload";

export const dynamic = "force-dynamic";

/**
 * POR03 step 3: assemble, verify, file, receipt.
 *
 * Safe to call twice. A client that loses the response and retries gets the
 * ORIGINAL receipt back rather than a second filed version — which is the
 * "without duplicate originals" half of the acceptance evidence, at the one
 * point where a retry would otherwise create one.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ uploadId: string }> },
) {
  try {
    const actor = await requirePortalContact();
    await assertCsrf(request);

    const { uploadId } = await params;

    const receipt = await completePortalUpload({
      uploadId,
      contactId: actor.contactId,
    });

    return NextResponse.json(receipt);
  } catch (e) {
    return errorResponse(e);
  }
}
