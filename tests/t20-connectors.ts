/**
 * T20 acceptance test — INT01 (PRD §31). INT02 is R1.
 *
 * Acceptance line (TASKS.md, from INT01 verbatim):
 *   "connector config stores practice, owner, purpose, environment, scope,
 *    provider, credential REFERENCE and status; a connection test discloses no
 *    secret; dev and production credentials are separate; rotating one
 *    practice's token does not disrupt the other practice."
 *
 * Each evidence point has a CONTROL so it cannot pass with the mechanism off:
 * the secret-scrubbing check first proves the probe really RECEIVED the
 * secret; the environment check proves the probe was never CALLED; the
 * rotation check proves the other practice's connector still PASSES a test.
 *
 * Library level — no HTTP server. Secrets are random per run, set only in this
 * process's environment, and fictional. Run: npm run test:t20
 */

import "dotenv/config";
import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { PermissionDeniedError } from "../src/lib/permissions";
import { PracticeAccessError } from "../src/lib/practice-scope";
import { VersionConflictError } from "../src/lib/concurrency";
import {
  ConnectorError,
  createConnector,
  getConnector,
  listConnectors,
  resolveConnectorCredential,
  rotateCredential,
  scrubSecret,
  setConnectorProbe,
  setRuntimeEnvironmentForTests,
  testConnector,
  updateConnector,
} from "../src/lib/connectors";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

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
async function throws<T extends Error>(fn: () => Promise<unknown>, ctor: new (...a: never[]) => T): Promise<T | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    return e instanceof ctor ? e : null;
  }
}

const RUN = Date.now();
const tag = (s: string) => `${s}-${RUN}`;
const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const secret = () => `fict_${randomBytes(18).toString("hex")}`;

async function main() {
  console.log("\nT20 — connector configuration (PRD §31 INT01)\n");
  setRuntimeEnvironmentForTests("DEVELOPMENT");

  // ============================================================ fixtures
  const tenant = await prisma.tenant.create({ data: { name: tag("BHV") } });
  const makePractice = (name: string, ns: string) =>
    prisma.practice.create({
      data: {
        tenantId: tenant.id, name: tag(name), constitution: "PARTNERSHIP",
        documentNamespace: `${ns}-${RUN}`.toLowerCase(), effectiveFrom: d("2024-04-01"),
      },
    });
  const company = await makePractice("Fictional Company LLP", "t20co");
  const associates = await makePractice("Fictional Associates", "t20as");
  const makeUser = (label: string) =>
    prisma.user.create({ data: { email: `${label}-${RUN}@example.invalid`, fullName: `Fictional ${label}`, status: "ACTIVE" } });
  const partner = await makeUser("Partner");
  const itAdmin = await makeUser("ItAdmin");
  const article = await makeUser("Article");
  const assocPartner = await makeUser("AssocPartner");
  const from = d("2024-04-01");
  await prisma.practiceMembership.createMany({
    data: [
      { practiceId: company.id, userId: partner.id, role: "PRACTICE_PARTNER", assignmentScope: "PRACTICE", effectiveFrom: from },
      { practiceId: company.id, userId: itAdmin.id, role: "IT_ADMIN", assignmentScope: "PRACTICE", effectiveFrom: from },
      { practiceId: company.id, userId: article.id, role: "STAFF_ARTICLE", assignmentScope: "OWN_WORK", effectiveFrom: from },
      { practiceId: associates.id, userId: assocPartner.id, role: "PRACTICE_PARTNER", assignmentScope: "PRACTICE", effectiveFrom: from },
    ],
  });

  const envName = (s: string) => `T20_${s}_${RUN}`;
  const coDevSecret = secret();
  const asDevSecret = secret();
  process.env[envName("CO_DEV")] = coDevSecret;
  process.env[envName("AS_DEV")] = asDevSecret;
  process.env[envName("CO_PROD")] = secret();

  const baseInput = {
    provider: "fict-mail",
    purpose: "Approved outbound email for fee reminders",
    environment: "DEVELOPMENT" as const,
    scope: ["mail.send"],
  };

  // ============================================================ 1. stored fields
  console.log("1. Configuration stores the eight INT01 fields — and a reference, not a secret");
  const coDev = await createConnector({
    actorUserId: itAdmin.id, practiceId: company.id,
    input: { ...baseInput, name: "Outbound mail", ownerUserId: partner.id, credentialRef: `env:${envName("CO_DEV")}` },
  });
  const stored = await prisma.connectorConfig.findUniqueOrThrow({ where: { id: coDev.id } });
  check("practice stored", stored.practiceId === company.id);
  check("owner stored", stored.ownerUserId === partner.id);
  check("purpose stored", stored.purpose === baseInput.purpose);
  check("environment stored", stored.environment === "DEVELOPMENT");
  check("scope stored", stored.scope.join(",") === "mail.send");
  check("provider stored", stored.provider === "fict-mail");
  check("credential reference stored", stored.credentialRef === `env:${envName("CO_DEV")}`);
  check("status stored, starts DRAFT", stored.status === "DRAFT");
  check("the secret value is nowhere in the row", !JSON.stringify(stored).includes(coDevSecret));

  const pasted = await throws(
    () => createConnector({ actorUserId: itAdmin.id, practiceId: company.id,
      input: { ...baseInput, name: "Pasted", ownerUserId: partner.id, credentialRef: coDevSecret } }),
    ConnectorError,
  );
  check("a pasted secret is refused as a reference", pasted?.code === "CREDENTIAL_REF_FORMAT");
  const reserved = await throws(
    () => createConnector({ actorUserId: itAdmin.id, practiceId: company.id,
      input: { ...baseInput, name: "Reserved", ownerUserId: partner.id, credentialRef: "env:DATABASE_URL" } }),
    ConnectorError,
  );
  check("a reference to a platform secret is refused", reserved?.code === "CREDENTIAL_REF_RESERVED");
  const badOwner = await throws(
    () => createConnector({ actorUserId: itAdmin.id, practiceId: company.id,
      input: { ...baseInput, name: "Bad owner", ownerUserId: assocPartner.id, credentialRef: `env:${envName("UNUSED_1")}` } }),
    ConnectorError,
  );
  check("the owner must be a member of THIS practice", badOwner?.code === "OWNER_NOT_MEMBER");

  // Permissions and isolation.
  check("an article cannot configure connectors",
    !!(await throws(() => listConnectors(article.id, company.id), PermissionDeniedError)));
  check("the other practice's partner gets 404, not the list",
    !!(await throws(() => listConnectors(assocPartner.id, company.id), PracticeAccessError)));
  const crossRead = await throws(() => getConnector(assocPartner.id, associates.id, coDev.id), ConnectorError);
  check("reading a Company connector by id through Associates is 404", crossRead?.status === 404);
  check("CONTROL: the IT admin can list it", (await listConnectors(itAdmin.id, company.id)).some((c) => c.id === coDev.id));

  // ============================================================ 2. no secret disclosed
  console.log("\n2. A connection test discloses no secret");
  let probeSaw: string | null = null;
  setConnectorProbe("fict-mail", async ({ secret: s }) => {
    probeSaw = s;
    // A badly written provider library that echoes the token back.
    return { ok: true, message: `Authenticated with token ${s} (b64 ${Buffer.from(s).toString("base64")})` };
  });
  const t1 = await testConnector({ actorUserId: itAdmin.id, practiceId: company.id, connectorId: coDev.id });
  check("CONTROL: the probe really received the secret", probeSaw === coDevSecret);
  check("test PASSED", t1.result === "PASSED", t1.message);
  check("returned message has no secret", !t1.message.includes(coDevSecret) && t1.message.includes("[redacted]"), t1.message);
  check("returned message has no base64 form of the secret", !t1.message.includes(Buffer.from(coDevSecret).toString("base64")));

  setConnectorProbe("fict-mail", async ({ secret: s }) => {
    throw new Error(`401 from provider: bad key ${s.slice(3, 20)}...`);
  });
  const t2 = await testConnector({ actorUserId: itAdmin.id, practiceId: company.id, connectorId: coDev.id });
  check("a thrown error carrying a FRAGMENT of the secret is withheld", t2.result === "FAILED" && t2.message.startsWith("Probe output withheld"), t2.message);

  const runs = await prisma.connectorTestRun.findMany({ where: { connectorId: coDev.id } });
  const events = await prisma.event.findMany({ where: { targetId: coDev.id } });
  const row = await prisma.connectorConfig.findUniqueOrThrow({ where: { id: coDev.id } });
  const everything = JSON.stringify({ runs, events, row }, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
  check("two test runs recorded", runs.length === 2);
  check("no secret, or any 8-char fragment, in test runs / audit trail / config row",
    ![...Array(coDevSecret.length - 7).keys()].some((i) => everything.includes(coDevSecret.slice(i, i + 8))));
  check("CONTROL: the search can find a known stored value", everything.includes(envName("CO_DEV")));
  check("scrubSecret leaves an unrelated message intact", scrubSecret("timeout after 10 s", coDevSecret) === "timeout after 10 s");

  // Activation needs a passing test on the current credential.
  setConnectorProbe("fict-mail", async () => ({ ok: true, message: "ok" }));
  const act1 = await throws(
    () => updateConnector({ actorUserId: itAdmin.id, practiceId: company.id, connectorId: coDev.id, expectedVersion: row.version, status: "ACTIVE" }),
    ConnectorError,
  );
  check("cannot activate after a FAILED last test", act1?.code === "TEST_REQUIRED");
  await testConnector({ actorUserId: itAdmin.id, practiceId: company.id, connectorId: coDev.id });
  const activated = await updateConnector({ actorUserId: itAdmin.id, practiceId: company.id, connectorId: coDev.id, expectedVersion: row.version, status: "ACTIVE" });
  check("CONTROL: activates after a passing test", activated.status === "ACTIVE");
  check("a stale version is a conflict, not an overwrite",
    !!(await throws(() => updateConnector({ actorUserId: itAdmin.id, practiceId: company.id, connectorId: coDev.id, expectedVersion: row.version, purpose: "Changed" }), VersionConflictError)));

  // ============================================================ 3. dev vs prod
  console.log("\n3. Development and production credentials are separate");
  const sameRef = await throws(
    () => createConnector({ actorUserId: itAdmin.id, practiceId: company.id,
      input: { ...baseInput, name: "Outbound mail", environment: "PRODUCTION", ownerUserId: partner.id, credentialRef: `env:${envName("CO_DEV")}` } }),
    ConnectorError,
  );
  check("a production connector cannot reuse the development reference", sameRef?.code === "CREDENTIAL_REF_IN_USE");
  check("the refusal does not name the holder", !!sameRef && !sameRef.message.includes(coDev.id) && !sameRef.message.includes(company.name));
  const coProd = await createConnector({
    actorUserId: itAdmin.id, practiceId: company.id,
    input: { ...baseInput, name: "Outbound mail", environment: "PRODUCTION", ownerUserId: partner.id, credentialRef: `env:${envName("CO_PROD")}` },
  });
  check("CONTROL: same name, own reference, PRODUCTION — accepted", coProd.environment === "PRODUCTION");

  let calls = 0;
  setConnectorProbe("fict-mail", async () => { calls++; return { ok: true, message: "ok" }; });
  const prodInDev = await testConnector({ actorUserId: itAdmin.id, practiceId: company.id, connectorId: coProd.id });
  check("a PRODUCTION connector tested from a DEVELOPMENT runtime is REFUSED", prodInDev.result === "REFUSED", prodInDev.message);
  check("…and the probe was never called (secret never read)", calls === 0);
  setRuntimeEnvironmentForTests("PRODUCTION");
  const devInProd = await testConnector({ actorUserId: itAdmin.id, practiceId: company.id, connectorId: coDev.id });
  check("a DEVELOPMENT connector in a PRODUCTION runtime is REFUSED", devInProd.result === "REFUSED" && calls === 0);
  check("an ACTIVE dev connector's credential cannot be resolved in production",
    (await throws(() => resolveConnectorCredential(company.id, coDev.id), ConnectorError))?.code === "ENVIRONMENT_MISMATCH");
  const prodInProd = await testConnector({ actorUserId: itAdmin.id, practiceId: company.id, connectorId: coProd.id });
  check("CONTROL: the PRODUCTION connector passes in a PRODUCTION runtime", prodInProd.result === "PASSED" && calls === 1);
  setRuntimeEnvironmentForTests("DEVELOPMENT");

  // ============================================================ 4. rotation isolation
  console.log("\n4. Rotating one practice's token does not disrupt the other practice");
  const asDev = await createConnector({
    actorUserId: assocPartner.id, practiceId: associates.id,
    input: { ...baseInput, name: "Outbound mail", ownerUserId: assocPartner.id, credentialRef: `env:${envName("AS_DEV")}` },
  });
  check("the two practices cannot share a reference",
    (await throws(() => createConnector({ actorUserId: assocPartner.id, practiceId: associates.id,
      input: { ...baseInput, name: "Sharing", ownerUserId: assocPartner.id, credentialRef: `env:${envName("CO_DEV")}` } }), ConnectorError))?.code === "CREDENTIAL_REF_IN_USE");
  await testConnector({ actorUserId: assocPartner.id, practiceId: associates.id, connectorId: asDev.id });
  const asActive = await updateConnector({ actorUserId: assocPartner.id, practiceId: associates.id, connectorId: asDev.id, expectedVersion: asDev.version, status: "ACTIVE" });
  const asBefore = await prisma.connectorConfig.findUniqueOrThrow({ where: { id: asDev.id } });

  const newCoSecret = secret();
  process.env[envName("CO_DEV_V2")] = newCoSecret;
  const coNow = await prisma.connectorConfig.findUniqueOrThrow({ where: { id: coDev.id } });
  const rotated = await rotateCredential({
    actorUserId: itAdmin.id, practiceId: company.id, connectorId: coDev.id, expectedVersion: coNow.version,
    newCredentialRef: `env:${envName("CO_DEV_V2")}`, reason: "Scheduled quarterly rotation",
  });
  delete process.env[envName("CO_DEV")]; // the old Company token is revoked at the provider
  check("Company connector now on credential v2", rotated.credentialVersion === 2 && rotated.credentialRef.endsWith("CO_DEV_V2_" + RUN));
  check("rotation resets the last test (it proved another credential)", rotated.lastTestResult === null);
  check("rotation history recorded", (await prisma.connectorCredentialRotation.count({ where: { connectorId: coDev.id } })) === 1);

  const asAfter = await prisma.connectorConfig.findUniqueOrThrow({ where: { id: asDev.id } });
  check("Associates row untouched: reference", asAfter.credentialRef === asBefore.credentialRef);
  check("Associates row untouched: version + credential version",
    asAfter.version === asBefore.version && asAfter.credentialVersion === asBefore.credentialVersion);
  check("Associates row untouched: status + last test",
    asAfter.status === "ACTIVE" && asAfter.lastTestResult === "PASSED" && asActive.status === "ACTIVE");
  const asTest = await testConnector({ actorUserId: assocPartner.id, practiceId: associates.id, connectorId: asDev.id });
  check("Associates connector still PASSES a live test after Company rotated", asTest.result === "PASSED");
  check("Associates credential still resolves", (await resolveConnectorCredential(associates.id, asDev.id)) === asDevSecret);

  const reuse = await throws(
    () => createConnector({ actorUserId: assocPartner.id, practiceId: associates.id,
      input: { ...baseInput, name: "Reuse", ownerUserId: assocPartner.id, credentialRef: `env:${envName("CO_DEV")}` } }),
    ConnectorError,
  );
  check("the retired Company reference can never be reused", reuse?.code === "CREDENTIAL_REF_IN_USE");
  check("Associates cannot rotate a Company connector by id",
    (await throws(() => rotateCredential({ actorUserId: assocPartner.id, practiceId: associates.id, connectorId: coDev.id,
      expectedVersion: rotated.version, newCredentialRef: `env:${envName("X")}`, reason: "x" }), ConnectorError))?.status === 404);
  const coTest = await testConnector({ actorUserId: itAdmin.id, practiceId: company.id, connectorId: coDev.id });
  check("CONTROL: Company connector passes on its NEW credential", coTest.result === "PASSED");

  setConnectorProbe("fict-mail", null);
  setRuntimeEnvironmentForTests(null);
  console.log(`\n${passed} passed, ${failed} failed\n`);
  await prisma.$disconnect();
  process.exit(failed ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
