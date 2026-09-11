/**
 * Shared API-route plumbing.
 *
 * Turns scope/auth failures into responses that leak nothing: a practice the
 * caller may not see returns 404, never 403, so the response cannot be used to
 * prove that a Company record exists.
 *
 * T15/API01 added the other half of that contract: EVERY response, success or
 * failure, carries a machine-readable `code` and the request's correlation ID,
 * in the body and in the `x-correlation-id` header. A support question then
 * has an answer that does not require the error text to describe the record.
 */

import { NextResponse } from "next/server";
import {
  CORRELATION_HEADER,
  correlationIdFrom,
  currentCorrelationId,
  newCorrelationId,
  withCorrelationId,
} from "@/lib/correlation";
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
import { VersionConflictError, SubjectNotFoundError } from "@/lib/concurrency";
import { ApprovalError } from "@/lib/approvals";
import { ContinuityError } from "@/lib/continuity";
import { PrivacyError } from "@/lib/privacy-register";

export type ApiErrorBody = {
  error: string;
  code: string;
  correlationId: string;
  /** Present only for 409 version conflicts — see `VersionConflictError`. */
  conflict?: unknown;
  action?: string;
  devMessage?: string;
  devStack?: string[];
};

/**
 * The single exit for a refusal. Every branch below goes through here, so no
 * route can invent an error shape that omits the code or the correlation ID.
 */
function fail(
  status: number,
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
): NextResponse {
  const correlationId = currentCorrelationId() ?? newCorrelationId();
  const response = NextResponse.json(
    { error: message, code, correlationId, ...extra },
    { status },
  );
  response.headers.set(CORRELATION_HEADER, correlationId);
  return response;
}

export function errorResponse(e: unknown): NextResponse {
  if (e instanceof UnauthenticatedError) {
    return fail(401, "UNAUTHENTICATED", "Authentication required");
  }
  // AUTH01-03 login/MFA refusals: the code lets the login form show a
  // specific message (rate limited, locked, wrong code) without ever
  // distinguishing "unknown email" from "wrong password".
  if (e instanceof AuthError || e instanceof RateLimitError || e instanceof LoginChallengeError) {
    return fail(e.status, e.code, e.message);
  }
  // POR02: the portal's refusals are already written to be safe for an
  // unauthenticated reader — one message for every dead invitation, and 404
  // (never 403) for an entity the contact may not reach. So the message is
  // passed through as-is rather than being flattened here, which would lose
  // the renewal instruction POR05 requires.
  if (e instanceof PortalAuthError) {
    return fail(e.status, e.code, e.message);
  }
  if (e instanceof PracticeAccessError || e instanceof SubjectNotFoundError) {
    return fail(404, "NOT_FOUND", "Not found");
  }
  // API02: the losing writer gets the comparison, not just a refusal. Without
  // it the only thing a screen can do is discard the user's work silently or
  // let them re-apply it over the winner — last-write-wins with extra steps.
  if (e instanceof VersionConflictError) {
    return fail(409, "VERSION_CONFLICT", e.message, { conflict: e.comparison });
  }
  if (e instanceof CsrfError) {
    return fail(403, e.code, "Request refused");
  }
  if (e instanceof PermissionDeniedError) {
    // Membership is already established here, so naming the action is safe —
    // it tells a legitimate member what they lack, not an outsider what exists.
    return fail(403, "PERMISSION_DENIED", "Permission denied", { action: e.action });
  }
  // DOC01/DOC02 refusals are the user-facing half of the intake contract: the
  // uploader must be told what to do about it, so the code and detail are
  // deliberately returned. Neither carries record content.
  // COM01-04 refusals are the same shape and for the same reason: a sender who
  // is stopped must be told which safeguard stopped them, or they will work
  // around it. None of these messages carries record content.
  if (e instanceof DocumentError || e instanceof IntakeError || e instanceof CommunicationError) {
    return fail(e.status, e.code, e.message);
  }

  // FIN01/FIN02/FIN04 refusals, same shape and same reasoning: a biller who is
  // stopped must be told WHICH rule stopped them — "over allocated", "issued
  // particulars are locked", "no agreed rate" — or they will work around it.
  // None of these messages carries record content.
  if (e instanceof FeeError || e instanceof InvoiceError || e instanceof ReceiptError) {
    return fail(e.status, e.code, e.message);
  }

  // API02: an approval refused for its own reasons (no version stated, an
  // unapprovable subject) — same envelope, its own code.
  if (e instanceof ApprovalError) {
    return fail(e.status, e.code, e.message);
  }

  // BCP04/BCP06 refusals (step-up required, probed service, downtime line N
  // not found, remediation owner missing). Written for the person who has to
  // act on them; a not-found keeps the 404 shape and names no record.
  if (e instanceof ContinuityError) {
    return fail(e.status, e.code, e.message);
  }

  // PRV01/02/04/06 refusals (consent needs a notice, Operational needs a date,
  // an item must be retained, awareness only moves earlier). Each names the
  // rule so the person can act on it; a not-found keeps the 404 shape.
  if (e instanceof PrivacyError) {
    return fail(e.status, e.code, e.message);
  }

  // IAM04. 409 rather than 403: the caller has the permission, but not on
  // THIS record, because they authored it.
  if (e instanceof SeparationOfDutiesError) {
    return fail(409, "SEPARATION_OF_DUTIES", e.message);
  }

  const correlationId = currentCorrelationId() ?? newCorrelationId();
  // The correlation ID is logged with the stack so the server-side detail can
  // be found from the ID the caller was given, without the caller being told
  // anything about it.
  console.error(`Unhandled API error [${correlationId}]:`, e);

  // Detail is returned only outside production. SEC03: a production error must
  // not disclose internals, but a developer needs more than "500".
  if (process.env.NODE_ENV !== "production") {
    return fail(500, "INTERNAL_ERROR", "Internal server error", {
      devMessage: e instanceof Error ? e.message : String(e),
      devStack: e instanceof Error ? e.stack?.split("\n").slice(0, 5) : undefined,
    });
  }

  return fail(500, "INTERNAL_ERROR", "Internal server error");
}

/**
 * API01: the one way a route may build a refusal of its own. Everything a
 * route used to hand-roll as `NextResponse.json({ error: … })` goes through
 * here, so no endpoint can answer with a body that omits the code or the
 * correlation ID.
 */
export function apiError(
  status: number,
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
): NextResponse {
  return fail(status, code, message, extra);
}

/**
 * API01: a 400 that looks like every other refusal. Input validation failures
 * were previously hand-rolled per route, each with its own body shape.
 */
export function badRequest(message: string, code = "BAD_REQUEST"): NextResponse {
  return fail(400, code, message);
}

/** API01: a not-found that never distinguishes "absent" from "not yours". */
export function notFound(): NextResponse {
  return fail(404, "NOT_FOUND", "Not found");
}

/**
 * Establishes the correlation context for one request and tags the response.
 *
 * Wrap a route handler in this and everything it calls — audit writes, outbox
 * emissions, error responses — shares one ID without being passed one.
 */
export function withApiContext(
  request: Request,
  handler: () => Promise<Response>,
): Promise<Response> {
  const correlationId = correlationIdFrom(request);
  return withCorrelationId(correlationId, async () => {
    try {
      const response = await handler();
      response.headers.set(CORRELATION_HEADER, correlationId);
      return response;
    } catch (e) {
      return errorResponse(e);
    }
  });
}

/** Wraps a route handler so every scope/auth failure is handled identically. */
export function route<T>(handler: () => Promise<T>) {
  return async (request?: Request): Promise<Response> => {
    const correlationId = request ? correlationIdFrom(request) : newCorrelationId();
    return withCorrelationId(correlationId, async () => {
      try {
        const response = NextResponse.json(await handler());
        response.headers.set(CORRELATION_HEADER, correlationId);
        return response;
      } catch (e) {
        return errorResponse(e);
      }
    });
  };
}
