"use client";

/**
 * NAV04 — safe actions.
 *
 * "Show progress and disable duplicate submission while an action is pending.
 *  Provide undo for low impact reversible edits; use explicit confirmation for
 *  issue, release, bulk share and purge. Never use a success toast before the
 *  authoritative transaction commits."
 *
 * The last sentence is the one that matters most and the one most often got
 * wrong. An optimistic toast is a lie the user acts on: they walk away
 * believing an invoice went out. So `onConfirm` must resolve only after the
 * server has committed, and the success message is rendered from ITS result —
 * never from the click.
 *
 * The double-submit guard is local state rather than a disabled attribute
 * alone, because a disabled button still loses a race against a second Enter
 * keypress dispatched before React re-renders. Belt and braces: the guard
 * short-circuits, AND the control is disabled. Note this is the client half —
 * the authoritative protection is the server's idempotency key (the same
 * dedupKey pattern T12 uses for outbound messages).
 */

import { useRef, useState, type ReactNode } from "react";

export type ActionOutcome =
  | { ok: true; message: string }
  | { ok: false; message: string; conflict?: boolean };

type Props = {
  label: string;
  /** Present tense, shown while the action is running: "Issuing invoice…" */
  pendingLabel: string;
  /**
   * NAV04: issue, release, bulk share and purge must confirm explicitly. When
   * set, the dialog names the consequence in full before anything happens.
   */
  confirm?: { title: string; body: ReactNode; confirmLabel: string };
  danger?: boolean;
  disabled?: boolean;
  onConfirm: () => Promise<ActionOutcome>;
  /** Low-impact reversible edits get an undo instead of a confirmation. */
  onUndo?: () => Promise<ActionOutcome>;
};

export function SafeAction({
  label,
  pendingLabel,
  confirm,
  danger = false,
  disabled = false,
  onConfirm,
  onUndo,
}: Props) {
  const [pending, setPending] = useState(false);
  const [asking, setAsking] = useState(false);
  const [outcome, setOutcome] = useState<ActionOutcome | null>(null);
  const inFlight = useRef(false);

  async function run() {
    // The guard, not the disabled attribute, is what actually stops the
    // second submission — see the note above.
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setAsking(false);
    setOutcome(null);

    try {
      // Nothing is reported until this resolves. That is the requirement.
      const result = await onConfirm();
      setOutcome(result);
    } catch (e) {
      setOutcome({
        ok: false,
        message: e instanceof Error ? e.message : "The action did not complete.",
      });
    } finally {
      setPending(false);
      inFlight.current = false;
    }
  }

  async function undo() {
    if (!onUndo || inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    try {
      setOutcome(await onUndo());
    } finally {
      setPending(false);
      inFlight.current = false;
    }
  }

  return (
    <>
      <button
        type="button"
        className={`btn ${danger ? "btn--danger" : "btn--primary"}`}
        disabled={disabled || pending}
        aria-disabled={disabled || pending}
        onClick={() => (confirm ? setAsking(true) : run())}
      >
        {pending ? (
          <>
            <span
              aria-hidden="true"
              style={{
                width: 14,
                height: 14,
                borderRadius: "50%",
                border: "2px solid currentColor",
                borderTopColor: "transparent",
                display: "inline-block",
              }}
            />
            {pendingLabel}
          </>
        ) : (
          label
        )}
      </button>

      {/* Progress is announced, not only drawn. */}
      <span className="visually-hidden" role="status" aria-live="polite">
        {pending ? pendingLabel : outcome ? outcome.message : ""}
      </span>

      {outcome ? (
        <p
          className={`banner ${outcome.ok ? "banner--info" : outcome.conflict ? "banner--warning" : "banner--danger"}`}
          role={outcome.ok ? "status" : "alert"}
          style={{ marginTop: 12 }}
        >
          <span aria-hidden="true">{outcome.ok ? "✓" : outcome.conflict ? "!" : "▲"}</span>
          <span>
            {outcome.message}
            {outcome.ok && onUndo ? (
              <>
                {" "}
                <button type="button" className="btn" onClick={undo} disabled={pending}>
                  Undo
                </button>
              </>
            ) : null}
          </span>
        </p>
      ) : null}

      {asking && confirm ? (
        <div className="dialog-backdrop">
          <div
            className="dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
            aria-describedby="confirm-body"
          >
            <h2 id="confirm-title">{confirm.title}</h2>
            <div id="confirm-body">{confirm.body}</div>
            <div className="dialog-actions">
              <button type="button" className="btn" onClick={() => setAsking(false)}>
                Cancel
              </button>
              <button
                type="button"
                className={`btn ${danger ? "btn--danger" : "btn--primary"}`}
                onClick={run}
              >
                {confirm.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
