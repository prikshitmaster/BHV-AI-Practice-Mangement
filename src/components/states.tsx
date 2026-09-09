import Link from "next/link";
import type { ReactNode } from "react";

/**
 * NAV03 — the five states, as components.
 *
 * "For each screen specify normal, empty, loading, error and permission /
 * conflict states."
 *
 * They live here rather than being written per screen so that a screen cannot
 * quietly ship with four of them, and so a user learns the vocabulary once.
 * The wording of each is part of the requirement, not decoration:
 *
 *   empty       says what is absent, not "no results"
 *   error       preserves the draft and offers a retry
 *   conflict    says "This record changed. Review the latest version"
 *   permission  offers a request route WITHOUT revealing protected facts
 */

/** NAV03 empty. The message names the thing that is absent. */
export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="state" role="status">
      <p className="state-title">{title}</p>
      {body ? <p className="state-body">{body}</p> : null}
      {action}
    </div>
  );
}

/**
 * NAV03 loading. A skeleton that reserves the final layout, announced
 * politely so a screen reader is told work is in progress without the
 * announcement interrupting whatever is being read.
 */
export function LoadingState({ label, rows = 4 }: { label: string; rows?: number }) {
  return (
    <div className="state" aria-busy="true" aria-live="polite">
      <p className="visually-hidden">{label}</p>
      <div aria-hidden="true">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="skeleton-row" style={{ width: `${100 - i * 12}%` }} />
        ))}
      </div>
    </div>
  );
}

/**
 * NAV03 error. "failed save preserves the draft" — so this never replaces the
 * form it reports on; it is rendered ABOVE it, and the caller keeps the draft
 * mounted. The retry is a real control, not an instruction to reload.
 */
export function ErrorState({
  title,
  body,
  retry,
  detail,
}: {
  title: string;
  body?: string;
  retry?: ReactNode;
  detail?: string;
}) {
  return (
    <div className="state state--error" role="alert">
      <p className="state-title">{title}</p>
      {body ? <p className="state-body">{body}</p> : null}
      {detail ? (
        <p className="state-body muted">
          <code>{detail}</code>
        </p>
      ) : null}
      {retry}
    </div>
  );
}

/**
 * NAV03 conflict. The wording is quoted from the requirement. It appears when
 * an optimistic version check fails (API02) — which is why the app has version
 * columns at all: so this state can exist instead of a silent overwrite.
 */
export function ConflictState({
  what,
  reviewHref,
}: {
  what: string;
  reviewHref?: string;
}) {
  return (
    <div className="state state--conflict" role="alert">
      <p className="state-title">This record changed. Review the latest version.</p>
      <p className="state-body">
        Someone else saved {what} while you were working. Your draft has been kept — compare it with
        the current version before saving again, so neither change is lost.
      </p>
      {reviewHref ? (
        <Link className="btn" href={reviewHref}>
          Review the latest version
        </Link>
      ) : null}
    </div>
  );
}

/**
 * NAV03 permission. "denied access offers a request route without revealing
 * protected facts."
 *
 * Note what this component deliberately CANNOT say: it takes no record name,
 * no client name and no practice name. Naming the thing you are not allowed to
 * see is itself the disclosure — the same reason PracticeAccessError returns
 * 404 rather than 403. All it offers is the route to ask.
 */
export function PermissionState({
  requestHref = "/practice/access-request",
}: {
  requestHref?: string;
}) {
  return (
    <div className="state" role="alert">
      <p className="state-title">You do not have access to this</p>
      <p className="state-body">
        This may be because it belongs to another practice, or because it needs a permission your
        role does not carry. If you need it for work you are doing, ask for access and say why.
      </p>
      <Link className="btn" href={requestHref}>
        Request access
      </Link>
    </div>
  );
}

/**
 * The normal state's frame. Every screen renders through this so the heading
 * level, the landmark and the breadcrumb slot are consistent — NAV02's
 * "preserve breadcrumbs and a Back destination".
 */
export function Screen({
  title,
  lede,
  breadcrumbs,
  actions,
  children,
}: {
  title: string;
  lede?: string;
  breadcrumbs?: { href: string; label: string }[];
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      {breadcrumbs && breadcrumbs.length > 0 ? (
        <nav className="breadcrumbs" aria-label="Breadcrumb">
          <ol>
            {breadcrumbs.map((crumb) => (
              <li key={crumb.href}>
                <Link href={crumb.href}>{crumb.label}</Link>
              </li>
            ))}
          </ol>
        </nav>
      ) : null}
      <div className="row">
        <div>
          <h1>{title}</h1>
          {lede ? <p className="page-lede">{lede}</p> : null}
        </div>
        <div className="spacer" />
        {actions}
      </div>
      {children}
    </>
  );
}
