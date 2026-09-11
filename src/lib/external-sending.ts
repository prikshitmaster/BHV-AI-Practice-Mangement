/**
 * The one switch that stops a restored environment talking to the outside
 * world — BCP03 (PRD §37).
 *
 * "Pause outbound messages and filings until queued actions are reconciled so
 *  restoration cannot resend historical communications or duplicate financial
 *  actions."
 *
 * It lives in a module of its own, with no imports, so that every outbound
 * path can check it without dragging in the restore machinery — and so that
 * the check is impossible to forget for being inconvenient to reach.
 *
 * It is deliberately a FAIL-CLOSED environment variable rather than a database
 * row: a restored copy carries the database with it, so a flag stored in the
 * database would arrive already set to whatever production had. The isolation
 * belongs to the environment, not to the data.
 */

export class ExternalSendingDisabledError extends Error {
  constructor(what: string) {
    super(
      `${what} was refused: EXTERNAL_SENDING_DISABLED is set. This environment is a ` +
        `restored or isolated copy, and sending from it would resend history.`,
    );
    this.name = "ExternalSendingDisabledError";
  }
}

export function externalSendingDisabled(): boolean {
  const v = process.env.EXTERNAL_SENDING_DISABLED?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/** Call at the top of anything that would reach a client, a portal or a filing. */
export function assertExternalSendingAllowed(what: string): void {
  if (externalSendingDisabled()) throw new ExternalSendingDisabledError(what);
}
