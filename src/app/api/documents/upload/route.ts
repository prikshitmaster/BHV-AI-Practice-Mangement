import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/session";
import { errorResponse } from "@/lib/api";
import { assertCsrf } from "@/lib/csrf";
import { receiveUpload } from "@/lib/document-intake";
import { fileUpload } from "@/lib/documents";

export const dynamic = "force-dynamic";

/**
 * DOC01 staff upload.
 *
 * The order is the point: intake assesses and stores (or quarantines) BEFORE
 * anything is filed, so a rejected or malicious file never becomes a Document.
 * A quarantined upload still returns 200 with its outcome — the uploader needs
 * the actionable reason, and the request itself did not fail.
 */
export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    await assertCsrf(request);

    const form = await request.formData();
    const file = form.get("file");
    const practiceId = String(form.get("practiceId") ?? "");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "A file is required", code: "NO_FILE" },
        { status: 400 },
      );
    }
    if (!practiceId) {
      return NextResponse.json(
        { error: "practiceId is required", code: "NO_PRACTICE" },
        { status: 400 },
      );
    }

    const body = Buffer.from(await file.arrayBuffer());
    const optional = (k: string) => {
      const v = form.get(k);
      return v == null || v === "" ? null : String(v);
    };

    const receipt = await receiveUpload({
      ctx: {
        actorUserId: userId,
        practiceId,
        clientRelationshipId: optional("clientRelationshipId"),
        engagementId: optional("engagementId"),
        obligationId: optional("obligationId"),
        checklistItemId: optional("checklistItemId"),
        clientRequestId: optional("clientRequestId"),
        periodLabel: optional("periodLabel"),
        source: "STAFF_UPLOAD",
      },
      body,
      filename: file.name,
      declaredMimeType: file.type || "application/octet-stream",
    });

    if (receipt.outcome !== "ACCEPTED") {
      return NextResponse.json({
        outcome: receipt.outcome,
        reason: receipt.reason,
        // DOC01 "actionable rejection reasons" — what the uploader should do,
        // not a stack trace and not a bare "invalid file".
        detail: receipt.detail,
        intakeId: receipt.intakeId,
      });
    }

    const { document, version } = await fileUpload({
      actorUserId: userId,
      practiceId,
      receipt,
      filename: file.name,
      title: optional("title") ?? undefined,
      documentId: optional("documentId") ?? undefined,
      clientRelationshipId: optional("clientRelationshipId"),
      engagementId: optional("engagementId"),
      obligationId: optional("obligationId"),
      documentType: optional("documentType"),
      periodLabel: optional("periodLabel"),
      workingPaper: form.get("workingPaper") === "true",
    });

    return NextResponse.json({
      outcome: "ACCEPTED",
      intakeId: receipt.intakeId,
      documentId: document.id,
      versionId: version.id,
      versionNo: version.versionNo,
      sha256: version.sha256,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
