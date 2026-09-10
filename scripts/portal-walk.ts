/**
 * Dev-only portal smoke walk (TASKS.md T13.9).
 *
 * `npm run dev:walk` cannot cover the portal: it signs in as STAFF, and PRD §17
 * makes the portal a separate authentication world on purpose. So this is its
 * portal twin — it seeds a fictional contact, redeems a real invitation through
 * the real POST route, and then fetches every portal screen with the resulting
 * session cookie, reporting the status of each.
 *
 * Why this exists at all: every T13 assertion is library-level. A page that
 * 404s, or throws while rendering, passes all of them. Only fetching the screen
 * proves the screen exists.
 *
 * It also fills the gap noted in PROGRESS.md — `scripts/seed-demo-data.ts`
 * creates contacts but no ContactAuthority grants and no PortalInvitation, so
 * before this there was no way to reach the portal by hand either. The sign-in
 * link it prints is a working one; use it to click through the portal in a
 * browser.
 *
 * All fixture data is fictional. Run: npm run portal:walk
 *   (needs `npm run dev`, plus docker compose up -d db redis minio)
 */

import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { issuePortalInvitation } from "../src/lib/portal-auth";

if (process.env.NODE_ENV === "production") {
  throw new Error("portal-walk is a local development helper and must not run in production.");
}

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";

const RUN = Date.now();
const tag = (s: string) => `${s}-${RUN}`;
const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

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

/** Accumulates Set-Cookie the way a browser jar does, keyed by name. */
const jar = new Map<string, string>();

function absorb(response: Response) {
  for (const raw of response.headers.getSetCookie()) {
    const [pair] = raw.split(";");
    const eq = pair.indexOf("=");
    if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
}

function cookieHeader(): string {
  return [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
}

async function get(path: string): Promise<{ status: number; body: string }> {
  const response = await fetch(`${BASE}${path}`, {
    headers: { cookie: cookieHeader() },
    redirect: "manual",
  });
  absorb(response);
  return { status: response.status, body: await response.text() };
}

async function postJson(path: string, body: unknown): Promise<{ status: number; body: string }> {
  const response = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      cookie: cookieHeader(),
      "content-type": "application/json",
      // Same double-submit pair a browser sends; see src/lib/client-fetch.ts.
      "x-bhv-csrf": jar.get("bhv_csrf_token") ?? "",
      origin: BASE,
    },
    body: JSON.stringify(body),
    redirect: "manual",
  });
  absorb(response);
  return { status: response.status, body: await response.text() };
}

async function seed() {
  const tenant = await prisma.tenant.create({ data: { name: tag("BHV Portal Walk") } });

  const practice = await prisma.practice.create({
    data: {
      tenantId: tenant.id,
      name: tag("Fictional Associates"),
      registeredDisplayName: tag("Fictional Associates Registered"),
      constitution: "PARTNERSHIP",
      documentNamespace: `walk-${RUN}`.toLowerCase(),
      effectiveFrom: d("2024-04-01"),
    },
  });

  const partner = await prisma.user.create({
    data: {
      email: `walk-p-${RUN}@example.invalid`,
      fullName: "Fictional Partner",
      status: "ACTIVE",
    },
  });
  await prisma.practiceMembership.create({
    data: {
      practiceId: practice.id,
      userId: partner.id,
      role: "PRACTICE_PARTNER",
      assignmentScope: "PRACTICE",
      effectiveFrom: d("2024-04-01"),
    },
  });

  // Three companies, one CFO granted two of them — the same shape as the PRD
  // §17 evidence, so the rendered switcher can be checked against it.
  const parties = await Promise.all(
    ["Alpha", "Beta", "Gamma"].map((n) =>
      prisma.party.create({
        data: { tenantId: tenant.id, legalName: tag(`Fictional ${n} Private Limited`), type: "COMPANY" },
      }),
    ),
  );
  const [relA, relB, relC] = await Promise.all(
    parties.map((p) =>
      prisma.clientRelationship.create({
        data: { practiceId: practice.id, partyId: p.id, acceptanceStatus: "ACCEPTED" },
      }),
    ),
  );

  const cfo = await prisma.contact.create({
    data: {
      partyId: parties[0].id,
      fullName: "Fictional Group CFO",
      email: `walk-cfo-${RUN}@example.invalid`,
      emailVerificationStatus: "VERIFIED",
    },
  });

  const engagement = await prisma.engagement.create({
    data: {
      practiceId: practice.id,
      clientRelationshipId: relA.id,
      serviceCode: "GST_ANNUAL",
      templateVersion: "1",
      periodStart: d("2025-04-01"),
      periodEnd: d("2026-03-31"),
    },
  });

  const request = await prisma.clientRequest.create({
    data: {
      practiceId: practice.id,
      clientRelationshipId: relA.id,
      engagementId: engagement.id,
      title: "Documents for GST annual return",
      detail: "Please send the following for FY2025-26.",
      requestedItems: [],
      state: "SENT",
      sentAt: new Date(),
      dueDate: d("2099-01-31"),
    },
  });

  const item = await prisma.clientRequestItem.create({
    data: {
      practiceId: practice.id,
      requestId: request.id,
      sequence: 1,
      documentType: "Bank statement",
      description: "All accounts, full year.",
      periodLabel: "FY 2025-26",
      dueDate: d("2099-01-31"),
      ownerUserId: partner.id,
    },
  });

  // POR05 needs a verified route to show, and an unverified one to withhold.
  await prisma.practiceSupportContact.create({
    data: {
      practiceId: practice.id,
      label: "Unverified desk",
      phone: "+91 00000 00000",
      effectiveFrom: d("2024-04-01"),
    },
  });
  await prisma.practiceSupportContact.create({
    data: {
      practiceId: practice.id,
      label: "Client support",
      phone: "+91 11111 11111",
      email: `walk-support-${RUN}@example.invalid`,
      hoursLabel: "Mon-Fri, 10am-6pm IST",
      verifiedAt: new Date(),
      verifiedBy: "Fictional Partner",
      effectiveFrom: d("2024-04-01"),
    },
  });

  const invite = await issuePortalInvitation({
    practiceId: practice.id,
    contactId: cfo.id,
    grants: [
      { clientRelationshipId: relA.id, authority: "UPLOAD" },
      { clientRelationshipId: relB.id, authority: "UPLOAD" },
    ],
    invitedByUserId: partner.id,
    invitedByName: "Fictional Partner",
  });

  return {
    token: invite.token,
    itemId: item.id,
    entityA: tag("Fictional Alpha Private Limited"),
    entityB: tag("Fictional Beta Private Limited"),
    entityC: tag("Fictional Gamma Private Limited"),
    relCId: relC.id,
    practiceName: tag("Fictional Associates Registered"),
  };
}

async function main() {
  console.log("\nT13.9 — portal render walk (PRD §17 screens)\n");

  const health = await fetch(`${BASE}/api/health`).catch(() => null);
  if (!health) {
    throw new Error(`No dev server at ${BASE}. Run \`npm run dev\` first.`);
  }

  const fx = await seed();

  console.log("Sign-in screen (unauthenticated)");

  const signIn = await get(`/portal/sign-in/${fx.token}`);
  check("the sign-in screen renders", signIn.status === 200, `status ${signIn.status}`);
  check(
    "POR02: it names no client, contact or practice before redemption",
    !signIn.body.includes(fx.entityA) &&
      !signIn.body.includes(fx.practiceName) &&
      !signIn.body.includes("Fictional Group CFO"),
  );

  const helpAnon = await get("/portal/help");
  check("the recovery/help screen renders unauthenticated", helpAnon.status === 200, `status ${helpAnon.status}`);
  check(
    "POR05: help asks for the dead LINK, not an email address",
    !/type="email"/i.test(helpAnon.body),
  );

  const homeAnon = await get("/portal");
  check(
    "an unauthenticated visitor is turned away from the portal home",
    homeAnon.status !== 200 || !homeAnon.body.includes(fx.entityA),
    `status ${homeAnon.status}`,
  );

  console.log("\nRedemption");

  const accepted = await postJson("/api/portal/invitations/accept", { token: fx.token });
  check("redeeming the invitation succeeds", accepted.status === 200, accepted.body.slice(0, 200));
  check("a portal session cookie is set", jar.has("bhv_portal_session"));
  check(
    "the staff session cookie is NOT set by portal sign-in",
    !jar.has("bhv_session"),
  );

  console.log("\nAuthenticated screens");

  const home = await get("/portal");
  check("the portal home renders", home.status === 200, `status ${home.status}`);
  check("it shows the identified practice", home.body.includes(fx.practiceName));
  check("the switcher offers both approved entities", home.body.includes(fx.entityA) && home.body.includes(fx.entityB));
  check("EVIDENCE: the third entity appears nowhere on the rendered page", !home.body.includes(fx.entityC));
  check("the sent request item is shown", home.body.includes("Bank statement"));
  check(
    "POR01: no internal staff owner is rendered",
    !home.body.includes("Fictional Partner"),
  );

  const upload = await get(`/portal/upload/${fx.itemId}`);
  check("the guided upload screen renders", upload.status === 200, `status ${upload.status}`);
  check("it names the document asked for", upload.body.includes("Bank statement"));

  const help = await get("/portal/help");
  check("help renders for a signed-in contact", help.status === 200, `status ${help.status}`);
  check("POR05: the VERIFIED support route is shown", help.body.includes("Client support"));
  check("POR05: the unverified one is withheld", !help.body.includes("Unverified desk"));

  const api = await get("/api/portal/home");
  check("the portal home API answers for the session", api.status === 200, `status ${api.status}`);

  const denied = await get(`/api/portal/home?entity=${fx.relCId}`);
  check(
    "naming the third entity over HTTP does not return it",
    denied.status === 404 || !denied.body.includes(fx.entityC),
    `status ${denied.status}`,
  );

  console.log("\nSign-out");

  const out = await postJson("/api/portal/logout", {});
  check("logout succeeds", out.status === 200, out.body.slice(0, 200));

  const afterOut = await get("/portal");
  check(
    "the home no longer renders client data after logout",
    afterOut.status !== 200 || !afterOut.body.includes(fx.entityA),
    `status ${afterOut.status}`,
  );

  console.log(`\n${passed} passed, ${failed} failed`);
  console.log(
    `\nTo click through by hand, sign in at:\n  ${BASE}/portal/sign-in/${fx.token}\n` +
      "(single use — re-run this script for a fresh link)\n",
  );

  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
