"use client";

/**
 * NAV02 — permission-aware global search.
 *
 * "Provide permission aware global search by client, job, document and
 * reference, with type filters and safe snippets... Recent items clear on
 * logout and are scoped when practice changes."
 *
 * Two things this component deliberately does NOT do:
 *
 *  - It does no filtering. Results, the count and the type facets all arrive
 *    already authorised from /api/search. A component that received everything
 *    and hid some of it would be the leak — and a total that counts records
 *    the user cannot open has already disclosed them (the same rule
 *    searchDocuments follows in T11).
 *
 *  - It does not persist recent items across a practice change or a logout.
 *    They are held in sessionStorage under a key that includes the active
 *    practice, so switching practice cannot surface the other firm's client
 *    names from the search box, and closing the session takes them with it.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

type Hit = {
  id: string;
  type: "client" | "job" | "document" | "reference";
  title: string;
  /** A "safe snippet": already trimmed server-side to what the user may read. */
  snippet: string | null;
  href: string;
};

type SearchState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "empty"; query: string }
  | { kind: "results"; hits: Hit[]; total: number }
  | { kind: "error"; message: string };

const TYPES = ["client", "job", "document", "reference"] as const;

/** sessionStorage can throw outright (private mode, blocked site data). */
function readRecent(key: string): Hit[] {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Hit[]) : [];
  } catch {
    return [];
  }
}

export function GlobalSearch({ practiceId }: { practiceId?: string }) {
  const [query, setQuery] = useState("");
  const [types, setTypes] = useState<string[]>([]);
  const [state, setState] = useState<SearchState>({ kind: "idle" });
  const [recent, setRecent] = useState<{ key: string; items: Hit[] }>(() => ({
    key: `bhv_recent_${practiceId ?? "none"}`,
    items: [],
  }));
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // Recents are keyed by practice, so a switch cannot leak the other firm's
  // names, and sessionStorage means logout takes them.
  const recentKey = `bhv_recent_${practiceId ?? "none"}`;

  // Adjusted during render rather than in an effect: the stored key is part of
  // the state, so a practice switch swaps the list in the same pass that
  // renders it. An effect would paint the previous practice's client names
  // first and correct them a frame later — which is exactly the leak NAV02's
  // "scoped when practice changes" is about.
  if (recent.key !== recentKey) {
    setRecent({ key: recentKey, items: readRecent(recentKey) });
  }
  const recentItems = recent.items;

  // Derived, not stored: a query too short to search is idle by definition.
  const view: SearchState = query.trim().length < 2 ? { kind: "idle" } : state;

  useEffect(() => {
    // Below two characters there is nothing to search, and nothing to reset:
    // the render below derives "idle" from the query itself rather than the
    // effect writing it back. That keeps the effect to one job — talking to
    // the server — instead of also correcting state React can already see.
    if (query.trim().length < 2) return;

    const controller = new AbortController();

    // The loading state is set inside the debounce, not before it. A skeleton
    // that appears on every keystroke and vanishes 250ms later is noise; this
    // way it only shows once a request is genuinely in flight.
    const timer = setTimeout(async () => {
      setState({ kind: "loading" });
      try {
        const params = new URLSearchParams({ q: query.trim() });
        for (const t of types) params.append("type", t);
        if (practiceId) params.set("practiceId", practiceId);

        const response = await fetch(`/api/search?${params}`, { signal: controller.signal });
        if (!response.ok) {
          setState({
            kind: "error",
            message:
              response.status === 401
                ? "Your session has ended. Sign in again to search."
                : "Search is unavailable right now.",
          });
          return;
        }
        const data = (await response.json()) as { hits: Hit[]; total: number };
        setState(
          data.hits.length === 0
            ? { kind: "empty", query: query.trim() }
            : { kind: "results", hits: data.hits, total: data.total },
        );
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        setState({ kind: "error", message: "Search is unavailable right now." });
      }
    }, 250);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query, types, practiceId]);

  function remember(hit: Hit) {
    const next = [hit, ...recentItems.filter((r) => r.id !== hit.id)].slice(0, 6);
    setRecent({ key: recentKey, items: next });
    try {
      sessionStorage.setItem(recentKey, JSON.stringify(next));
    } catch {
      // A browser refusing session storage is not a reason to break search.
    }
  }

  function toggleType(type: string) {
    setTypes((current) =>
      current.includes(type) ? current.filter((t) => t !== type) : [...current, type],
    );
  }

  return (
    <div
      ref={boxRef}
      style={{ position: "relative", flex: "1 1 24rem", maxWidth: "34rem" }}
      onBlur={(e) => {
        if (!boxRef.current?.contains(e.relatedTarget as Node)) setOpen(false);
      }}
    >
      <label htmlFor="global-search" className="visually-hidden">
        Search clients, jobs, documents and references
      </label>
      <input
        id="global-search"
        type="search"
        className="field-input"
        style={{ minHeight: 36 }}
        placeholder="Search clients, jobs, documents…"
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setOpen(false);
            setQuery("");
          }
        }}
        role="combobox"
        aria-expanded={open}
        aria-controls="search-results"
        aria-autocomplete="list"
      />

      {open ? (
        <div
          id="search-results"
          className="card"
          style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 40 }}
        >
          <div className="row" style={{ marginBottom: 8 }}>
            {TYPES.map((type) => (
              <label key={type} className="theme-option" style={{ minHeight: 32 }}>
                <input
                  type="checkbox"
                  className="visually-hidden"
                  checked={types.includes(type)}
                  onChange={() => toggleType(type)}
                />
                <span>{type[0].toUpperCase() + type.slice(1)}s</span>
              </label>
            ))}
          </div>

          {/* NAV03's five states, in a component small enough that people
              usually ship two of them. */}
          {view.kind === "idle" && recentItems.length === 0 ? (
            <p className="muted" style={{ margin: 0, fontSize: 14 }}>
              Type at least two characters to search.
            </p>
          ) : null}

          {view.kind === "idle" && recentItems.length > 0 ? (
            <>
              <p className="nav-section-label" style={{ padding: "0 0 4px" }}>
                Recent
              </p>
              <ul className="nav-list">
                {recentItems.map((hit) => (
                  <li key={hit.id}>
                    <Link className="nav-link" href={hit.href}>
                      <span className="status status--info">{hit.type}</span>
                      {hit.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          {view.kind === "loading" ? (
            <div aria-busy="true" aria-live="polite">
              <span className="visually-hidden">Searching</span>
              <div className="skeleton-row" style={{ width: "80%" }} aria-hidden="true" />
              <div className="skeleton-row" style={{ width: "60%" }} aria-hidden="true" />
            </div>
          ) : null}

          {view.kind === "empty" ? (
            <p role="status" style={{ margin: 0, fontSize: 14 }}>
              Nothing you can access matches &ldquo;{view.query}&rdquo;.
            </p>
          ) : null}

          {view.kind === "error" ? (
            <p role="alert" style={{ margin: 0, fontSize: 14, color: "var(--danger)" }}>
              {view.message}
            </p>
          ) : null}

          {view.kind === "results" ? (
            <>
              <p className="visually-hidden" role="status">
                {view.total} result{view.total === 1 ? "" : "s"}
              </p>
              <ul className="nav-list">
                {view.hits.map((hit) => (
                  <li key={hit.id}>
                    <Link className="nav-link" href={hit.href} onClick={() => remember(hit)}>
                      <span className="status status--info">{hit.type}</span>
                      <span>
                        {hit.title}
                        {hit.snippet ? (
                          <span className="muted" style={{ display: "block", fontSize: 13 }}>
                            {hit.snippet}
                          </span>
                        ) : null}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
              <p className="muted" style={{ margin: "8px 0 0", fontSize: 13 }}>
                {view.total} result{view.total === 1 ? "" : "s"} you can open.
              </p>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
