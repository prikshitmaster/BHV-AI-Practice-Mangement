/**
 * Shared API-route plumbing.
 *
 * Turns scope/auth failures into responses that leak nothing: a practice the
 * caller may not see returns 404, never 403, so the response cannot be used to
 * prove that a Company record exists.
 */

import { NextResponse } from "next/server";
import { PracticeAccessError } from "@/lib/practice-scope";
import { PermissionDeniedError } from "@/lib/permissions";
import { DocumentError } from "@/lib/documents";
import { IntakeError } from "@/lib/document-intake";
import { CommunicationError } from "@/lib/communication";
import { CsrfError } from "@/lib/csrf-shared";
import { UnauthenticatedError } from "@/lib/session";
import { AuthError, RateLimitError } from "@/lib/auth";
import { LoginChallengeError } from "@/lib/login-challenge";
import { PortalAuthError } from "@/lib/portal-auth";
import { FeeError } from "@/lib/fees";
import { InvoiceError } from "@/lib/invoicing";
import { ReceiptError } from "@/lib/receipts";
import { SeparationOfDutiesError } from "@/lib/separation-of-duties";

export function errorResponse(e: unknown): NextResponse {
  if (e instanceof UnauthenticatedError) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  // AUTH01-03 login/MFA refusals: the code lets the login form show a
  // specific message (rate limited, locked, wrong code) without ever
  // distinguishing "unknown email" from "wrong password".
  if (e instanceof AuthError || e instanceof RateLimitError || e instanceof LoginChallengeError) {
    return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
  }
  // POR02: the portal's refusals are already written to be safe for an
  // unauthenticated reader — one message for every dead invitation, and 404
  // (never 403) for an entity the contact may not reach. So the message is
  // passed through as-is rather than being flattened here, which would lose
  // the renewal instruction POR05 requires.
  if (e instanceof PortalAuthError) {
    return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
  }
  if (e instanceof PracticeAccessError) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (e instanceof CsrfError) {
    return NextResponse.json({ error: "Request refused", code: e.code }, { status: 403 });
  }
  if (e instanceof PermissionDeniedError) {
    // Membership is already established here, so naming the action is safe —
    // it tells a legitimate member what they lack, not an outsider what exists.
    return NextResponse.json(
      { error: "Permission denied", action: e.action },
      { status: 403 },
    );
  }
  // DOC01/DOC02 refusals are the user-facing half of the intake contract: the
  // uploader must be told what to do about it, so the code and detail are
  // deliberately returned. Neither carries record content.
  // COM01-04 refusals are the same shape and for the same reason: a sender who
  // is stopped must be told which safeguard stopped them, or they will work
  // around it. None of these messages carries record content.
  if (e instanceof DocumentError || e instanceof IntakeError || e instanceof CommunicationError) {
    return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
  }

  // FIN01/FIN02/FIN04 refusals, same shape and same reasoning: a biller who is
  // stopped must be told WHICH rule stopped them — "over allocated", "issued
  // particulars are locked", "no agreed rate" — or they will work around it.
  // None of these messages carries record content.
  if (e instanceof FeeError || e instanceof InvoiceError || e instanceof ReceiptError) {
    return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
  }

  // IAM04. 409 rather than 403: the caller has the permission, but not on
  // THIS record, because they authored it.
  if (e instanceof SeparationOfDutiesError) {
    return NextResponse.json(
      { error: e.message, code: "SEPARATION_OF_DUTIES" },
      { status: 409 },
    );
  }

  console.error("Unhandled API error:", e);

  // Detail is returned only outside production. SEC03: a production error must
  // not disclose internals, but a developer needs more than "500".
  if (process.env.NODE_ENV !== "production") {
    return NextResponse.json(
      {
        error: "Internal server error",
        devMessage: e instanceof Error ? e.message : String(e),
        devStack: e instanceof Error ? e.stack?.split("\n").slice(0, 5) : undefined,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

/** Wraps a route handler so every scope/auth failure is handled identically. */
export function route<T>(handler: () => Promise<T>) {
  return async (): Promise<NextResponse> => {
    try {
      return NextResponse.json(await handler());
    } catch (e) {
      return errorResponse(e);
    }
  };
}
