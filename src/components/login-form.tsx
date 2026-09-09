"use client";

/**
 * The real login flow (AUTH01-03, PRD §10), against src/lib/auth.ts — not the
 * dev header bypass. Three steps, matching login()'s own state machine:
 *
 *   1. email + password            -> POST /api/auth/login
 *   2a. MFA code (already enrolled) -> POST /api/auth/mfa/verify
 *   2b. first-time MFA enrolment    -> POST /api/auth/mfa/enrol/begin, then
 *                                       POST /api/auth/mfa/enrol/confirm
 *
 * `challenge` is the proof step 1 succeeded (src/lib/login-challenge.ts). It
 * lives in component state only, never a cookie — a page reload restarts at
 * step 1, which is the right failure mode for a 5-minute-lived proof.
 */

import { useEffect, useState } from "react";

type Step =
  | { name: "credentials" }
  | { name: "mfa"; challenge: string }
  | { name: "enrol-loading"; challenge: string }
  | { name: "enrol"; challenge: string; enrolmentId: string; secret: string; otpauthUri: string }
  | { name: "enrol-done"; recoveryCodes: string[] };

async function postJson(url: string, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error ?? `Request failed (${res.status})`);
  }
  return data;
}

export function LoginForm() {
  const [step, setStep] = useState<Step>({ name: "credentials" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submitCredentials(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const data = await postJson("/api/auth/login", { email, password });
      if (data.status === "MFA_REQUIRED") {
        setStep({ name: "mfa", challenge: data.challenge });
      } else {
        setStep({ name: "enrol-loading", challenge: data.challenge });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign in failed.");
    } finally {
      setPending(false);
    }
  }

  async function submitMfaCode(e: React.FormEvent) {
    if (step.name !== "mfa") return;
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      await postJson("/api/auth/mfa/verify", { challenge: step.challenge, code });
      // Full navigation so the server re-reads the new session cookie.
      window.location.assign("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : "That code was not accepted.");
      setPending(false);
    }
  }

  // Enrolment begins automatically — there is nothing for the user to decide
  // at this point, only a secret to show them.
  useEffect(() => {
    if (step.name !== "enrol-loading") return;
    let cancelled = false;
    (async () => {
      try {
        const data = await postJson("/api/auth/mfa/enrol/begin", { challenge: step.challenge });
        if (!cancelled) {
          setStep({
            name: "enrol",
            challenge: step.challenge,
            enrolmentId: data.enrolmentId,
            secret: data.secret,
            otpauthUri: data.otpauthUri,
          });
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Could not start MFA enrolment.");
          setStep({ name: "credentials" });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step.name]);

  async function submitEnrolCode(e: React.FormEvent) {
    if (step.name !== "enrol") return;
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const data = await postJson("/api/auth/mfa/enrol/confirm", {
        challenge: step.challenge,
        enrolmentId: step.enrolmentId,
        code,
      });
      setStep({ name: "enrol-done", recoveryCodes: data.recoveryCodes });
    } catch (e) {
      setError(e instanceof Error ? e.message : "That code was not accepted.");
      setPending(false);
    }
  }

  if (step.name === "credentials") {
    return (
      <form onSubmit={submitCredentials} noValidate>
        <div className="field">
          <label className="field-label" htmlFor="login-email">
            Email
          </label>
          <input
            id="login-email"
            className="field-input"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={error ? "true" : undefined}
            aria-describedby={error ? "login-error" : undefined}
          />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="login-password">
            Password
          </label>
          <input
            id="login-password"
            className="field-input"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={error ? "true" : undefined}
            aria-describedby={error ? "login-error" : undefined}
          />
        </div>
        {error ? (
          <p id="login-error" className="field-error" role="alert">
            {error}
          </p>
        ) : null}
        <button type="submit" className="btn btn--primary" disabled={pending}>
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>
    );
  }

  if (step.name === "enrol-loading") {
    return <p role="status">Setting up multi-factor authentication…</p>;
  }

  if (step.name === "mfa") {
    return (
      <form onSubmit={submitMfaCode} noValidate>
        <p className="field-hint">
          Enter the 6-digit code from your authenticator app.
        </p>
        <div className="field">
          <label className="field-label" htmlFor="mfa-code">
            Authentication code
          </label>
          <input
            id="mfa-code"
            className="field-input"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="one-time-code"
            maxLength={6}
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
            aria-invalid={error ? "true" : undefined}
            aria-describedby={error ? "mfa-error" : undefined}
          />
        </div>
        {error ? (
          <p id="mfa-error" className="field-error" role="alert">
            {error}
          </p>
        ) : null}
        <button type="submit" className="btn btn--primary" disabled={pending}>
          {pending ? "Verifying…" : "Verify"}
        </button>
      </form>
    );
  }

  if (step.name === "enrol") {
    return (
      <form onSubmit={submitEnrolCode} noValidate>
        <p className="field-hint">
          This account has no authenticator set up yet. Add this key to an authenticator app
          (Google Authenticator, Authy, 1Password, …) using &ldquo;Enter setup key manually&rdquo;,
          then enter the 6-digit code it shows.
        </p>
        <div className="field">
          <span className="field-label">Setup key</span>
          <code style={{ display: "block", wordBreak: "break-all", padding: 8 }}>
            {step.secret}
          </code>
        </div>
        <div className="field">
          <label className="field-label" htmlFor="enrol-code">
            Authentication code
          </label>
          <input
            id="enrol-code"
            className="field-input"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="one-time-code"
            maxLength={6}
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
            aria-invalid={error ? "true" : undefined}
            aria-describedby={error ? "enrol-error" : undefined}
          />
        </div>
        {error ? (
          <p id="enrol-error" className="field-error" role="alert">
            {error}
          </p>
        ) : null}
        <button type="submit" className="btn btn--primary" disabled={pending}>
          {pending ? "Confirming…" : "Confirm and sign in"}
        </button>
      </form>
    );
  }

  // enrol-done
  return (
    <div>
      <p className="field-hint">
        Save these recovery codes now — each works once, and this is the only time they are shown.
      </p>
      <ul>
        {step.recoveryCodes.map((c) => (
          <li key={c}>
            <code>{c}</code>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="btn btn--primary"
        onClick={() => window.location.assign("/")}
      >
        Continue
      </button>
    </div>
  );
}
