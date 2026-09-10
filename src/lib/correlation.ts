/**
 * Correlation IDs — API01 (PRD §34).
 *
 * "Use consistent error codes with safe human messages and a correlation ID."
 *
 * One ID is minted per request, returned on every response (success and
 * failure), carried into the audit trail and stamped onto any outbox event the
 * request commits. That is what makes a support call answerable: the client
 * quotes the ID from the error banner, and the same ID appears on the Event
 * row and on the side effects that followed — without the error message itself
 * having to say anything about the record.
 *
 * The ID travels through `AsyncLocalStorage` rather than being threaded
 * through every function signature, because the alternative is an optional
 * parameter on forty-odd library calls that anyone can forget.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

export const CORRELATION_HEADER = "x-correlation-id";

type CorrelationContext = { correlationId: string };

const storage = new AsyncLocalStorage<CorrelationContext>();

/**
 * An inbound ID is honoured so a browser or a job runner can tie a chain of
 * calls together — but only if it is short and boring. An unvalidated header
 * lands in log lines and error bodies, so it is treated as untrusted input.
 */
const SAFE_ID = /^[A-Za-z0-9._:-]{8,64}$/;

export function newCorrelationId(): string {
  return randomUUID();
}

export function correlationIdFrom(request: { headers: Headers }): string {
  const supplied = request.headers.get(CORRELATION_HEADER)?.trim();
  return supplied && SAFE_ID.test(supplied) ? supplied : newCorrelationId();
}

/** The current request's ID, or null outside a request (a worker, a script). */
export function currentCorrelationId(): string | null {
  return storage.getStore()?.correlationId ?? null;
}

/** Runs `fn` with `correlationId` visible to everything it calls. */
export function withCorrelationId<T>(correlationId: string, fn: () => T): T {
  return storage.run({ correlationId }, fn);
}

/** Stamps the ID onto a response so the caller can quote it back. */
export function tagResponse<T extends { headers: Headers }>(
  response: T,
  correlationId: string,
): T {
  response.headers.set(CORRELATION_HEADER, correlationId);
  return response;
}
