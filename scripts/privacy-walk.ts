/**
 * T19.7 HTTP walk — the /privacy screen and the privacy/incident routes, over
 * real HTTP against `npm run dev`.
 *
 * Uses the fixture users from the MOST RECENT `npm run test:t19` run, so run
 * that first. Drives the dev actor header, which is refused in production.
 * Local development only.
 *
 * Run: npm run privacy:walk
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma";

if (process.env.NODE_ENV === "production") {
  throw new Error("privacy-walk is a local development check and must not run in production.");
}

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";
let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`);
  if (ok) pass++;
  else fail++;
};

async function csrfPair(): Promise<{ cookie: string; token: string }> {
  const res = await fetch(`${BASE}/login`, { redirect: "manual" });
  const cookies = res.headers.getSetCookie();
  const hash = cookies.find((c) => c.startsWith("bhv_csrf="))!.split(";")[0];
  const raw = cookies.find((c) => c.startsWith("bhv_csrf_token="))!.split(";")[0];
  return { cookie: `${hash}; ${raw}`, token: decodeURIComponent(raw.split("=")[1]) };
}

async function main() {
  const admin = await prisma.user.findFirstOrThrow({
    where: { email: { startsWith: "ItAdmin-" } },
    orderBy: { createdAt: "desc" },
  });
  const run = admin.email.split("-")[1].split("@")[0];
  const user = (p: string) => prisma.user.findUniqueOrThrow({ where: { email: `${p}-${run}@example.invalid` } });
  const partner = await user("Partner");
  const partner2 = await user("SecondPartner");
  const article = await user("Article");
  const outsider = await user("Outsider");
  const company = await prisma.practiceMembership.findFirstOrThrow({
    where: { userId: article.id },
    select: { practiceId: true },
  });
  const practiceId = company.practiceId;
  const csrf = await csrfPair();
  const as = (userId: string, practice?: string) => ({
    "x-bhv-user-id": userId,
    cookie: `${csrf.cookie}${practice ? `; bhv_practice=${practice}` : ""}`,
    "x-bhv-csrf": csrf.token,
    origin: BASE,
    "content-type": "application/json",
  });
  const get = async (path: string, userId: string, practice?: string) => {
    const r = await fetch(`${BASE}${path}`, { headers: as(userId, practice) });
    return { status: r.status, text: await r.text() };
  };
  const post = async (path: string, userId: string, body: unknown, withCsrf = true) => {
    const headers: Record<string, string> = as(userId);
    if (!withCsrf) delete headers["x-bhv-csrf"];
    const r = await fetch(`${BASE}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };

  console.log("screen");
  const pv = await get("/privacy", partner.id, practiceId);
  check("partner: /privacy renders 200", pv.status === 200, String(pv.status));
  check("partner: sees the awareness time on the incident", pv.text.includes("Aware since"));
  check("partner: sees the CERT-In clock and DPDP rows", pv.text.includes("CERT-In — report within 6 h") && pv.text.includes("DPDP — detailed information to the Board"));
  check("partner: root cause shown as not affecting any clock", pv.text.includes("does not affect any clock"));
  check("partner: sees erasure requests with their decisions", pv.text.includes("Erasure requests") && pv.text.includes("Preserved under the legal hold"));
  check("partner: sees retention, processing and regulatory registers", pv.text.includes("Retention schedules") && pv.text.includes("Processing register") && pv.text.includes("Regulatory register"));
  const av = await get("/privacy", article.id, practiceId);
  check("article: /privacy renders 200 with the report form", av.status === 200 && av.text.includes("Report a suspected incident"));
  check("article: sees no incident record, register or erasure request", !av.text.includes("Aware since") && !av.text.includes("Erasure requests") && !av.text.includes("Processing register"));
  const ov = await get("/privacy", outsider.id);
  check("outsider: never sees the other practice's incident", ov.status === 200 && !ov.text.includes("Suspicious sign-in"));

  console.log("\nroutes");
  const list = await get(`/api/incidents?practiceId=${practiceId}`, partner.id);
  check("partner: incident list returns clocks", list.status === 200 && list.text.includes("CERT_IN_6H"));
  check("article: incident list refused 403 (member without incident.manage)", (await get(`/api/incidents?practiceId=${practiceId}`, article.id)).status === 403);
  check("outsider: incident list refused 404 (no standing)", (await get(`/api/incidents?practiceId=${practiceId}`, outsider.id)).status === 404);

  const noCsrf = await post("/api/incidents", article.id, { practiceId, track: "SECURITY", title: "x", summary: "x", awarenessAt: new Date().toISOString() }, false);
  check("reporting without the CSRF header is refused", noCsrf.status === 403, String(noCsrf.status));
  const reported = await post("/api/incidents", article.id, {
    practiceId, track: "SECURITY", title: "Walk: unknown USB device (fictional)", summary: "Found plugged in", awarenessAt: new Date(Date.now() - 30 * 60_000).toISOString(),
  });
  check("article: reports an incident over HTTP (201)", reported.status === 201, JSON.stringify(reported.body));
  const later = await post(`/api/incidents/${reported.body.id}`, partner.id, {
    action: "awareness", expectedVersion: 1, awarenessAt: new Date().toISOString(), reason: "later",
  });
  check("moving awareness later is refused with its code", later.status === 409 && later.body.code === "AWARENESS_ONLY_EARLIER", JSON.stringify(later.body));
  const stale = await post(`/api/incidents/${reported.body.id}`, partner.id, {
    action: "root-cause", expectedVersion: 99, rootCause: "INVESTIGATING",
  });
  check("a stale version is a 409 VERSION_CONFLICT with a comparison", stale.status === 409 && stale.body.code === "VERSION_CONFLICT" && !!stale.body.conflict);

  const consent = await post("/api/privacy/register", partner.id, {
    practiceId, name: `Walk ${run}`, purpose: "x", dataCategories: ["x"], source: "x", accessRoles: ["MANAGER"],
    recipients: [], hostingLocation: "UNCONFIRMED", retentionClass: "X", legalBasis: "CONSENT", legalAuthority: "x", ownerName: "x",
  });
  check("consent without a notice is refused over HTTP with its code", consent.status === 400 && consent.body.code === "CONSENT_NEEDS_NOTICE", JSON.stringify(consent.body));

  const pending = await prisma.erasureRequest.findFirst({
    where: { practiceId, state: "REQUESTED", requestedByUserId: partner.id },
    include: { items: true },
  });
  if (pending) {
    const self = await post(`/api/privacy/erasure/${pending.id}`, partner.id, {
      action: "review", expectedVersion: pending.version,
      decisions: pending.items.map((i) => ({ itemId: i.id, decision: "RETAIN", reason: "x" })),
    });
    check("the logger cannot review their own erasure request over HTTP", self.status === 403 && self.body.code === "SELF_REVIEW_REFUSED", JSON.stringify(self.body));
    const eraseHeld = await post(`/api/privacy/erasure/${pending.id}`, partner2.id, {
      action: "review", expectedVersion: pending.version,
      decisions: pending.items.map((i) => ({ itemId: i.id, decision: "ERASE", reason: "x" })),
    });
    check("erasing a must-retain item is refused over HTTP (409 MUST_RETAIN)", eraseHeld.status === 409 && eraseHeld.body.code === "MUST_RETAIN", JSON.stringify(eraseHeld.body));
  } else {
    check("fixture: a pending erasure request exists", false, "run npm run test:t19 first");
  }

  const decision = await get(`/api/privacy/retention?practiceId=${practiceId}&recordClass=CLIENT_RECORDS&triggerDate=2026-04-01`, partner.id);
  check("the retention decision reports the floor/ceiling conflict", decision.status === 200 && decision.text.includes("the longer duty wins"));
  check("an article cannot read retention schedules (403)", (await get(`/api/privacy/retention?practiceId=${practiceId}`, article.id)).status === 403);

  console.log(`\n${pass} passed, ${fail} failed`);
  await prisma.$disconnect();
  process.exit(fail ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
