"use client";

import { useState } from "react";
import { mutate } from "@/lib/client-fetch";

/**
 * UX01 theme control — Light, Dark, System, saved per user.
 *
 * The requirement this component exists to satisfy is the second sentence:
 * "Switching theme preserves scroll, draft and selected record."
 *
 * So it does NOT navigate, call router.refresh(), or re-render any tree but
 * its own. It writes `data-theme` straight onto <html>, which restyles the
 * page through the CSS custom properties without React touching the DOM the
 * user is working in. An unsaved draft in a form, the scroll position and the
 * selected row are all preserved because nothing unmounts them.
 *
 * The save is fire-and-forget in the background. If it fails the appearance
 * still changed — the user got what they asked for now — and the control says
 * plainly that the preference did not stick, rather than silently reverting
 * under them.
 */

type Theme = "LIGHT" | "DARK" | "SYSTEM";

const OPTIONS: { value: Theme; label: string }[] = [
  { value: "LIGHT", label: "Light" },
  { value: "DARK", label: "Dark" },
  { value: "SYSTEM", label: "System" },
];

function apply(theme: Theme) {
  const root = document.documentElement;
  if (theme === "SYSTEM") {
    // Removing the attribute hands control back to prefers-color-scheme. The
    // stylesheet's dark block is written as :root:not([data-theme="light"])
    // precisely so this works in both directions.
    delete root.dataset.theme;
  } else {
    root.dataset.theme = theme.toLowerCase();
  }
}

export function ThemeSwitcher({ initial }: { initial: Theme }) {
  const [theme, setTheme] = useState<Theme>(initial);
  const [saveFailed, setSaveFailed] = useState(false);

  async function choose(next: Theme) {
    setTheme(next);
    apply(next);
    setSaveFailed(false);

    try {
      const response = await mutate("/api/preferences", {
        method: "PUT",
        body: JSON.stringify({ themePreference: next }),
      });
      if (!response.ok) setSaveFailed(true);
    } catch {
      setSaveFailed(true);
    }
  }

  return (
    <div className="row">
      <fieldset
        style={{ border: 0, margin: 0, padding: 0, display: "flex", gap: 4, alignItems: "center" }}
      >
        <legend className="visually-hidden">Appearance</legend>
        {OPTIONS.map((option) => (
          <label key={option.value} className="theme-option">
            <input
              type="radio"
              name="theme"
              value={option.value}
              checked={theme === option.value}
              onChange={() => choose(option.value)}
              className="visually-hidden"
            />
            <span aria-hidden="true">{option.label}</span>
            <span className="visually-hidden">
              {option.label} appearance
              {theme === option.value ? " (selected)" : ""}
            </span>
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
