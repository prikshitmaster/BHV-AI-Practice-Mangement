"use client";

import { useState } from "react";
import { mutate } from "@/lib/client-fetch";

/**
 * POR05 / §17 acceptance evidence: "an expired invitation gives a safe renewal
 * request without identifying the client to an unauthenticated visitor."
 *
 * The field asks for the dead LINK, not an email address. That is the whole
 * design: a link is enough for staff to find the right contact, and it requires
 * the visitor to name nobody — whereas an email box on a public page is an
 * account-discovery oracle waiting to be probed, which POR02 forbids outright.
 *
 * The response is the same acknowledgement whether or not the link matched.
 */
export function PortalRenewalForm() {
  const [value, setValue] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  if (result?.ok) {
    return (
      <div className="state" role="status">
        <p className="state-title">Request sent</p>
        <p className="state-body">{result.message}</p>
      </div>
    );
  }

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setSending(true);
        setResult(null);
        try {
          const res = await mutate("/api/portal/invitations/renew", {
            method: "POST",
            // A pasted full URL is the common case, so the token is taken from
            // the last path segment rather than asking the user to extract it.
            body: JSON.stringify({ token: extractToken(value) }),
          });
          const body = await res.json();
          setResult({
            ok: res.ok,
            message:
              body.message ??
              body.error ??
              "We couldn't send that just now. Please try again in a moment.",
          });
        } catch {
          setResult({
            ok: false,
            message: "We couldn't reach the server. Please try again in a moment.",
          });
        } finally {
          setSending(false);
        }
      }}
    >
      <div className="field">
        <label className="field-label" htmlFor="portal-renewal-token">
          The link you were sent
        </label>
        <input
          id="portal-renewal-token"
          className="field-input"
          type="text"
          inputMode="url"
          autoComplete="off"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Paste the whole link here"
        />
        <p className="field-hint">
          We only use this to find the right person to contact. Nothing about your account is shown
          on this page.
        </p>
      </div>

      {result && !result.ok ? (
        <div className="state state--error" role="alert">
          <p className="state-body">{result.message}</p>
        </div>
      ) : null}

      <button className="btn btn--primary" type="submit" disabled={sending || value.trim() === ""}>
        {sending ? "Sending…" : "Request a new link"}
      </button>
    </form>
  );
}

function extractToken(input: string): string {
  const trimmed = input.trim();
  const withoutQuery = trimmed.split("?")[0].replace(/\/+$/, "");
  const segments = withoutQuery.split("/");
  return segments[segments.length - 1] ?? trimmed;
}
