/**
 * SEC03 — application hardening headers (PRD §35).
 *
 * These run on every response. They are defence in depth, not a substitute
 * for the server-side authorisation in practice-scope.ts and permissions.ts:
 * "A lock icon or 'AES' label in the interface is not acceptance evidence."
 *
 * Renamed from middleware.ts to proxy.ts (Next.js 16 file convention).
 *
 * T15 added the API01 correlation ID here for the same reason the CSRF pair is
 * issued here: it has to hold for EVERY response, including routes nobody
 * remembered to wrap. The ID is forwarded to the route as a request header, so
 * a wrapped handler adopts this one instead of minting a second ID for the
 * same request.
 */

import { NextResponse, type NextRequest } from "next/server";
// csrf-shared, not csrf: importing csrf.ts here would pull in node:crypto and
// next/headers, and a bad import in proxy fails every route, not one.
import { CSRF_COOKIE, CSRF_RAW_COOKIE } from "@/lib/csrf-shared";

const isProduction = process.env.NODE_ENV === "production";

const CORRELATION_HEADER = "x-correlation-id";

/**
 * API01: an inbound ID is honoured so a caller can tie a chain of requests
 * together, but only if it is short and boring — the value lands in log lines
 * and error bodies, so it is untrusted input like any other header.
 */
const SAFE_CORRELATION_ID = /^[A-Za-z0-9._:-]{8,64}$/;

/**
 * No 'unsafe-inline' for scripts. Next.js needs a nonce for its inline
 * bootstrap, so one is minted per request and passed through for the app to
 * apply. Styles still allow inline while Tailwind's runtime injection is in
 * use — tightened when the styling pipeline is finalised in T16.
 */
function contentSecurityPolicy(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'${isProduction ? "" : " 'unsafe-eval'"}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    // The app talks only to its own origin; document storage is proxied
    // server-side so MinIO is never a browser-reachable origin.
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

/**
 * Web Crypto, not node:crypto. Proxy may run on a runtime without Node's
 * built-ins, and importing node:crypto here takes the WHOLE app down with a
 * 500 on every route — the shell included — rather than failing only the
 * feature that needed it.
 */
async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");

  const suppliedCorrelationId = request.headers.get(CORRELATION_HEADER)?.trim();
  const correlationId =
    suppliedCorrelationId && SAFE_CORRELATION_ID.test(suppliedCorrelationId)
      ? suppliedCorrelationId
      : crypto.randomUUID();

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set(CORRELATION_HEADER, correlationId);

  const response = NextResponse.next({ request: { headers: requestHeaders } });

  // API01: on the response too, so a caller can quote it back on any endpoint.
  response.headers.set(CORRELATION_HEADER, correlationId);

  response.headers.set("Content-Security-Policy", contentSecurityPolicy(nonce));
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  );
  response.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  response.headers.set("Cross-Origin-Resource-Policy", "same-origin");
  response.headers.set("X-Permitted-Cross-Domain-Policies", "none");

  // SEC02: only meaningful over HTTPS, and dangerous to set while a
  // deployment is still being reached over plain HTTP on a LAN.
  if (isProduction) {
    response.headers.set(
      "Strict-Transport-Security",
      "max-age=63072000; includeSubDomains; preload",
    );
  }

  // Don't advertise the stack.
  response.headers.delete("X-Powered-By");

  /**
   * SEC03: mint the double-submit CSRF pair if this browser has none.
   *
   * T06 built assertCsrf but nothing ever issued the token, because there was
   * no UI to issue it to. The result was that every mutating route was
   * unreachable from a browser — the guard was not weak, it was total. This is
   * the issuing half.
   *
   * The pair: `bhv_csrf` holds the HASH and is httpOnly, so script cannot read
   * it; `bhv_csrf_token` holds the raw token and is deliberately readable, so
   * the app's own script can echo it in a header. An attacker on another
   * origin can read neither, which is what makes the double submit mean
   * something — the security rests on the same-origin policy, not on the raw
   * token being secret from the page that must send it.
   */
  if (!request.cookies.get(CSRF_COOKIE)) {
    const token = randomToken();
    const hash = await sha256Hex(token);

    response.cookies.set(CSRF_COOKIE, hash, {
      httpOnly: true,
      secure: isProduction,
      sameSite: "lax",
      path: "/",
    });
    response.cookies.set(CSRF_RAW_COOKIE, token, {
      httpOnly: false,
      secure: isProduction,
      sameSite: "lax",
      path: "/",
    });
  }

  return response;
}

export const config = {
  matcher: [
    // Everything except Next's static output, which is served pre-built.
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
