/**
 * Dev-only helper: print the current TOTP code for the seeded dev user, so the
 * real /login flow can be walked through in a browser without setting up an
 * authenticator app first.
 *
 * Dev only by design — it refuses to run with NODE_ENV=production, and it
 * prints a CODE (valid for one 30 s step, single use) rather than the seed.
 *
 * Run: npm run dev:totp
 */

import "dotenv/config";
// The shared client, not a bare one: src/lib/prisma.ts configures the pg pool
// explicitly, and without that this machine intermittently drops the socket
// mid-query as an opaque P1017 (see PROGRESS.md).
import { prisma } from "../src/lib/prisma";
import { decryptSecret, totpCode } from "../src/lib/crypto";

if (process.env.NODE_ENV === "production") {
  throw new Error("dev-totp is a local development helper and must not run in production.");
}

const EMAIL = process.env.SEED_EMAIL ?? "dev.owner@example.invalid";

/**
 * A code lives for one 30 s step, which is too short to survive being read out
 * of a terminal, pasted into a chat and typed into a form. `--watch` keeps a
 * current one on screen instead, so there is always a fresh one to copy.
 */
const WATCH = process.argv.includes("--watch");

async function main() {
  const user = await prisma.user.findUnique({ where: { email: EMAIL } });
  if (!user) throw new Error(`No user ${EMAIL}. Run: npm run seed:dev-user`);

  const enrolment = await prisma.mfaEnrolment.findFirst({
    where: { userId: user.id, confirmedAt: { not: null }, revokedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (!enrolment) throw new Error(`No confirmed MFA enrolment for ${EMAIL}.`);

  const secret = decryptSecret({
    ciphertext: enrolment.secretCiphertext,
    iv: enrolment.secretIv,
    authTag: enrolment.secretAuthTag,
  });

  const show = () => {
    const secondsLeft = 30 - (Math.floor(Date.now() / 1000) % 30);
    console.log(`  Code:  ${totpCode(secret)}   (valid ${secondsLeft}s)`);
  };

  console.log(`\n  Email: ${EMAIL}`);
  show();

  if (!WATCH) {
    console.log("");
    return;
  }

  console.log("\n  Watching — a new code prints every 30 s. Ctrl+C to stop.\n");
  // Align to the step boundary so each line appears when a code becomes valid,
  // not partway through its life.
  await new Promise<void>((resolve) => {
    setTimeout(() => {
      show();
      setInterval(show, 30_000);
    }, (30 - (Math.floor(Date.now() / 1000) % 30)) * 1000);
    // Runs until interrupted.
    process.on("SIGINT", () => resolve());
  });
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
