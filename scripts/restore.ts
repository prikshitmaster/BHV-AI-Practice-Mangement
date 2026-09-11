/**
 * BCP03 restore from the command line, into the ISOLATED target named by
 * RESTORE_TARGET_DATABASE_URL — never into DATABASE_URL.
 *
 *   EXTERNAL_SENDING_DISABLED=1 npm run restore -- <backupRunId> [--offsite]
 *   EXTERNAL_SENDING_DISABLED=1 npm run restore -- latest --offsite
 *
 * This script deliberately does NOT set EXTERNAL_SENDING_DISABLED for you. The
 * engine refuses to start without it, and the operator having to state it is
 * the point: a restore into an environment that can still send is how last
 * month's invoices get re-mailed.
 *
 * It does not release the outbound hold either. That is a separate, recorded
 * decision by a system administrator on /continuity, after reading the
 * reconciliation below.
 */
import "dotenv/config";
import { runRestore } from "../src/lib/restore";
import { prisma } from "../src/lib/prisma";

async function main() {
  const [arg] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const source = process.argv.includes("--offsite") ? "offsite" : "primary";
  if (!arg) throw new Error("Usage: npm run restore -- <backupRunId|latest> [--offsite]");

  const backup =
    arg === "latest"
      ? await prisma.backupRun.findFirst({ where: { status: "COMPLETED" }, orderBy: { dataAsOf: "desc" } })
      : await prisma.backupRun.findUnique({ where: { id: arg } });
  if (!backup) throw new Error(`No backup run "${arg}".`);

  const r = await runRestore({ backupRunId: backup.id, source, targetLabel: `cli-${source}` });

  console.log(`restore ${r.restoreRunId}: ${r.status} (from the ${source} copy of ${backup.id})`);
  console.log(`  rows ${r.rowsRestored} across ${r.tablesRestored} tables`);
  console.log(`  held: ${r.quarantinedOutbound} outbound message(s), ${r.quarantinedOutboxEvents} outbox event(s)`);
  console.log(
    `  measured RPO ${r.measuredRpoSeconds}s (target ${r.rpoTargetSeconds}s), RTO ${r.measuredRtoSeconds}s (target ${r.rtoTargetSeconds}s) — ${r.targetsMet ? "met" : "MISSED"}`,
  );
  for (const c of r.checks) {
    console.log(`  ${c.passed ? "PASS" : "FAIL"}  [${c.category}] ${c.subject}: ${c.actual}`);
    if (!c.passed && c.detail) console.log(`        ${c.detail}`);
  }
  console.log(
    r.reconciled
      ? "\nAll checks passed. Outbound is STILL HELD — release it on /continuity once you have reviewed the above."
      : "\nReconciliation FAILED. Outbound stays held and cannot be released until every check passes.",
  );
  if (!r.reconciled) process.exitCode = 2;
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  });
