/**
 * Dev-only smoke walk: signs the seeded dev user in through the REAL login
 * flow (password → TOTP → session cookie, CSRF pair collected the way a
 * browser collects it) and then requests every route the interface links to,
 * reporting the status of each.
 *
 * The point is the dangling-destination check in TASKS.md T16.7: a menu item,
 * search result or list row that leads to a 404 is a broken screen, and only
 * fetching each one proves otherwise.
 *
 * Run: npm run dev:walk   (needs `npm run dev` and docker compose up)
 */

import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { decryptSecret, totpCode } from "../src/lib/crypto";

if (process.env.NODE_ENV === "production") {
  throw new Error("dev-walk-ui is a local development helper and must not run in production.");
}

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const EMAIL = process.env.SEED_EMAIL ?? "dev.owner@example.invalid";
const PASSWORD = process.env.SEED_PASSWORD ?? "Dev-Local-Test-Passphrase-9";

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

async function get(path: string): Promise<Response> {
  const response = await fetch(`${BASE}${path}`, {
    headers: { cookie: cookieHeader() },
    redirect: "manual",
  });
  absorb(response);
  return response;
}

async function postJson(path: string, body: unknown): Promise<Response> {
  const response = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      cookie: cookieHeader(),
      "content-type": "application/json",
      "x-bhv-csrf": jar.get("bhv_csrf_token") ?? "",
      origin: BASE,
    },
    body: JSON.stringify(body),
    redirect: "manual",
  });
  absorb(response);
  return response;
}

async function currentTotp(userId: string): Promise<string> {
  const enrolment = await prisma.mfaEnrolment.findFirst({
    where: { userId, confirmedAt: { not: null }, revokedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (!enrolment) throw new Error("No confirmed MFA enrolment for the dev user.");
  return totpCode(
    decryptSecret({
      ciphertext: enrolment.secretCiphertext,
      iv: enrolment.secretIv,
      authTag: enrolment.secretAuthTag,
    }),
  );
}

async function main() {
  const user = await prisma.user.findUnique({ where: { email: EMAIL } });
  if (!user) throw new Error(`No user ${EMAIL}. Run: npm run seed:dev-user`);

  // Visiting the login page first is what mints the CSRF pair in middleware.
  await get("/login");

  const loginResponse = await postJson("/api/auth/login", { email: EMAIL, password: PASSWORD });
  const loginBody = (await loginResponse.json()) as { challenge?: string; error?: string };
  if (!loginResponse.ok) throw new Error(`Login refused: ${loginBody.error}`);

  const mfaResponse = await postJson("/api/auth/mfa/verify", {
    challenge: loginBody.challenge,
    code: await currentTotp(user.id),
  });
  if (!mfaResponse.ok) {
    throw new Error(`MFA refused: ${JSON.stringify(await mfaResponse.json())}`);
  }
  console.log(`\nSigned in as ${EMAIL}\n`);

  // Every destination the shell, search results or list rows can reach. The
  // id-bearing ones are resolved from real rows so they are not straw URLs.
  const memberships = await prisma.practiceMembership.findMany({
    where: { userId: user.id, revokedAt: null },
    select: { practiceId: true },
  });
  const practiceIds = memberships.map((m) => m.practiceId);

  // Pick the practice that actually holds records, not simply the first one —
  // otherwise the id-bearing routes report SKIP and the walk proves nothing
  // about them.
  const withClients = await prisma.clientRelationship.findFirst({
    where: { practiceId: { in: practiceIds }, archivedAt: null },
    select: { practiceId: true },
  });
  const practiceId = withClients?.practiceId ?? practiceIds[0];

  // The shell reads the active practice from this cookie, so the id-bearing
  // routes are requested under the same scope the ids belong to.
  if (practiceId) jar.set("bhv_practice", practiceId);

  const clientRel = practiceId
    ? await prisma.clientRelationship.findFirst({ where: { practiceId }, select: { id: true } })
    : null;
  const job = practiceId
    ? await prisma.job.findFirst({ where: { practiceId }, select: { id: true } })
    : null;
  // An ordinary document, not a protected working paper: a working paper is
  // SUPPOSED to come back as a permission state, which would look like a
  // rendered screen in this walk and prove nothing about the real one. It is
  // checked separately below.
  const document = practiceId
    ? await prisma.document.findFirst({
        where: { practiceId, archivedAt: null, workingPaper: false },
        select: { id: true },
      })
    : null;
  const workingPaper = practiceId
    ? await prisma.document.findFirst({
        where: { practiceId, archivedAt: null, workingPaper: true },
        select: { id: true },
      })
    : null;
  const obligation = practiceId
    ? await prisma.obligation.findFirst({ where: { practiceId }, select: { id: true } })
    : null;
  const invoice = practiceId
    ? await prisma.invoice.findFirst({ where: { practiceId }, select: { id: true } })
    : null;

  const routes: [string, string][] = [
    ["/", "Home"],
    ["/my-work", "My work"],
    ["/clients", "Clients"],
    ["/documents", "Documents"],
    ["/calendar", "Calendar"],
    ["/review", "Review queue"],
    ["/practice", "Practice"],
    ["/team", "Team"],
    ["/continuity", "Continuity"],
    ["/privacy", "Privacy and incidents"],
    ["/connectors", "Connectors"],
    [clientRel ? `/clients/${clientRel.id}` : "", "Client workspace"],
    [job ? `/jobs/${job.id}` : "", "Job detail"],
    [document ? `/documents/${document.id}` : "", "Document detail"],
    [obligation ? `/obligations/${obligation.id}` : "", "Obligation detail"],
    ["/billing", "Billing"],
    [invoice ? `/billing/${invoice.id}` : "", "Invoice detail"],
    ["/reports", "Reports"],
    ["/reports/on-time-filing-rate", "Report — on time filing"],
    ["/reports/receivables-ageing", "Report — receivables ageing"],
    // A report id that does not exist must render the empty state, not a 500.
    ["/reports/not-a-real-report", "Report — unknown id"],
  ];

  /**
   * Destinations that deliberately do not exist yet. They are NOT in the menu
   * (ux.ts marks them built:false), so a user cannot reach them — they are
   * listed here so the gap stays visible rather than being forgotten.
   *
   * Empty since T17 turned the Reports pin on. Leave the block: the next
   * withheld destination goes here rather than being remembered.
   */
  const notBuiltYet: [string, string][] = [];

  let broken = 0;
  for (const [path, label] of routes) {
    if (!path) {
      console.log(`  SKIP  ${label.padEnd(30)} no fixture row in this database`);
      continue;
    }
    const response = await get(path);
    const ok = response.status === 200;
    if (!ok) broken++;
    // The heading, because a 200 that rendered an error boundary or a bare
    // permission state is not the same as a working screen, and the status
    // code cannot tell them apart.
    const heading = ok ? (/<h1[^>]*>([^<]{0,60})/.exec(await response.text())?.[1] ?? "") : "";
    console.log(
      `  ${ok ? "OK  " : "FAIL"}  ${label.padEnd(20)} ${response.status}  ${path.padEnd(48)} ${heading}`,
    );
  }

  if (workingPaper) {
    const response = await get(`/documents/${workingPaper.id}`);
    const html = await response.text();
    const refused = html.includes("You do not have access to this");
    console.log(
      `\nProtected working paper (DOC03 needs its own grant): ${
        refused ? "refused, and the record is not named" : "REACHABLE — check the grant"
      }`,
    );
  }

  // INT01 (T20): "Connectors" is also the h1 of the permission and error
  // states, so the heading above cannot tell a working screen from a refusal.
  // Check for content only the working screen renders.
  {
    const html = await (await get("/connectors")).text();
    const working =
      html.includes("Configured connectors") &&
      html.includes("Add a connector") &&
      !html.includes("could not be loaded") &&
      !html.includes("You do not have access to this");
    if (!working) broken++;
    console.log(
      `\nConnectors screen (INT01): ${working ? "list and create form rendered" : "NOT WORKING — permission or error state rendered"}`,
    );
  }

  console.log("\nNot built yet, and not linked from anywhere:");
  for (const [path, label] of notBuiltYet) {
    const response = await get(path);
    // A 200 here would mean the page exists and the pin should be turned back
    // on in ux.ts — so this line is a reminder in both directions.
    console.log(`  ${response.status === 200 ? "NOW EXISTS" : "absent   "}  ${label}  ${path}`);
  }

  console.log(
    broken === 0
      ? "\nEvery linked destination resolves.\n"
      : `\n${broken} linked destination(s) do not resolve.\n`,
  );
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
