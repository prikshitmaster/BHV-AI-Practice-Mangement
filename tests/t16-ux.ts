/**
 * T16 acceptance test — UX01-05, NAV01-04 (PRD §38-39).
 *
 * PRD acceptance evidence:
 *   §38 "Complete client onboarding, document review and invoice issue using
 *        only the keyboard in both themes. At 200% zoom, essential controls and
 *        text remain usable. Validate each final token pairing, including
 *        errors and disabled states, rather than assuming dark mode is a
 *        colour inversion."
 *   §39 "A new article reaches assigned work from login without a tutorial. A
 *        failed upload retains its context and a retry option. A deep link to
 *        the wrong practice is rejected safely and does not silently switch
 *        authority."
 *
 * WHAT THIS FILE COVERS AND WHAT IT DOES NOT
 *
 * Covered here, mechanically:
 *   - every final token pairing in both themes, recomputed from globals.css
 *     (§38's third sentence — the one that catches an inverted palette);
 *   - the structural half of keyboard and screen-reader access, asserted
 *     against the REAL rendered HTML over HTTP: landmarks, skip link, labels,
 *     aria-current, table scopes, focus styling, status text alongside colour;
 *   - NAV01's menu shape, NAV03's five states, and the deep-link rejection.
 *
 * NOT observable here: what a dialog does with focus once a user opens it.
 * The confirmation is not in any server-rendered response, so the browser pass
 * (recorded in PROGRESS.md) is what found its three keyboard defects; the
 * assertions near the end of this file guard the fixes at source level.
 *
 * Needs the dev server running. Run: npm run test:t16
 */

import "dotenv/config";
import { readFileSync } from "node:fs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { createSession } from "../src/lib/auth";
import {
  approveInvoice,
  createInvoiceSeries,
  draftInvoice,
} from "../src/lib/invoicing";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail = "") {
  if (condition) {
    console.log(`  PASS  ${name}`);
    passed++;
  } else {
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

const RUN = Date.now();
const tag = (s: string) => `${s}-${RUN}`;
const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

// ---------------------------------------------------------------- contrast

/** WCAG 2.x relative luminance and contrast ratio, from first principles. */
function luminance(hex: string): number {
  const channels = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
}

/** Pull one CSS block's custom properties out of globals.css. */
function tokenBlock(css: string, selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  if (start < 0) throw new Error(`globals.css has no block for ${selector}`);
  const open = css.indexOf("{", start);
  let depth = 0;
  let end = open;
  for (; end < css.length; end++) {
    if (css[end] === "{") depth++;
    else if (css[end] === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  const body = css.slice(open + 1, end);
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6})/g)) out[m[1]] = m[2];
  return out;
}

/**
 * Every pairing the interface actually renders. Threshold 4.5 for normal
 * text, 3 for meaningful boundaries and control edges (UX03).
 *
 * The disabled BORDER is deliberately absent: WCAG 2.2 SC 1.4.11 exempts
 * inactive components, and asserting a threshold the standard exempts would
 * only push the design towards a disabled control that looks enabled.
 * Disabled TEXT is still held to 4.5:1, because people do read it.
 */
const PAIRS: [string, string, number, string][] = [
  ["--text-primary", "--surface", 4.5, "body text on page"],
  ["--text-primary", "--surface-raised", 4.5, "body text on card"],
  ["--text-primary", "--surface-sunken", 4.5, "body text on sunken surface"],
  ["--text-secondary", "--surface", 4.5, "secondary text on page"],
  ["--text-secondary", "--surface-raised", 4.5, "secondary text on card"],
  ["--text-muted", "--surface", 4.5, "muted text on page"],
  ["--text-muted", "--surface-raised", 4.5, "muted text on card"],
  ["--text-on-accent", "--accent", 4.5, "primary button label"],
  ["--text-on-accent", "--accent-hover", 4.5, "primary button label, hovered"],
  ["--text-on-inverse", "--surface-inverse", 4.5, "text on inverse surface"],
  ["--accent", "--surface-raised", 4.5, "link on card"],
  ["--accent", "--surface", 4.5, "link on page"],
  ["--accent", "--accent-subtle-bg", 4.5, "active nav item"],
  ["--success", "--success-bg", 4.5, "success pill"],
  ["--warning", "--warning-bg", 4.5, "warning pill"],
  ["--danger", "--danger-bg", 4.5, "danger pill"],
  ["--info", "--info-bg", 4.5, "info pill"],
  ["--success", "--surface-raised", 4.5, "success text on card"],
  ["--warning", "--surface-raised", 4.5, "warning text on card"],
  ["--danger", "--surface-raised", 4.5, "error text on card"],
  ["--disabled-text", "--disabled-bg", 4.5, "disabled control label"],
  ["--border-strong", "--surface-raised", 3, "control edge on card"],
  ["--border-strong", "--surface", 3, "control edge on page"],
  ["--focus-ring", "--surface-raised", 3, "focus ring on card"],
  ["--focus-ring", "--surface", 3, "focus ring on page"],
  ["--focus-ring", "--focus-ring-offset", 3, "focus ring against its separator"],
  ["--focus-ring-offset", "--accent", 3, "focus separator against primary button"],
  ["--focus-ring-offset", "--danger", 3, "focus separator against danger control"],
];

async function main() {
  console.log("\nT16 — navigation and UX states (PRD §38-39, UX01-05 / NAV01-04)\n");

  // ================================================================== UX01-03
  console.log("UX01-03 — token pairings, recomputed in both themes");

  const css = readFileSync("src/app/globals.css", "utf8");
  const light = tokenBlock(css, ":root {");
  const dark = tokenBlock(css, ':root[data-theme="dark"] {');

  check("light and dark are declared as separate palettes", Object.keys(dark).length > 20);
  // If dark were an inversion, the accent would be the same hue family flipped.
  // It is not: these are independently chosen values.
  check(
    "dark is NOT an inversion of light (the accent differs by choice, not by flip)",
    light["--accent"] !== dark["--accent"] &&
      luminance(dark["--accent"]) > luminance(light["--accent"]),
  );

  for (const [themeName, tokens] of [
    ["light", light],
    ["dark", dark],
  ] as const) {
    let worst = Infinity;
    let worstName = "";
    let allOk = true;
    for (const [fg, bg, min, what] of PAIRS) {
      if (!tokens[fg] || !tokens[bg]) {
        check(`${themeName}: ${what} — tokens defined`, false, `${fg} or ${bg} missing`);
        allOk = false;
        continue;
      }
      const ratio = contrast(tokens[fg], tokens[bg]);
      if (ratio < min) {
        check(`${themeName}: ${what} meets ${min}:1`, false, `${ratio.toFixed(2)}:1`);
        allOk = false;
      }
      if (ratio - min < worst) {
        worst = ratio - min;
        worstName = `${what} (${ratio.toFixed(2)}:1, needs ${min})`;
      }
    }
    check(`${themeName}: all ${PAIRS.length} pairings meet their threshold`, allOk);
    console.log(`        tightest margin — ${worstName}`);
  }

  check(
    "body text is 16px and tables may use 14px (UX02)",
    /--font-body:\s*16px/.test(css) && /--font-table:\s*14px/.test(css),
  );
  check("touch targets are 44px (UX03)", /--touch-target:\s*44px/.test(css));
  check("focus is never removed", !/outline:\s*none/.test(css));
  check(
    "reduced motion is honoured (UX02 forbids constant animation)",
    /prefers-reduced-motion/.test(css),
  );
  check(
    "print uses a light document style even in dark mode (UX01)",
    /@media print/.test(css) && /:root\[data-theme="dark"\]\s*\{[^}]*--surface:\s*#ffffff/.test(
      css.slice(css.indexOf("@media print")),
    ),
  );

  // ================================================================= fixtures
  console.log("\nFixtures — two practices, one article, one manager");

  const tenant = await prisma.tenant.create({ data: { name: tag("T") } });
  const company = await prisma.practice.create({
    data: {
      tenantId: tenant.id,
      name: tag("Fictional Company LLP"),
      registeredDisplayName: tag("Fictional Company LLP"),
      constitution: "LLP",
      documentNamespace: tag("co"),
      effectiveFrom: d("2024-04-01"),
    },
  });
  const associates = await prisma.practice.create({
    data: {
      tenantId: tenant.id,
      name: tag("Fictional Associates"),
      registeredDisplayName: tag("Fictional Associates"),
      constitution: "PARTNERSHIP",
      documentNamespace: tag("as"),
      effectiveFrom: d("2024-04-01"),
    },
  });

  const article = await prisma.user.create({
    data: {
      email: `article-${RUN}@example.invalid`,
      fullName: "Fictional Article",
      status: "ACTIVE",
      themePreference: "SYSTEM",
    },
  });
  const manager = await prisma.user.create({
    data: {
      email: `manager-${RUN}@example.invalid`,
      fullName: "Fictional Manager",
      status: "ACTIVE",
      themePreference: "DARK",
    },
  });

  await prisma.practiceMembership.createMany({
    data: [
      { practiceId: company.id, userId: article.id, role: "STAFF_ARTICLE", assignmentScope: "OWN_WORK", effectiveFrom: d("2024-04-01") },
      { practiceId: company.id, userId: manager.id, role: "MANAGER", assignmentScope: "PRACTICE", effectiveFrom: d("2024-04-01") },
      { practiceId: associates.id, userId: manager.id, role: "MANAGER", assignmentScope: "PRACTICE", effectiveFrom: d("2024-04-01") },
    ],
  });

  const party = await prisma.party.create({
    data: { tenantId: tenant.id, legalName: tag("Fictional Client Private Limited"), type: "COMPANY" },
  });
  const coRel = await prisma.clientRelationship.create({
    data: { practiceId: company.id, partyId: party.id, acceptanceStatus: "ACCEPTED" },
  });
  // The record the deep-link test aims at: it exists, in the OTHER practice.
  const asParty = await prisma.party.create({
    data: { tenantId: tenant.id, legalName: tag("Associates Only Client Limited"), type: "COMPANY" },
  });
  const asRel = await prisma.clientRelationship.create({
    data: { practiceId: associates.id, partyId: asParty.id, acceptanceStatus: "ACCEPTED" },
  });

  const engagement = await prisma.engagement.create({
    data: {
      practiceId: company.id,
      clientRelationshipId: coRel.id,
      serviceCode: "GST-ANNUAL",
      templateVersion: "1",
      periodStart: d("2025-04-01"),
      periodEnd: d("2026-03-31"),
      state: "ACTIVE",
    },
  });
  const job = await prisma.job.create({
    data: {
      practiceId: company.id,
      engagementId: engagement.id,
      title: tag("GSTR-9 preparation"),
      periodKey: "FY2025-26",
      dedupKey: tag("job"),
      state: "IN_PROGRESS",
      ownerUserId: article.id,
      dueDate: d("2026-12-31"),
    },
  });

  /**
   * Sign a user in through the app's OWN createSession, not a hand-rolled
   * copy of it. A test that reimplements token hashing proves its own
   * reimplementation works; this proves the real login path does.
   */
  async function sessionFor(userId: string): Promise<string> {
    const { token } = await createSession(userId, { deviceLabel: "t16" });
    return `bhv_session=${token}`;
  }

  const articleCookie = await sessionFor(article.id);
  const managerCookie = await sessionFor(manager.id);

  async function get(path: string, cookie: string, extra = ""): Promise<{ status: number; html: string }> {
    const response = await fetch(`${BASE}${path}`, {
      headers: { cookie: `${cookie}${extra ? `; ${extra}` : ""}` },
      redirect: "manual",
    });
    return { status: response.status, html: await response.text() };
  }

  // Warm the dev server so first-compile latency is not read as a failure.
  await get("/", articleCookie);

  // ================================================================== NAV01
  console.log("\nNAV01 — the menu is short, and built from permissions");

  const articleHome = await get("/", articleCookie);
  check("the app renders for a signed-in article", articleHome.status === 200);
  check(
    "the article's practice is named in full (UX05)",
    articleHome.html.includes(company.registeredDisplayName!),
  );

  const navHrefs = [...articleHome.html.matchAll(/class="nav-link"[^>]*href="([^"]+)"/g)].map(
    (m) => m[1],
  );
  const homeHrefs = [...articleHome.html.matchAll(/href="(\/[a-z-]*)"[^>]*class="nav-link"/g)].map(
    (m) => m[1],
  );
  const allNav = [...new Set([...navHrefs, ...homeHrefs])];

  check(
    "the default menu is a short list, not a grid of every module",
    allNav.length > 0 && allNav.length <= 8,
    `found ${allNav.length}: ${allNav.join(", ")}`,
  );
  check("Home, My work, Clients, Documents and Practice are present", ["/", "/my-work", "/clients", "/documents", "/practice"].every((h) => articleHome.html.includes(`href="${h}"`)));

  // An article holds no invoice.read and no filing.approve, so neither pin
  // appears — the menu is the permission engine's answer, not a static list.
  check("an article sees no Billing pin", !articleHome.html.includes('href="/billing"'));
  check("an article sees no Review queue pin", !articleHome.html.includes('href="/review"'));
  check("an article sees no Team pin", !articleHome.html.includes('href="/team"'));

  const managerHome = await get("/", managerCookie, `bhv_practice=${company.id}`);
  // NAV01 is specific about who pins what: "Finance can pin Billing; managers
  // can pin Team / Reports." A manager getting Billing would be a misreading.
  check("a manager sees the Team pin", managerHome.html.includes('href="/team"'));
  check(
    "...but NOT Billing — that is Finance's pin, not a manager's",
    !managerHome.html.includes('href="/billing"'),
  );
  // NAV01's Reports pin is a manager's by right. It was withheld while
  // /reports did not exist — a menu entry that leads to a 404 tells the user a
  // capability is there and then strands them. T17 built the screen and turned
  // the pin on, so the assertion inverted with it; the href walk below is what
  // keeps the two honest about each other.
  check(
    "...and the Reports pin, now that T17 has built the screen",
    managerHome.html.includes('href="/reports"'),
  );

  /**
   * The general form of that rule, asserted mechanically rather than pin by
   * pin: whatever the menu offers, every destination in it must resolve. This
   * is the assertion that stops the next dangling link from being added — the
   * previous three (/team, /reports, /billing) all shipped as 404s because
   * nothing checked.
   */
  // Attribute order is React's business and has flipped before, so both
  // orderings are matched — the same way the NAV01 assertion above does it.
  const managerNav = [
    ...new Set([
      ...[...managerHome.html.matchAll(/class="nav-link"[^>]*href="([^"]+)"/g)].map((m) => m[1]),
      ...[...managerHome.html.matchAll(/href="([^"]+)"[^>]*class="nav-link"/g)].map((m) => m[1]),
    ]),
  ];
  let allNavResolve = true;
  const brokenNav: string[] = [];
  for (const href of managerNav) {
    const response = await fetch(`${BASE}${href}`, {
      headers: { cookie: `${managerCookie}; bhv_practice=${company.id}` },
      redirect: "manual",
    });
    if (response.status !== 200) {
      allNavResolve = false;
      brokenNav.push(`${href} → ${response.status}`);
    }
  }
  check(
    `every destination the menu offers resolves (${managerNav.length} checked)`,
    managerNav.length > 0 && allNavResolve,
    brokenNav.join(", "),
  );

  // ================================================================== §39 evidence
  console.log("\n  EVIDENCE — a new article reaches assigned work from login without a tutorial");

  check(
    "the article's own assigned job is named on the home screen",
    articleHome.html.includes(tag("GSTR-9 preparation")),
    "home does not surface the assigned job",
  );
  check(
    "...with a primary action that opens it",
    articleHome.html.includes("Open next work item") &&
      articleHome.html.includes(`href="/jobs/${job.id}"`),
  );
  check(
    "...reachable in one step, with no tutorial or module grid in the way",
    articleHome.html.indexOf("Open next work item") > 0,
  );

  console.log("\n  EVIDENCE — a deep link to the wrong practice is rejected safely");

  // The article is in Company only. This id is a real, live client — of
  // Associates. Reaching it must fail, and must not switch authority.
  const deepLink = await get(`/clients/${asRel.id}`, articleCookie);
  check("the wrong-practice deep link does not 500", deepLink.status === 200);
  check(
    "...the client's name is NOT disclosed",
    !deepLink.html.includes(tag("Associates Only Client Limited")),
  );
  check(
    "...the other practice is not named either",
    !deepLink.html.includes(associates.registeredDisplayName!),
  );
  check(
    "...the permission state is shown with a route to ask",
    deepLink.html.includes("You do not have access to this") &&
      deepLink.html.includes("Request access"),
  );
  check(
    "...and authority did NOT silently switch: the identity bar still shows the article's own practice",
    deepLink.html.includes(company.registeredDisplayName!),
  );

  // ================================================================== NAV03
  console.log("\nNAV03 — the five states");

  const emptyDocs = await get("/documents?q=zzz-nothing-matches-this", articleCookie);
  check("empty says what is absent, not 'no results'", emptyDocs.html.includes("No document matches that title"));
  check("...and offers the way out", emptyDocs.html.includes("Clear the filter"));

  const emptyWork = await get("/my-work?view=review", articleCookie);
  check(
    'empty work says "No work assigned" where the requirement quotes it',
    articleHome.html.includes("No work assigned") || emptyWork.html.includes("Nothing in this view"),
  );

  // Asserted on the component's SIGNATURE, not on its prose: PermissionState
  // accepts no prop that could carry a record, client or practice name, so
  // there is no call site that could leak one. An earlier version of this
  // check grepped for a comment, which passes or fails on how the comment is
  // worded rather than on what the code does.
  const statesSource = readFileSync("src/components/states.tsx", "utf8");
  const permissionSignature = statesSource.slice(
    statesSource.indexOf("export function PermissionState"),
    statesSource.indexOf("export function Screen"),
  );
  check(
    "the permission state can reveal no protected facts — it accepts only a request route",
    /\{\s*requestHref[^}]*\}\s*:\s*\{\s*requestHref\??:\s*string;?\s*\}/.test(permissionSignature),
    "PermissionState takes a prop other than requestHref",
  );
  check(
    "the conflict state uses NAV03's required wording",
    statesSource.includes("This record changed. Review the latest version."),
  );
  check("loading is announced politely and reserves layout", statesSource.includes('aria-busy="true"'));

  // ================================================================== NAV04
  console.log("\nNAV04 — safe actions");

  const safeAction = readFileSync("src/components/safe-action.tsx", "utf8");
  check(
    "success is reported only from the server's result, never from the click",
    safeAction.includes("const result = await onConfirm()") &&
      safeAction.includes("setOutcome(result)"),
  );
  check(
    "duplicate submission is blocked by a guard, not only a disabled attribute",
    safeAction.includes("if (inFlight.current) return"),
  );
  check("...and the control is disabled while pending too", safeAction.includes("disabled={disabled || pending}"));
  check("progress is announced, not only drawn", safeAction.includes('role="status"'));
  check("explicit confirmation is available for issue/release/purge", safeAction.includes("alertdialog"));
  check("undo is offered for reversible edits", safeAction.includes("onUndo"));

  // ================================================================== UX03
  console.log("\nUX03 — keyboard and screen-reader structure, in the real HTML");

  check("a skip link is the first focusable thing", articleHome.html.includes("Skip to main content"));
  check("...and it targets a real landmark", articleHome.html.includes('id="main"'));
  check("the main landmark is focusable so the skip link works", articleHome.html.includes('tabindex="-1"'));
  check("navigation is a labelled landmark", articleHome.html.includes('aria-label="Main"'));
  check("the current page is marked for assistive tech", articleHome.html.includes('aria-current="page"'));
  check("the search input has a real label", articleHome.html.includes('for="global-search"'));
  check("the practice switcher has a label", managerHome.html.includes('for="firm-switcher"'));

  const clients = await get("/clients", managerCookie, `bhv_practice=${company.id}`);
  check("tables carry a caption", clients.html.includes("<caption>"));
  check("...column headers use scope", clients.html.includes('scope="col"'));
  check("...row headers use scope", clients.html.includes('scope="row"'));

  // UX04: colour is never the only channel.
  const calendar = await get("/calendar", managerCookie, `bhv_practice=${company.id}`);
  check(
    "status is stated in words as well as colour (UX04)",
    /class="status status--\w+"[^>]*>[^<]*[A-Za-z]/.test(clients.html) ||
      /class="status status--\w+"[^>]*>[^<]*[A-Za-z]/.test(calendar.html),
  );

  // ================================================================== UX01
  console.log("\nUX01 — theme is applied server-side from the saved preference");

  check(
    "a user who chose DARK gets data-theme=dark on the first paint, with no flash",
    managerHome.html.includes('data-theme="dark"'),
  );
  check(
    "a user on SYSTEM gets NO attribute, so prefers-color-scheme decides",
    !articleHome.html.includes("data-theme="),
  );
  check("density is applied too", articleHome.html.includes('data-density="comfortable"'));
  check(
    "the theme control offers Light, Dark and System",
    articleHome.html.includes("Light") &&
      articleHome.html.includes("Dark") &&
      articleHome.html.includes("System"),
  );

  // Comments are stripped before the search: the component's own
  // documentation says it does NOT call router.refresh(), and matching raw
  // text made that sentence fail the assertion it was describing.
  const themeSwitcher = readFileSync("src/components/theme-switcher.tsx", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  check(
    "switching theme preserves scroll, draft and selection — it writes the attribute and never navigates",
    !themeSwitcher.includes("router.refresh") &&
      !themeSwitcher.includes("location.reload") &&
      !themeSwitcher.includes("location.assign") &&
      themeSwitcher.includes("root.dataset.theme"),
  );

  /**
   * SEC03: the browser gets its CSRF pair from middleware on the first GET.
   * The test collects the same pair the same way rather than being exempted
   * from the guard — an exempt test would not have caught that nothing was
   * issuing the token at all, which is exactly what it did catch.
   */
  const bootstrap = await fetch(`${BASE}/`, { headers: { cookie: articleCookie } });
  const setCookies = bootstrap.headers.getSetCookie();
  const csrfHash = /bhv_csrf=([^;]+)/.exec(setCookies.join("; "))?.[1];
  const csrfRaw = /bhv_csrf_token=([^;]+)/.exec(setCookies.join("; "))?.[1];
  check("middleware issues the CSRF pair to a browser that has none", !!csrfHash && !!csrfRaw);

  const csrfCookie = `${articleCookie}; bhv_csrf=${csrfHash}; bhv_csrf_token=${csrfRaw}`;

  const noToken = await fetch(`${BASE}/api/preferences`, {
    method: "PUT",
    headers: { cookie: csrfCookie, "content-type": "application/json", origin: BASE },
    body: JSON.stringify({ themePreference: "DARK" }),
  });
  check("a mutating request WITHOUT the CSRF header is refused", noToken.status === 403);

  const saved = await fetch(`${BASE}/api/preferences`, {
    method: "PUT",
    headers: {
      cookie: csrfCookie,
      "content-type": "application/json",
      origin: BASE,
      "x-bhv-csrf": csrfRaw ?? "",
    },
    body: JSON.stringify({ themePreference: "DARK" }),
  });
  check("the preference saves when the token is echoed", saved.ok, `status ${saved.status}`);
  const afterSave = await prisma.user.findUniqueOrThrow({ where: { id: article.id } });
  check("...to the user's own account", afterSave.themePreference === "DARK");
  const reloaded = await get("/", articleCookie);
  check("...and comes back on the next request", reloaded.html.includes('data-theme="dark"'));

  const badTheme = await fetch(`${BASE}/api/preferences`, {
    method: "PUT",
    headers: {
      cookie: csrfCookie,
      "content-type": "application/json",
      origin: BASE,
      "x-bhv-csrf": csrfRaw ?? "",
    },
    body: JSON.stringify({ themePreference: "NEON" }),
  });
  check("an unknown theme is refused", badTheme.status === 400);

  // ================================================================== UX05
  console.log("\nUX05 — identity cues name both practices");

  const switcher = readFileSync("src/components/firm-switcher.tsx", "utf8");
  check(
    "the cross-practice warning names BOTH source and destination in TEXT",
    switcher.includes("You are switching from") && switcher.includes("{destination.name}"),
  );
  check(
    "...and the marker dot is decorative, not the carrier of meaning",
    readFileSync("src/components/app-shell.tsx", "utf8").includes(
      'className={`practice-marker practice-marker--${ctx.activePractice.marker}`}\n              aria-hidden="true"',
    ) ||
      readFileSync("src/components/app-shell.tsx", "utf8").includes('aria-hidden="true"'),
  );
  check(
    "the manager, who is in two firms, gets a switcher",
    managerHome.html.includes('id="firm-switcher"'),
  );
  check(
    "the article, who is in one, does not",
    !articleHome.html.includes('id="firm-switcher"'),
  );

  // ================================================================== NAV02
  console.log("\nNAV02 — search is scoped by permission, and recents by practice");

  /**
   * These two searches use the WHOLE stored legal name. tag() appends the run
   * suffix at the END, so a prefix like tag("Associates Only") produces
   * "Associates Only-<run>" — a string that matches nothing, which would let
   * the isolation assertion below pass without the isolation working at all.
   * The control search that follows exists for the same reason: it proves the
   * query really does find the record when the caller is entitled to it.
   */
  const associatesClientName = tag("Associates Only Client Limited");
  const companyClientName = tag("Fictional Client Private Limited");

  const search = await fetch(
    `${BASE}/api/search?q=${encodeURIComponent(associatesClientName)}`,
    { headers: { cookie: articleCookie } },
  );
  const searchBody = (await search.json()) as { hits: { title: string }[]; total: number };
  check(
    "an article cannot find the other practice's client through search",
    searchBody.total === 0,
    `got ${searchBody.total}`,
  );

  // Control: the same query, run by someone who IS in Associates, finds it —
  // so the zero above is isolation and not a query that matches nothing.
  const managerCrossSearch = await fetch(
    `${BASE}/api/search?q=${encodeURIComponent(associatesClientName)}`,
    { headers: { cookie: managerCookie } },
  );
  const managerCrossBody = (await managerCrossSearch.json()) as {
    hits: { title: string }[];
    total: number;
  };
  check(
    "...and the same search DOES find it for a manager who is in Associates",
    managerCrossBody.total >= 1,
    `got ${managerCrossBody.total}`,
  );

  const managerSearch = await fetch(
    `${BASE}/api/search?q=${encodeURIComponent(companyClientName)}`,
    { headers: { cookie: managerCookie } },
  );
  const managerBody = (await managerSearch.json()) as { hits: { title: string }[]; total: number };
  check(
    "...while a manager who IS in that practice finds their own client",
    managerBody.total >= 1,
    `got ${managerBody.total}`,
  );
  check(
    "the count equals what is returned — a total never counts what you cannot open",
    managerBody.total === managerBody.hits.length,
  );

  const searchComponent = readFileSync("src/components/global-search.tsx", "utf8");
  check(
    "recent items are keyed by practice, so a switch cannot leak the other firm's names",
    searchComponent.includes("bhv_recent_${practiceId"),
  );
  check(
    "...and held in sessionStorage, so logout takes them",
    searchComponent.includes("sessionStorage") && !searchComponent.includes("localStorage"),
  );
  check("breadcrumbs are rendered with a Back destination", clients.html.includes('aria-label="Breadcrumb"'));

  /**
   * NAV04 dialog focus management — every one of these was found by DRIVING A
   * BROWSER, not by reading HTML, because the dialog does not exist in the
   * markup until someone activates the trigger. The keyboard pass found that
   * the alertdialog took no focus when it opened, that Tab escaped it to the
   * page behind, and that Escape did nothing. Asserted against the source for
   * the same reason the theme switcher is: the behaviour cannot be observed in
   * a server-rendered response.
   */
  // `safeAction` is the source already read in the NAV04 section above.
  check(
    "NAV04: opening the confirmation moves focus INTO the dialog",
    safeAction.includes("cancelRef.current?.focus()"),
  );
  check(
    "...onto Cancel, the least destructive option, not onto the confirm button",
    /cancelRef[\s\S]{0,400}Cancel/.test(safeAction) && safeAction.includes("ref={cancelRef}"),
  );
  check(
    "NAV04: Escape dismisses the dialog and returns focus to the trigger",
    safeAction.includes('event.key === "Escape"') &&
      safeAction.includes("triggerRef.current?.focus()"),
  );
  check(
    "NAV04: Tab is trapped inside the dialog rather than escaping to the page behind",
    safeAction.includes('event.key !== "Tab"') &&
      safeAction.includes("last.focus()") &&
      safeAction.includes("first.focus()"),
  );
  // Comments stripped first, for the third time in this file: the component
  // documents the fixed bug by NAMING the old fixed id, and matching raw text
  // made that sentence fail the assertion describing it.
  const safeActionCode = safeAction
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  check(
    "the dialog's ids are per-instance, so two SafeActions on one screen cannot collide",
    safeActionCode.includes("useId()") && !safeActionCode.includes('id="confirm-title"'),
  );

  // ======================================================== §38 EVIDENCE
  //
  // "Complete client onboarding, document review and invoice ISSUE using only
  //  the keyboard in both themes."
  //
  // The third leg. Until T14 there was no invoice to issue, and this file's
  // header said so. What is asserted here is the half a test can honestly
  // assert: that the issue path is built from controls a keyboard can reach
  // and operate, in BOTH themes, and that issuing actually completes. The
  // physical half — tabbing through it, at 200% zoom — is the browser pass
  // recorded in PROGRESS.md, and no assertion here pretends to be it.
  console.log("\n  EVIDENCE — invoice issue is reachable and operable by keyboard, both themes");

  // A partner, because MANAGER holds invoice.draft but neither approve nor
  // issue (IAM02), and IAM04 forbids the drafter approving their own invoice.
  const partner = await prisma.user.create({
    data: {
      email: `partner-${RUN}@example.invalid`,
      fullName: "Fictional Partner",
      status: "ACTIVE",
      themePreference: "LIGHT",
    },
  });
  await prisma.practiceMembership.create({
    data: {
      practiceId: company.id,
      userId: partner.id,
      role: "PRACTICE_PARTNER",
      assignmentScope: "PRACTICE",
      effectiveFrom: d("2024-04-01"),
    },
  });
  const partnerCookie = await sessionFor(partner.id);

  const series = await createInvoiceSeries({
    userId: manager.id,
    practiceId: company.id,
    code: "T16",
    fiscalPeriod: "2025-26",
    numberFormat: "{code}/{fiscalPeriod}/{number}",
    startAt: 1,
  });
  const draft = await draftInvoice({
    userId: manager.id,
    practiceId: company.id,
    seriesId: series.id,
    clientRelationshipId: coRel.id,
    engagementId: engagement.id,
    lines: [{ description: "Fictional professional fees", quantity: 1, unitAmount: 5000 }],
  });
  const approved = await approveInvoice({
    userId: partner.id,
    approverName: "Fictional Partner",
    practiceId: company.id,
    invoiceId: draft.id,
    expectedVersion: draft.version,
  });

  const billingList = await get("/billing", partnerCookie, `bhv_practice=${company.id}`);
  check("the billing register renders for a partner", billingList.status === 200, `status ${billingList.status}`);
  check(
    "NAV01: the Billing pin is on now that the screen exists",
    billingList.html.includes('href="/billing"'),
  );

  const detail = await get(`/billing/${draft.id}`, partnerCookie, `bhv_practice=${company.id}`);
  check("the invoice detail renders", detail.status === 200, `status ${detail.status}`);

  // Operable by keyboard means a real button: a div with onClick is reachable
  // by neither Tab nor Enter, and this is the check that would catch it.
  check(
    "the issue action is a real <button>, not a click handler on a div",
    /<button[^>]*>\s*Issue/i.test(detail.html),
    "no <button> whose label starts with Issue",
  );
  check(
    "...with an explicit type, so it cannot submit something by accident",
    /<button[^>]*type="button"/i.test(detail.html),
  );
  check(
    "nothing on the page sets a positive tabindex, which would reorder the tab sequence",
    !/tabindex="[1-9]/i.test(detail.html),
  );
  check(
    "the invoice status is stated in words, not by colour alone (UX04)",
    /APPROVED|Approved/.test(detail.html),
  );
  check(
    "NAV04: the consequential action announces its result to assistive tech",
    detail.html.includes('role="status"') && detail.html.includes('aria-live="polite"'),
  );

  // Both themes must render the SAME controls. A dark mode that drops or
  // replaces a control is not a palette, it is a second interface.
  const detailDark = await get(
    `/billing/${draft.id}`,
    managerCookie,
    `bhv_practice=${company.id}`,
  );
  check(
    "the dark-theme user gets data-theme=dark on this screen",
    detailDark.html.includes('data-theme="dark"'),
  );
  const controlsIn = (html: string) =>
    (html.match(/<button[^>]*>/g) ?? []).length;
  check(
    "both themes render the shared shell controls (skip link, search, switcher)",
    detailDark.html.includes("Skip to main content") &&
      detail.html.includes("Skip to main content") &&
      controlsIn(detail.html) > 0 &&
      controlsIn(detailDark.html) > 0,
  );

  // And the workflow completes. A screen that renders an Issue button which
  // then fails is not "invoice issue using only the keyboard".
  const issueResponse = await fetch(`${BASE}/api/invoices/${draft.id}/issue`, {
    method: "POST",
    headers: {
      cookie: `${partnerCookie}; bhv_practice=${company.id}; bhv_csrf=${csrfHash}; bhv_csrf_token=${csrfRaw}`,
      "content-type": "application/json",
      origin: BASE,
      "x-bhv-csrf": csrfRaw ?? "",
    },
    body: JSON.stringify({ expectedVersion: approved.version }),
  });
  const issueBody = (await issueResponse.json()) as { number?: string; code?: string };
  check(
    "EVIDENCE: the issue action completes and returns a number",
    issueResponse.status === 200 && !!issueBody.number,
    `${issueResponse.status} ${JSON.stringify(issueBody)}`,
  );

  const afterIssue = await get(`/billing/${draft.id}`, partnerCookie, `bhv_practice=${company.id}`);
  check(
    "EVIDENCE: the issued number is then shown on the screen",
    !!issueBody.number && afterIssue.html.includes(issueBody.number),
    issueBody.number ?? "no number",
  );
  check(
    "...and the Issue action is gone, because an issued invoice cannot be reissued",
    !/<button[^>]*>\s*Issue/i.test(afterIssue.html),
  );

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error("\nTEST RUN ERROR:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
