import { NextResponse } from "next/server";
import { errorResponse, notFound } from "@/lib/api";
import { redeemAccessToken } from "@/lib/documents";
import { getObject } from "@/lib/object-store";

export const dynamic = "force-dynamic";

/**
 * DOC04 link redemption.
 *
 * The bytes are streamed BY THE APPLICATION. The object store is never exposed
 * to the client, not even as a redirect to a presigned URL, because a
 * presigned URL outlives the permission check that produced it — see the note
 * at the top of `object-store.ts`. Going through here means every single read
 * re-authorises against live state.
 */
export async function GET(request: Request) {
  try {
    const token = new URL(request.url).searchParams.get("t");
    if (!token) {
      return notFound();
    }

    const link = await redeemAccessToken({ token });
    const bytes = await getObject(link.storageObjectId);

    if (!bytes) {
      return notFound();
    }

    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "content-type": link.mimeType,
        "content-disposition": `attachment; filename="${link.filename.replace(/"/g, "")}"`,
        // A document link must never be cached by a proxy or a shared browser.
        "cache-control": "no-store, private",
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
