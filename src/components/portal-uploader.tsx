"use client";

import { useCallback, useRef, useState } from "react";
import { mutate } from "@/lib/client-fetch";

/**
 * POR03 guided upload — the client half.
 *
 * The resume story is not a retry loop bolted on afterwards; it is the shape of
 * the whole component:
 *
 *   1. hash the file, so the server can recognise it later however the
 *      connection died;
 *   2. declare it and receive the list of parts the server ALREADY holds;
 *   3. send only the missing parts, marking each one done as it lands;
 *   4. complete.
 *
 * Step 2 is what makes an interrupted upload resumable from a fresh page load
 * with no client-side state at all — the user picks the same file again and the
 * transfer carries on from where it stopped.
 *
 * NAV03's five states are all here: idle/normal, in-progress (loading), the
 * receipt, an error that PRESERVES the selected file so retrying costs nothing,
 * and the conflict wording when staff moved the item mid-upload.
 */

type Phase = "IDLE" | "HASHING" | "UPLOADING" | "COMPLETING" | "DONE" | "ERROR";

type Receipt = {
  receiptMessage: string;
  versionNo: number;
  duplicateOfExisting: boolean;
};

export function PortalUploader({
  clientRelationshipId,
  itemId,
  documentType,
}: {
  clientRelationshipId: string;
  itemId: string;
  documentType: string;
}) {
  const [phase, setPhase] = useState<Phase>("IDLE");
  const [file, setFile] = useState<File | null>(null);
  const [sentBytes, setSentBytes] = useState(0);
  const [resumed, setResumed] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState<{ message: string; conflict: boolean } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const upload = useCallback(
    async (chosen: File) => {
      setError(null);
      setReceipt(null);
      setSentBytes(0);
      setResumed(false);

      try {
        setPhase("HASHING");
        const digest = await sha256Hex(chosen);

        setPhase("UPLOADING");
        const beginRes = await mutate("/api/portal/uploads", {
          method: "POST",
          body: JSON.stringify({
            clientRelationshipId,
            itemId,
            filename: chosen.name,
            declaredMimeType: chosen.type || "application/octet-stream",
            expectedBytes: chosen.size,
            expectedSha256: digest,
          }),
        });
        const begin = await beginRes.json();
        if (!beginRes.ok) throw new UploadFailure(begin.error, beginRes.status);

        setResumed(Boolean(begin.resumed));
        const partSize: number = begin.maxPartBytes;
        const held = new Set<number>(begin.receivedParts ?? []);
        const totalParts = Math.ceil(chosen.size / partSize);

        // Only what is missing. A resumed upload with every part already held
        // sends nothing at all and goes straight to completion.
        let sent = held.size * partSize;
        setSentBytes(Math.min(sent, chosen.size));

        for (let part = 0; part < totalParts; part++) {
          if (held.has(part)) continue;

          const slice = chosen.slice(part * partSize, Math.min((part + 1) * partSize, chosen.size));
          const res = await mutate(
            `/api/portal/uploads/${encodeURIComponent(begin.uploadId)}/parts?part=${part}`,
            {
              method: "PUT",
              body: slice,
              headers: { "content-type": "application/octet-stream" },
            },
          );
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new UploadFailure(body.error, res.status);
          }
          sent += slice.size;
          setSentBytes(Math.min(sent, chosen.size));
        }

        setPhase("COMPLETING");
        const completeRes = await mutate(
          `/api/portal/uploads/${encodeURIComponent(begin.uploadId)}/complete`,
          { method: "POST" },
        );
        const completed = await completeRes.json();
        if (!completeRes.ok) throw new UploadFailure(completed.error, completeRes.status, completed.code);

        setReceipt({
          receiptMessage: completed.receiptMessage,
          versionNo: completed.versionNo,
          duplicateOfExisting: completed.duplicateOfExisting,
        });
        setPhase("DONE");
      } catch (e) {
        const failure = e instanceof UploadFailure ? e : null;
        setError({
          message:
            failure?.message ??
            "The upload stopped before it finished. Your file is still selected — try again and " +
              "it will carry on from where it stopped.",
          conflict: failure?.code === "ITEM_VERSION_CONFLICT",
        });
        setPhase("ERROR");
      }
    },
    [clientRelationshipId, itemId],
  );

  const busy = phase === "HASHING" || phase === "UPLOADING" || phase === "COMPLETING";
  const percent = file && file.size > 0 ? Math.round((sentBytes / file.size) * 100) : 0;

  if (phase === "DONE" && receipt) {
    return (
      <div className="state" role="status">
        <p className="state-title">Received</p>
        {/* POR03: "The receipt confirms intake only, not correctness or
            completion of the audit." The server owns that wording. */}
        <p className="state-body">{receipt.receiptMessage}</p>
        {receipt.duplicateOfExisting ? (
          <p className="state-body muted">
            We already had this exact file, so we&rsquo;ve kept the copy you sent before rather than
            filing a second one.
          </p>
        ) : null}
        <a className="btn" href="/portal">
          Back to your documents
        </a>
      </div>
    );
  }

  return (
    <div className="portal-uploader">
      {/* NAV03 error: rendered ABOVE the control, which stays mounted with the
          file still selected, so a retry costs the user nothing. */}
      {error ? (
        <div className={`state ${error.conflict ? "state--conflict" : "state--error"}`} role="alert">
          <p className="state-title">
            {error.conflict ? "This record changed. Review the latest version." : "Upload stopped"}
          </p>
          <p className="state-body">{error.message}</p>
          {file && !error.conflict ? (
            <button className="btn" type="button" onClick={() => upload(file)}>
              Try again
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="field">
        <label className="field-label" htmlFor="portal-file">
          {documentType}
        </label>
        <input
          ref={inputRef}
          id="portal-file"
          className="field-input"
          type="file"
          disabled={busy}
          onChange={(e) => {
            const chosen = e.target.files?.[0] ?? null;
            setFile(chosen);
            if (chosen) void upload(chosen);
          }}
        />
        <p className="field-hint">
          PDF, images, Word, Excel, CSV or text, up to 100 MB. If the upload is interrupted, choose
          the same file again and it will carry on from where it stopped.
        </p>
      </div>

      {busy ? (
        <div aria-live="polite" className="portal-progress">
          <p>
            {phase === "HASHING"
              ? "Checking the file…"
              : phase === "COMPLETING"
                ? "Finishing…"
                : resumed
                  ? `Resuming — ${percent}% sent`
                  : `Uploading — ${percent}% sent`}
          </p>
          <progress max={100} value={phase === "UPLOADING" ? percent : undefined} />
        </div>
      ) : null}
    </div>
  );
}

class UploadFailure extends Error {
  constructor(
    message: string | undefined,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message ?? "That didn't work.");
  }
}

/**
 * Hashed in the browser so the digest is the client's own claim about the file,
 * checked against the assembled bytes server-side. It is also what lets the
 * server recognise a re-sent file as the same one.
 */
async function sha256Hex(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
