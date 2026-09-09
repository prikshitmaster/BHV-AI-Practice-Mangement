"use client";

/**
 * ORG03 firm switcher.
 *
 * Three rules from the PRD drive this component:
 *   1. the active practice is visible at all times, not buried in a menu;
 *   2. in Combined view, creating anything requires choosing a practice
 *      first — there is no implicit "current" firm to fall back on;
 *   3. changing context clears or revalidates selected recipients, accounts
 *      and drafts, because they were chosen under the old identity.
 */

import { useCallback, useEffect, useState } from "react";

export type PracticeSummary = {
  id: string;
  name: string;
  registeredDisplayName: string | null;
  constitution: string;
  readOnlyFrom: string | null;
};

export const COMBINED_VIEW = "__combined__";

type Props = {
  practices: PracticeSummary[];
  activePracticeId: string;
  onContextChange: (practiceId: string) => void;
  /** Called when a switch invalidates in-progress work (ORG03). */
  onDraftInvalidated?: () => void;
  hasUnsavedDraft?: boolean;
};

export function FirmSwitcher({
  practices,
  activePracticeId,
  onContextChange,
  onDraftInvalidated,
  hasUnsavedDraft = false,
}: Props) {
  const [pendingSwitch, setPendingSwitch] = useState<string | null>(null);

  const applySwitch = useCallback(
    (next: string) => {
      onContextChange(next);
      onDraftInvalidated?.();
      setPendingSwitch(null);
    },
    [onContextChange, onDraftInvalidated],
  );

  const requestSwitch = (next: string) => {
    if (next === activePracticeId) return;
    // Never silently discard work the user typed under the other identity.
    if (hasUnsavedDraft) setPendingSwitch(next);
    else applySwitch(next);
  };

  const active =
    activePracticeId === COMBINED_VIEW
      ? null
      : practices.find((p) => p.id === activePracticeId);

  const isReadOnly = active?.readOnlyFrom != null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <label htmlFor="firm-switcher" className="text-sm font-medium">
          Practice
        </label>

        <select
          id="firm-switcher"
          value={activePracticeId}
          onChange={(e) => requestSwitch(e.target.value)}
          className="rounded border px-2 py-1 text-sm"
          // NAV03: identity must be conveyed by more than colour.
          aria-label="Active practice"
        >
          <option value={COMBINED_VIEW}>Combined view (read only)</option>
          {practices.map((p) => (
            <option key={p.id} value={p.id}>
              {p.registeredDisplayName ?? p.name}
            </option>
          ))}
        </select>

        <span
          className="rounded bg-neutral-200 px-2 py-1 text-xs font-semibold dark:bg-neutral-700"
          data-testid="active-practice-badge"
        >
          {active ? (active.registeredDisplayName ?? active.name) : "Combined — choose a practice to create"}
        </span>

        {isReadOnly && (
          <span className="rounded bg-amber-200 px-2 py-1 text-xs text-amber-900">
            Read only
          </span>
        )}
      </div>

      {pendingSwitch && (
        <div role="alertdialog" aria-labelledby="switch-warning" className="rounded border p-3 text-sm">
          <p id="switch-warning">
            Switching practice clears the recipients, bank account and draft you
            selected under{" "}
            <strong>{active?.registeredDisplayName ?? active?.name ?? "Combined view"}</strong>.
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              className="rounded border px-2 py-1"
              onClick={() => applySwitch(pendingSwitch)}
            >
              Switch and clear draft
            </button>
            <button
              type="button"
              className="rounded border px-2 py-1"
              onClick={() => setPendingSwitch(null)}
            >
              Stay here
            </button>
          </div>
        </div>
      )}
    </div>
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

/** Loads the switcher's options from the scoped API. */
export function usePractices() {
  const [practices, setPractices] = useState<PracticeSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/practices")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        if (!cancelled) setPractices(d.practices ?? []);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { practices, error, loading };
}
