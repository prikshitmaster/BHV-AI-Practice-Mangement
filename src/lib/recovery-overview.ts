/**
 * The administrator's recovery picture — BCP01/02/03/06 on one read model,
 * shared by GET /api/recovery and the /continuity screen so the two cannot
 * disagree about what "recoverable" currently means.
 *
 * Caller must have passed assertSystemAdministrator: this reads deployment-
 * wide operational records (backups, restores, drills), not client data.
 */

import { prisma } from "@/lib/prisma";
import { recoveryPosture } from "@/lib/backup";
import { drillSchedule, productionDrillGate } from "@/lib/drills";

export async function recoveryOverview() {
  const [posture, backups, restores, schedule, gate, openDrills] = await Promise.all([
    recoveryPosture(),
    prisma.backupRun.findMany({
      orderBy: { dataAsOf: "desc" },
      take: 10,
      select: {
        id: true,
        dataAsOf: true,
        completedAt: true,
        status: true,
        failureReason: true,
        offsiteLocation: true,
        immutableCopy: true,
        sizeBytes: true,
      },
    }),
    prisma.restoreRun.findMany({
      orderBy: { startedAt: "desc" },
      take: 10,
      select: {
        id: true,
        targetLabel: true,
        startedAt: true,
        status: true,
        measuredRpoSeconds: true,
        measuredRtoSeconds: true,
        targetsMet: true,
        outboundReleasedAt: true,
        quarantinedOutboundCount: true,
        failureReason: true,
        version: true,
        checks: { select: { passed: true } },
      },
    }),
    drillSchedule(),
    productionDrillGate(),
    prisma.restoreDrill.findMany({
      where: {
        remediationClosedAt: null,
        OR: [{ missingItems: { isEmpty: false } }, { exceptions: { isEmpty: false } }],
      },
      orderBy: { performedAt: "desc" },
      take: 20,
      select: {
        id: true,
        scenario: true,
        performedAt: true,
        missingItems: true,
        exceptions: true,
        remediationOwnerName: true,
        remediationDueAt: true,
        version: true,
      },
    }),
  ]);

  return {
    posture,
    backups: backups.map((b) => ({
      ...b,
      sizeBytes: Number(b.sizeBytes),
      offsite: Boolean(b.offsiteLocation),
      offsiteLocation: undefined,
    })),
    restores: restores.map(({ checks, ...r }) => ({
      ...r,
      checkCount: checks.length,
      failedCheckCount: checks.filter((c) => !c.passed).length,
    })),
    schedule,
    gate,
    openDrills,
  };
}

export type RecoveryOverview = Awaited<ReturnType<typeof recoveryOverview>>;
