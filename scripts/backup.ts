/**
 * BCP01 backup from the command line — for a scheduler (cron / Task
 * Scheduler) and for when the web app itself is not running.
 *
 *   npm run backup                 # database + object payloads + offsite copy
 *   npm run backup -- --immutable  # ALSO claim an immutable/offline copy
 *
 * Only pass --immutable when the offsite root really is write-once or offline
 * storage: the run records the claim, and a read-only bit on an ordinary disk
 * is not one (see BACKUP-RECOVERY.md).
 *
 * Exit code 0 only on a completed run. Gaps (no offsite copy, objects missing
 * from the store) are printed and do NOT fail the run — they are recorded on it
 * and shown on /continuity — but a scheduler should alert on them.
 */
import "dotenv/config";
import { runBackup } from "../src/lib/backup";
import { recordEvent } from "../src/lib/audit";
import { prisma } from "../src/lib/prisma";

async function main() {
  const immutableCopy = process.argv.includes("--immutable");
  const result = await runBackup({ includeObjectPayloads: true, immutableCopy });
  await recordEvent({
    action: "BACKUP_RUN",
    targetType: "BackupRun",
    targetId: result.backupRunId,
    result: "SUCCESS",
    actorServiceIdentity: "backup-cli",
    afterMeta: { artifacts: result.artifacts.length, gaps: result.gaps.length, manifestSha256: result.manifestSha256 },
  });

  console.log(`backup ${result.backupRunId}`);
  console.log(`  data as of   ${result.dataAsOf.toISOString()}`);
  console.log(`  primary      ${result.directory}`);
  console.log(`  offsite      ${result.offsiteDirectory ?? "NONE — no separate failure domain"}`);
  console.log(`  artifacts    ${result.artifacts.length}`);
  console.log(`  manifest     ${result.manifestSha256}`);
  if (result.gaps.length) {
    console.log(`  GAPS (${result.gaps.length}):`);
    for (const g of result.gaps.slice(0, 20)) console.log(`    - ${g}`);
    if (result.gaps.length > 20) console.log(`    … and ${result.gaps.length - 20} more`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
