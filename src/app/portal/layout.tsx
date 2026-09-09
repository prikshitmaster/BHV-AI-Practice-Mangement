import type { ReactNode } from "react";

/**
 * The portal shell — POR01, POR05 (PRD §17).
 *
 * Deliberately NOT the staff AppShell. POR01's prohibition is "do not expose
 * internal practice system", and the staff shell is the internal practice
 * system: its menu is built from the permission engine, it carries a firm
 * switcher across practices, and its identity bar names the practice the
 * *staff member* is working in. None of that belongs in front of a client.
 *
 * The root layout renders signed-out children inside a plain `<main>`, and a
 * portal visitor has no staff session, so that is the frame this nests in —
 * which is why there is no second `<main>` here.
 */
export default function PortalLayout({ children }: { children: ReactNode }) {
  return <div className="portal">{children}</div>;
}
