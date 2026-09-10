/**
 * Presentation context for the app shell — UX01, UX05, NAV01, NAV02
 * (PRD §38-39).
 *
 * Everything here is display state. It decides what a screen LOOKS like, never
 * what a user may reach: the navigation returned below is filtered by the same
 * permission engine the API routes use, so a menu item is absent because the
 * capability is absent — not the other way round. IAM01's rule holds:
 * "Hiding a menu is not an access control", and this module is the hiding, not
 * the control.
 */

import type { Density, PracticeRole, ThemePreference } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { can, resolveMembership, type Action, type ResolvedMembership } from "@/lib/permissions";
import { requireActor } from "@/lib/session";

export type PracticeSummary = {
  id: string;
  /** UX05: the FULL name. Never an abbreviation, never only a colour. */
  name: string;
  /** Supplements the name; never replaces it. */
  marker: "a" | "b";
  readOnly: boolean;
};

export type UxContext = {
  userId: string;
  userName: string;
  theme: ThemePreference;
  density: Density;
  activePractice: PracticeSummary | null;
  practices: PracticeSummary[];
  membership: ResolvedMembership | null;
  nav: NavItem[];
};

export type NavItem = {
  href: string;
  label: string;
  /** NAV01: pinned items appear for the roles that need them, not for all. */
  pinned?: boolean;
};

/**
 * NAV01: "Default staff navigation: Home, My work, Clients, Calendar,
 * Documents, Practice and More. Finance can pin Billing; managers can pin
 * Team / Reports... Never show a large grid of every module at login."
 *
 * The default list is short on purpose. Everything else is reached through
 * context — a document from a job, a message from a client — rather than from
 * a wall of icons.
 */
const DEFAULT_NAV: { item: NavItem; requires?: Action }[] = [
  { item: { href: "/", label: "Home" } },
  { item: { href: "/my-work", label: "My work" }, requires: "job.read" },
  { item: { href: "/clients", label: "Clients" }, requires: "client.read" },
  { item: { href: "/calendar", label: "Calendar" }, requires: "job.read" },
  { item: { href: "/documents", label: "Documents" }, requires: "document.read" },
  { item: { href: "/practice", label: "Practice" } },
];

/**
 * NAV01 names who pins what, and the two are different on purpose:
 * "Finance can pin Billing; managers can pin Team / Reports."
 *
 * A manager is NOT given Billing here. They can still reach an invoice through
 * a client — the pin is about what earns permanent space in the menu, not
 * about what is permitted.
 */
const PINNED_NAV: {
  item: NavItem;
  requires: Action;
  roles: PracticeRole[];
  /**
   * Whether the destination exists yet. A menu entry pointing at a route that
   * 404s is worse than no entry: the user is told a capability exists, follows
   * it, and lands nowhere. These stay listed rather than being deleted so that
   * NAV01's rule is still readable here and the task that turns each one on is
   * named — set it to true in that task, and the pin appears.
   */
  built: boolean;
}[] = [
  {
    // T14 — FIN01/FIN02/FIN04. Built: /billing lists the register and
    // /billing/[invoiceId] carries the issue action.
    item: { href: "/billing", label: "Billing", pinned: true },
    requires: "invoice.read",
    roles: ["FINANCE", "PRACTICE_PARTNER", "GROUP_OWNER"],
    built: true,
  },
  {
    item: { href: "/team", label: "Team", pinned: true },
    requires: "job.read",
    roles: ["MANAGER", "PRACTICE_PARTNER", "GROUP_OWNER"],
    built: true,
  },
  {
    // T17 — REP01. A reports pin needs a reports screen that can state its
    // refresh time, formula and record count; a stub that cannot would break
    // the requirement it is meant to satisfy.
    item: { href: "/reports", label: "Reports", pinned: true },
    requires: "export.run",
    roles: ["MANAGER", "PRACTICE_PARTNER", "GROUP_OWNER"],
    built: false,
  },
  {
    item: { href: "/review", label: "Review queue", pinned: true },
    requires: "filing.approve",
    roles: ["REVIEWER", "QUALITY_REVIEWER", "PRACTICE_PARTNER", "GROUP_OWNER"],
    built: true,
  },
];

export function buildNav(membership: ResolvedMembership | null): NavItem[] {
  if (!membership) return [{ href: "/", label: "Home" }];

  const nav: NavItem[] = [];
  for (const entry of DEFAULT_NAV) {
    if (!entry.requires || can(membership, entry.requires)) nav.push(entry.item);
  }
  for (const entry of PINNED_NAV) {
    if (entry.built && entry.roles.includes(membership.role) && can(membership, entry.requires)) {
      nav.push(entry.item);
    }
  }
  return nav;
}

/**
 * Resolve everything the shell needs in one pass.
 *
 * `practiceId` arrives from a cookie or a URL and is treated as a REQUEST: if
 * the user has no live membership in it, the active practice falls back to one
 * they do hold rather than being honoured. NAV03's "deep link to the wrong
 * practice is rejected safely and does not silently switch authority" is
 * enforced here — the switch simply does not happen, and no data is read under
 * the requested scope.
 */
export async function loadUxContext(requestedPracticeId?: string | null): Promise<UxContext | null> {
  let userId: string;
  try {
    userId = (await requireActor()).userId;
  } catch {
    return null;
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, fullName: true, themePreference: true, densityPreference: true },
  });
  if (!user) return null;

  const now = new Date();
  const memberships = await prisma.practiceMembership.findMany({
    where: {
      userId,
      revokedAt: null,
      effectiveFrom: { lte: now },
      AND: [
        { OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] },
        { OR: [{ grantExpiresAt: null }, { grantExpiresAt: { gt: now } }] },
      ],
      practice: { archivedAt: null },
    },
    select: {
      practice: {
        select: { id: true, name: true, registeredDisplayName: true, readOnlyFrom: true },
      },
    },
    orderBy: { practice: { name: "asc" } },
  });

  const practices: PracticeSummary[] = memberships.map((m, index) => ({
    id: m.practice.id,
    name: m.practice.registeredDisplayName ?? m.practice.name,
    marker: index % 2 === 0 ? "a" : "b",
    readOnly: m.practice.readOnlyFrom !== null && m.practice.readOnlyFrom <= now,
  }));

  const requested = practices.find((p) => p.id === requestedPracticeId);
  const activePractice = requested ?? practices[0] ?? null;

  const membership = activePractice
    ? await resolveMembership(userId, activePractice.id, now)
    : null;

  return {
    userId: user.id,
    userName: user.fullName,
    theme: user.themePreference,
    density: user.densityPreference,
    activePractice,
    practices,
    membership,
    nav: buildNav(membership),
  };
}

/**
 * UX05: "A warning before cross practice changes must name both source and
 * destination; colour is not sufficient."
 *
 * Returned as text, not as a styling hint, so the warning survives a
 * screen reader, a print, and a monochrome display.
 */
export function crossPracticeWarning(
  from: PracticeSummary | null,
  to: PracticeSummary,
): string | null {
  if (!from || from.id === to.id) return null;
  return `You are switching from ${from.name} to ${to.name}. Records you open after this belong to ${to.name}, and work in progress in ${from.name} is not carried across.`;
}
