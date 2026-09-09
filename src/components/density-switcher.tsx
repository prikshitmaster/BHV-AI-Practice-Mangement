"use client";

import { useState } from "react";
import { mutate } from "@/lib/client-fetch";

/**
 * UX02 — "optional comfortable density".
 *
 * Same discipline as the theme control: it writes the attribute onto <html>
 * directly, so a change never remounts the page and never costs the user
 * whatever they were part-way through typing.
 *
 * Compact tightens table rows and card padding only. Body text stays at 16px
 * in both modes, because UX02 permits 14px for tables specifically and warns
 * against small essential text everywhere else — "compact" must not become a
 * way to opt out of readable prose.
 */

type Density = "COMFORTABLE" | "COMPACT";

function apply(density: Density) {
  const root = document.documentElement;
  root.dataset.density = density.toLowerCase();
}

export function DensitySwitcher({ initial }: { initial: Density }) {
  const [density, setDensity] = useState<Density>(initial);
  const [saveFailed, setSaveFailed] = useState(false);

  async function choose(next: Density) {
    setDensity(next);
    apply(next);
    setSaveFailed(false);

    try {
      const response = await mutate("/api/preferences", {
        method: "PUT",
        body: JSON.stringify({ densityPreference: next }),
      });
      if (!response.ok) setSaveFailed(true);
    } catch {
      setSaveFailed(true);
    }
  }

  return (
    <div className="row">
      <fieldset style={{ border: 0, margin: 0, padding: 0, display: "flex", gap: 4 }}>
        <legend className="field-label">Table density</legend>
        {(
          [
            { value: "COMFORTABLE", label: "Comfortable" },
            { value: "COMPACT", label: "Compact" },
          ] as const
        ).map((option) => (
          <label key={option.value} className="theme-option">
            <input
              type="radio"
              name="density"
              value={option.value}
              checked={density === option.value}
              onChange={() => choose(option.value)}
              className="visually-hidden"
            />
            <span>{option.label}</span>
          </label>
        ))}
      </fieldset>
      {saveFailed ? (
        <span role="status" className="status status--warn">
          Not saved for next time
        </span>
      ) : null}
    </div>
  );
}
