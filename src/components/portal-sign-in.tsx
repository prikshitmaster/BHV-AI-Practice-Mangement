"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { mutate } from "@/lib/client-fetch";

/**
 * POR02 redemption + POR05 recovery, as one screen.
 *
 * Whatever went wrong with the link, the visitor sees the same sentence and the
 * same next step. This component never branches on the reason, because it is
 * never told the reason — the server sends one message for all four failure
 * cases, and the renewal request is the recovery route the acceptance evidence
 * asks for: safe, and it identifies nobody.
 */
export function PortalSignIn({ token }: { token: string }) {
  const router = useRouter();
  const [state, setState] = useState<"WORKING" | "FAILED" | "RENEWED">("WORKING");
  const [message, setMessage] = useState<string>("");
  const [renewing, setRenewing] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await mutate("/api/portal/invitations/accept", {
          method: "POST",
          body: JSON.stringify({ token }),
        });
        const body = await res.json();
        if (cancelled) return;

        if (res.ok) {
          const target = body.activeEntityId
            ? `/portal?entity=${encodeURIComponent(body.activeEntityId)}`
            : "/portal";
          router.replace(target);
          return;
        }

        setMessage(body.error ?? "This link cannot be used.");
        setState("FAILED");
      } catch {
        if (cancelled) return;
        setMessage("We couldn't reach the server. Check your connection and try the link again.");
        setState("FAILED");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token, router]);

  if (state === "WORKING") {
    return (
      <div className="state" aria-busy="true" aria-live="polite">
        <p className="state-title">Signing you in…</p>
      </div>
    );
  }

  if (state === "RENEWED") {
    return (
      <div className="state" role="status">
        <p className="state-title">Request sent</p>
        <p className="state-body">{message}</p>
      </div>
    );
  }

  return (
    <div className="state state--error" role="alert">
      <p className="state-title">This link can&rsquo;t be used</p>
      <p className="state-body">{message}</p>
      <button
        className="btn btn--primary"
        type="button"
        disabled={renewing}
        onClick={async () => {
          setRenewing(true);
          try {
            const res = await mutate("/api/portal/invitations/renew", {
              method: "POST",
              body: JSON.stringify({ token }),
            });
            const body = await res.json();
            setMessage(body.message ?? "Thanks — we've passed this to the team.");
            setState("RENEWED");
          } catch {
            setMessage("We couldn't reach the server. Please try again in a moment.");
          } finally {
            setRenewing(false);
          }
        }}
      >
        {renewing ? "Sending…" : "Request a new link"}
      </button>
    </div>
  );
}
