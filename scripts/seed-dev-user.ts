/**
 * Dev-only seed: one fully set-up staff user (password + confirmed MFA) in
 * two fictional practices, so the real login flow (src/lib/auth.ts, exposed
 * via /login) can be exercised end to end from a browser.
 *
 * Fictional data only — see PROGRESS.md's open questions on real BHV data.
 * Idempotent: does nothing if SEED_EMAIL already exists.
 *
 * Run: npm run seed:dev-user
 */

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { setPassword, beginMfaEnrolment, confirmMfaEnrolment } from "../src/lib/auth";
import { totpCode } from "../src/lib/crypto";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const EMAIL = process.env.SEED_EMAIL ?? "dev.owner@example.invalid";
const PASSWORD = process.env.SEED_PASSWORD ?? "Dev-Local-Test-Passphrase-9";

async function main() {
  const existing = await prisma.user.findUnique({ where: { email: EMAIL } });
  if (existing) {
    console.log(`\nAlready seeded: ${EMAIL} (user ${existing.id}).`);
    console.log("Delete that User row (and its dependants) to reseed, or set SEED_EMAIL to a new address.\n");
    return;
  }

  const tenant = await prisma.tenant.create({ data: { name: "Dev Tenant" } });
  const stamp = Date.now();

  const company = await prisma.practice.create({
    data: {
      tenantId: tenant.id,
      name: "Dev Company Practice",
      constitution: "LLP",
      documentNamespace: `dev-company-${stamp}`,
      effectiveFrom: new Date("2024-04-01"),
    },
  });
  const associates = await prisma.practice.create({
    data: {
      tenantId: tenant.id,
      name: "Dev Associates Practice",
      constitution: "PARTNERSHIP",
      documentNamespace: `dev-associates-${stamp}`,
      effectiveFrom: new Date("2024-04-01"),
    },
  });

  const user = await prisma.user.create({
    data: { email: EMAIL, fullName: "Dev Owner", status: "ACTIVE", acceptedAt: new Date() },
  });

  // GROUP_OWNER + COMBINED in both practices: broad read access, and the firm
  // switcher / pinned Billing / Review queue nav all have something to show.
  await prisma.practiceMembership.createMany({
    data: [
      {
        practiceId: company.id, userId: user.id,
        role: "GROUP_OWNER", assignmentScope: "COMBINED", effectiveFrom: new Date("2024-04-01"),
      },
      {
        practiceId: associates.id, userId: user.id,
        role: "GROUP_OWNER", assignmentScope: "COMBINED", effectiveFrom: new Date("2024-04-01"),
      },
    ],
  });

  await setPassword(user.id, PASSWORD);

  const { enrolmentId, secret } = await beginMfaEnrolment(user.id);
  const code = totpCode(secret);
  const { recoveryCodes } = await confirmMfaEnrolment(enrolmentId, code);

  console.log("\nSeeded a dev user — sign in at http://localhost:3000/login\n");
  console.log(`  Email:       ${EMAIL}`);
  console.log(`  Password:    ${PASSWORD}`);
  console.log(`  TOTP secret: ${secret}`);
  console.log(
    "\n  Add the secret above to an authenticator app (Google Authenticator, Authy, " +
      "1Password, …) via \"Enter setup key manually\", then use the 6-digit code it shows " +
      "to finish signing in.\n",
  );
  console.log("  Recovery codes (single-use, save if you want a backup path):");
  for (const c of recoveryCodes) console.log(`    ${c}`);
  console.log("");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
