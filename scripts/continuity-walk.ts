/**
 * T18.7 HTTP walk — the /continuity screen and the continuity/recovery routes,
 * over real HTTP against `npm run dev`.
 *
 * Uses the fixture users from the MOST RECENT `npm run test:t18` run (it
 * creates an IT admin, partner, article and outsider), so run that first.
 * Drives the dev actor header, which is refused in production and has no
 * session — so it also proves step-up and export demand a REAL session. The
 * real-session step-up → export path was checked by hand on 2026-09-11 (see
 * PROGRESS.md). Local development only.
 *
 * Run: npm run continuity:walk
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma";

if (process.env.NODE_ENV === "production") {
  throw new Error("continuity-walk is a local development check and must not run in production.");
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
  const latest = async (prefix: string) =>
    prisma.user.findFirstOrThrow({ where: { email: { startsWith: `${prefix}-` } }, orderBy: { createdAt: "desc" } });
  const admin = await latest("ITAdmin");
  const run = admin.email.split("-")[1].split("@")[0];
  const partner = await prisma.user.findUniqueOrThrow({ where: { email: `Partner-${run}@example.invalid` } });
  const article = await prisma.user.findUniqueOrThrow({ where: { email: `Article-${run}@example.invalid` } });
  const company = await prisma.practiceMembership.findFirstOrThrow({ where: { userId: article.id }, select: { practiceId: true } });
  const as = (userId: string, extra: Record<string, string> = {}) => ({ "x-bhv-user-id": userId, ...extra });

  const page = async (path: string, userId: string) => {
    const r = await fetch(`${BASE}${path}`, { headers: as(userId) });
    return { status: r.status, html: await r.text() };
  };

  console.log("screens");
  const adminView = await page("/continuity", admin.id);
  check("admin: /continuity renders 200", adminView.status === 200, String(adminView.status));
  check("admin: sees the status board", adminView.html.includes("Service status"));
  check("admin: sees the recovery panel", adminView.html.includes("Backup and recovery (system administrators)"));
  check("admin: sees the drill gate", adminView.html.includes("Pre-production drill gate"));
  const articleView = await page("/continuity", article.id);
  check("article: /continuity renders 200 with the status board", articleView.status === 200 && articleView.html.includes("Service status"));
  check("article: NO recovery panel", !articleView.html.includes("Backup and recovery (system administrators)"));
  // Match the SECTION, not the phrase: "Emergency obligation export" is also a
  // row in the availability table every member sees.
  check("article: NO emergency export section (no export.run)", !articleView.html.includes('id="ex-h"'));
  const partnerView = await page("/continuity", partner.id);
  check("partner: sees the emergency export section", partnerView.html.includes('id="ex-h"'));
  check("partner: NO recovery panel", !partnerView.html.includes("Backup and recovery (system administrators)"));
  const practice = await page("/practice", partner.id);
  check("/practice links to /continuity", practice.html.includes('href="/continuity"'));
  const home = await page("/", partner.id);
  check("/ still renders", home.status === 200, String(home.status));

  console.log("routes");
  const { cookie, token } = await csrfPair();
  const post = (path: string, userId: string, body: unknown, withCsrf = true) =>
    fetch(`${BASE}${path}`, {
      method: "POST",
      headers: {
        ...as(userId),
        "content-type": "application/json",
        ...(withCsrf ? { cookie, "x-bhv-csrf": token, origin: BASE } : {}),
      },
      body: JSON.stringify(body),
    });

  const status = await fetch(`${BASE}/api/continuity/status`, { headers: as(article.id) });
  const statusBody = await status.json();
  check("GET status: any member gets the board", status.status === 200 && statusBody.services.length === 7);
  check("responses carry a correlation id", !!status.headers.get("x-correlation-id"));

  const noCsrf = await post("/api/continuity/status", admin.id, { action: "probe" }, false);
  check("POST without CSRF is refused", noCsrf.status === 403, String(noCsrf.status));
  const probe = await post("/api/continuity/status", admin.id, { action: "probe" });
  check("admin probe over HTTP: 200", probe.status === 200, String(probe.status));
  const probeByArticle = await post("/api/continuity/status", article.id, { action: "probe" });
  const pba = await probeByArticle.json();
  check("article probe: 403 PERMISSION_DENIED", probeByArticle.status === 403 && pba.code === "PERMISSION_DENIED", JSON.stringify(pba));
  const handDb = await post("/api/continuity/status", admin.id, { service: "DATABASE", state: "OPERATIONAL", detail: "x" });
  check("hand-setting DATABASE: 409 SERVICE_IS_PROBED", handDb.status === 409 && (await handDb.json()).code === "SERVICE_IS_PROBED");

  const stepNoSession = await post("/api/auth/step-up", partner.id, { purpose: "EXPORT", code: "123456" });
  check("step-up via dev header (no session): 401 SESSION_REQUIRED", stepNoSession.status === 401 && (await stepNoSession.json()).code === "SESSION_REQUIRED");
  const exportNoSession = await post("/api/continuity/emergency-export", partner.id, { practiceId: company.practiceId, reason: "x" });
  check("export via dev header (no session): 401", exportNoSession.status === 401, String(exportNoSession.status));

  const dtBad = await post("/api/continuity/downtime", article.id, { practiceId: company.practiceId, entries: [{ description: "", occurredAt: new Date().toISOString() }] });
  const dtBadBody = await dtBad.json();
  check("downtime with blank description: 400 DESCRIPTION_REQUIRED", dtBad.status === 400 && dtBadBody.code === "DESCRIPTION_REQUIRED", JSON.stringify(dtBadBody));
  const dt = await post("/api/continuity/downtime", article.id, {
    practiceId: company.practiceId,
    entries: [{ description: "HTTP check: paper note entered", occurredAt: new Date(Date.now() - 600_000).toISOString(), service: "DATABASE" }],
  });
  const dtBody = await dt.json();
  check("downtime sheet over HTTP: 200 with an id", dt.status === 200 && dtBody.ids?.length === 1, JSON.stringify(dtBody));
  const rec = await prisma.downtimeWorkRecord.findUniqueOrThrow({ where: { id: dtBody.ids[0] } });
  const recOutsider = await post(`/api/continuity/downtime/${rec.id}/reconcile`, (await latest("Outsider")).id, { expectedVersion: rec.version, note: "x" });
  check("reconcile by the other practice: 404", recOutsider.status === 404, String(recOutsider.status));
  const recStale = await post(`/api/continuity/downtime/${rec.id}/reconcile`, partner.id, { expectedVersion: rec.version + 3, note: "x" });
  check("reconcile at a stale version: 409 VERSION_CONFLICT", recStale.status === 409 && (await recStale.json()).code === "VERSION_CONFLICT");
  const recOk = await post(`/api/continuity/downtime/${rec.id}/reconcile`, partner.id, { expectedVersion: rec.version, note: "HTTP check" });
  check("reconcile: 200", recOk.status === 200, String(recOk.status));

  const recovery = await fetch(`${BASE}/api/recovery`, { headers: as(admin.id) });
  const recoveryBody = await recovery.json();
  check("GET /api/recovery (admin): posture + gate + schedule", recovery.status === 200 && !!recoveryBody.posture && !!recoveryBody.gate && recoveryBody.schedule.length === 4);
  const recoveryPartner = await fetch(`${BASE}/api/recovery`, { headers: as(partner.id) });
  check("GET /api/recovery (partner): 403", recoveryPartner.status === 403, String(recoveryPartner.status));
  const heldRestore = recoveryBody.restores.find((r: { outboundReleasedAt: string | null; status: string }) => !r.outboundReleasedAt && r.status === "COMPLETED");
  if (heldRestore) {
    const relPartner = await post(`/api/recovery/restores/${heldRestore.id}/release`, partner.id, { expectedVersion: heldRestore.version, reason: "x" });
    check("hold release by a partner: 403 (checked in the library)", relPartner.status === 403, String(relPartner.status));
  }
  const drillPartner = await post("/api/recovery/drills", partner.id, { scenario: "KEY_SERVICE_UNAVAILABLE", remediationOwnerName: "x" });
  check("drill by a partner: 403", drillPartner.status === 403, String(drillPartner.status));
  const drillBad = await post("/api/recovery/drills", admin.id, { scenario: "NOT_A_SCENARIO", remediationOwnerName: "x" });
  check("drill with an unknown scenario: 400", drillBad.status === 400, String(drillBad.status));

  console.log(`\n${pass} passed, ${fail} failed`);
}
main()
  .then(() => prisma.$disconnect())
  .then(() => process.exit(fail ? 1 : 0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
