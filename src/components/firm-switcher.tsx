"use client";

/**
 * Practice switcher — ORG03 (PRD §7) and UX05 (PRD §38).
 *
 * Four rules drive this component:
 *   1. the active practice is visible at all times, not buried in a menu;
 *   2. in Combined view, creating anything requires choosing a practice
 *      first — there is no implicit "current" firm to fall back on;
 *   3. changing context clears or revalidates selected recipients, accounts
 *      and drafts, because they were chosen under the old identity;
 *   4. UX05: the warning before a cross-practice change must NAME BOTH the
 *      source and the destination. Colour is not sufficient, and neither is
 *      naming only the firm you are leaving — the whole risk is not knowing
 *      which letterhead the next thing you do goes out under.
 *
 * Unlike the theme control, switching practice DOES reload: ORG03 requires
 * work chosen under the old identity to be revalidated, so carrying the page
 * across would be the bug, not the feature.
 */

import { useState } from "react";

export type PracticeSummary = {
  id: string;
  name: string;
  marker: "a" | "b";
  readOnly: boolean;
};

export const COMBINED_VIEW = "__combined__";

type Props = {
  practices: PracticeSummary[];
  activePracticeId: string;
  /** ORG03: set when the user has typed something not yet saved. */
  hasUnsavedDraft?: boolean;
};

export function FirmSwitcher({ practices, activePracticeId, hasUnsavedDraft = false }: Props) {
  const [pendingSwitch, setPendingSwitch] = useState<string | null>(null);

  const active = practices.find((p) => p.id === activePracticeId) ?? null;
  const destination = practices.find((p) => p.id === pendingSwitch) ?? null;

  function applySwitch(next: string) {
    // A year is fine: this is a display preference, and the server re-checks
    // membership on every request regardless of what the cookie claims.
    document.cookie = `bhv_practice=${encodeURIComponent(next)}; path=/; max-age=31536000; samesite=lax`;
    window.location.assign(window.location.pathname);
  }

  function requestSwitch(next: string) {
    if (next === activePracticeId) return;
    setPendingSwitch(next);
  }

  return (
    <>
      <label htmlFor="firm-switcher" className="visually-hidden">
        Active practice
      </label>
      <select
        id="firm-switcher"
        className="field-input"
        style={{ maxWidth: "22rem", minHeight: 36 }}
        value={activePracticeId}
        onChange={(e) => requestSwitch(e.target.value)}
      >
        <option value={COMBINED_VIEW}>Combined view (read only)</option>
        {practices.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
            {p.readOnly ? " (read only)" : ""}
          </option>
        ))}
      </select>

      {pendingSwitch && destination ? (
        <div className="dialog-backdrop">
          <div
            className="dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="switch-title"
            aria-describedby="switch-body"
          >
            <h2 id="switch-title">Switch practice?</h2>
            {/* UX05: both names, in text. A reader who cannot see the marker
                colours still gets the whole meaning. */}
            <p id="switch-body">
              You are switching from <strong>{active ? active.name : "Combined view"}</strong> to{" "}
              <strong>{destination.name}</strong>. Records you open after this belong to{" "}
              <strong>{destination.name}</strong>, and anything you send or issue will go out under
              that practice&rsquo;s identity.
            </p>
            {hasUnsavedDraft ? (
              <p className="banner banner--warning" style={{ marginTop: 16 }}>
                <span aria-hidden="true">!</span>
                <span>
                  Unsaved work on this screen was prepared for{" "}
                  <strong>{active ? active.name : "Combined view"}</strong> and will not be carried
                  across.
                </span>
              </p>
            ) : null}
            <div className="dialog-actions">
              <button type="button" className="btn" onClick={() => setPendingSwitch(null)}>
                Stay in {active ? active.name : "Combined view"}
              </button>
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => applySwitch(pendingSwitch)}
              >
                Switch to {destination.name}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

/**
 * ORG03: guard for any create/send/invoice/signoff/export action. Combined
 * view is a reading position — it can never be the author of a record.
 */
export function assertPracticeChosen(activePracticeId: string): string {
  if (!activePracticeId || activePracticeId === COMBINED_VIEW) {
    throw new Error("Choose a practice before creating, sending or issuing.");
  }
  return activePracticeId;
}
