import type { ReactNode } from "react";
import type { UxContext } from "@/lib/ux";
import { FirmSwitcher } from "@/components/firm-switcher";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { GlobalSearch } from "@/components/global-search";
import { NavLinks } from "@/components/nav-links";
import { SignOutButton } from "@/components/sign-out-button";

/**
 * The staff shell — NAV01, NAV02, UX05 (PRD §38-39).
 *
 * NAV01: "Never show a large grid of every module at login." The menu is the
 * short default list plus whatever the role pins, and nothing else. Everything
 * further in is reached through context — a document from a job, a message
 * from a client — which is also why the nav is built from the same permission
 * engine the API uses rather than from a static list.
 *
 * UX05: the full practice name sits top-left on every page, in text. The
 * coloured dot beside it is a second channel, never the only one.
 */
export function AppShell({ ctx, children }: { ctx: UxContext; children: ReactNode }) {
  const primary = ctx.nav.filter((item) => !item.pinned);
  const pinned = ctx.nav.filter((item) => item.pinned);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to main content
      </a>

      <div className="identity-bar">
        {ctx.activePractice ? (
          <>
            <span
              className={`practice-marker practice-marker--${ctx.activePractice.marker}`}
              aria-hidden="true"
            />
            <span className="practice-name">{ctx.activePractice.name}</span>
            {ctx.activePractice.readOnly ? (
              <span className="status status--warn">Read only</span>
            ) : null}
          </>
        ) : (
          <span className="practice-name">No practice</span>
        )}
      </div>

      <div className="top-bar">
        <GlobalSearch practiceId={ctx.activePractice?.id} />
        <div className="spacer" />
        {ctx.practices.length > 1 ? (
          <FirmSwitcher
            practices={ctx.practices}
            activePracticeId={ctx.activePractice?.id ?? ""}
          />
        ) : null}
        <ThemeSwitcher initial={ctx.theme} />
        <span className="secondary" style={{ fontSize: 14 }}>
          {ctx.userName}
        </span>
        <SignOutButton />
      </div>

      <nav className="side-nav" aria-label="Main">
        <NavLinks items={primary} />
        {pinned.length > 0 ? (
          <>
            <p className="nav-section-label">Pinned</p>
            <NavLinks items={pinned} label="Pinned" />
          </>
        ) : null}
      </nav>

      {/* tabIndex allows the skip link to move focus here, which is the whole
          point of having one. */}
      <main className="main-region" id="main" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}
