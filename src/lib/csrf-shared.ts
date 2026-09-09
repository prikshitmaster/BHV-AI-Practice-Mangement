/**
 * CSRF constants safe to import from CLIENT components (SEC03, PRD §35).
 *
 * Split out of csrf.ts because that file imports `next/headers` and
 * `node:crypto`, neither of which is legal in a client bundle — pulling it in
 * via client-fetch.ts breaks every page with a build error, and pulling it into
 * middleware.ts takes the whole app to a 500. Nothing here touches request
 * state or Node built-ins, so it is importable from anywhere: server
 * components, route handlers, middleware and the browser.
 *
 * This file is the SINGLE source of these names. csrf.ts re-exports them so
 * server code can keep importing from one place; do not redeclare them.
 */

/** Holds the token's HASH, httpOnly — never read by client script. */
export const CSRF_COOKIE = "bhv_csrf";
/** Holds the RAW token, non-httpOnly — this is what client script echoes back. */
export const CSRF_RAW_COOKIE = "bhv_csrf_token";
export const CSRF_HEADER = "x-bhv-csrf";

export class CsrfError extends Error {
  readonly code = "CSRF_FAILED";
  readonly status = 403;
  constructor(reason: string) {
    super(reason);
    this.name = "CsrfError";
  }
}
