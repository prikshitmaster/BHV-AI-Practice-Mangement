/**
 * SEC05 — monitoring and incidents (PRD §35).
 *
 * "Monitor failed logins, abnormal exports, privilege changes, queue failure,
 *  storage capacity, backup failure and repeated cross scope access attempts.
 *  Assign an incident owner and alert destination. Detection should preserve
 *  evidence without sending confidential files to an unrestricted alert
 *  channel."
 *
 * The last sentence shapes the whole design: an alert carries counts, ids and
 * timestamps — enough to investigate — and never document contents or secret
 * values. The evidence itself stays in the append-only audit trail, which the
 * alert points at.
 */

import { prisma } from "@/lib/prisma";
import { sanitiseMeta } from "@/lib/audit";

export type AlertKindName =
  | "FAILED_LOGIN_BURST"
  | "ABNORMAL_EXPORT"
  | "PRIVILEGE_CHANGE"
  | "REPEATED_CROSS_SCOPE_ACCESS"
  | "QUEUE_FAILURE"
  | "STORAGE_CAPACITY"
  | "BACKUP_FAILURE"
  | "SECRET_REVEAL";

/** Configured per deployment; there is no silent "nobody" default. */
export function incidentRouting(kind: AlertKindName) {
  const owner = process.env.SECURITY_INCIDENT_OWNER?.trim();
  const destination = process.env.SECURITY_ALERT_DESTINATION?.trim();

  return {
    incidentOwner: owner || "UNASSIGNED — set SECURITY_INCIDENT_OWNER",
    alertDestination: destination || "UNCONFIGURED — set SECURITY_ALERT_DESTINATION",
    // Anything above INFO must reach a person.
    requiresAcknowledgement: kind !== "STORAGE_CAPACITY",
  };
}

export async function raiseAlert(params: {
  kind: AlertKindName;
  severity: "INFO" | "WARNING" | "CRITICAL";
  summary: string;
  evidence: Record<string, unknown>;
  practiceId?: string | null;
  subjectUserId?: string | null;
}) {
  const routing = incidentRouting(params.kind);

  return prisma.securityAlert.create({
    data: {
      kind: params.kind,
      severity: params.severity,
      summary: params.summary,
      // Same redaction as the audit trail: no file bodies, no secrets.
      evidence: sanitiseMeta(params.evidence) as never,
      practiceId: params.practiceId ?? null,
      subjectUserId: params.subjectUserId ?? null,
      incidentOwner: routing.incidentOwner,
      alertDestination: routing.alertDestination,
    },
  });
}

const FAILED_LOGIN_THRESHOLD = 5;
const CROSS_SCOPE_THRESHOLD = 3;
const EXPORT_ROW_THRESHOLD = 5000;
const DEFAULT_WINDOW_MS = 15 * 60_000;

/** Detection sweep. Run on a schedule and after suspicious activity. */
export async function runDetectionSweep(windowMs = DEFAULT_WINDOW_MS) {
  const since = new Date(Date.now() - windowMs);
  const raised: string[] = [];

  // Failed logins, grouped by actor.
  const failedLogins = await prisma.event.groupBy({
    by: ["actorUserId"],
    where: { action: "LOGIN_FAILED", result: "FAILURE", createdAt: { gte: since } },
    _count: { _all: true },
  });

  for (const row of failedLogins) {
    if (row._count._all >= FAILED_LOGIN_THRESHOLD && row.actorUserId) {
      await raiseAlert({
        kind: "FAILED_LOGIN_BURST",
        severity: "WARNING",
        summary: `${row._count._all} failed logins in ${Math.round(windowMs / 60000)} minutes`,
        subjectUserId: row.actorUserId,
        evidence: { failedAttempts: row._count._all, windowMinutes: windowMs / 60000 },
      });
      raised.push("FAILED_LOGIN_BURST");
    }
  }

  // Repeated cross-scope access attempts — the isolation canary.
  const crossScope = await prisma.event.groupBy({
    by: ["actorUserId"],
    where: {
      action: { in: ["PRACTICE_ACCESS_DENIED", "OBJECT_LINK_DENIED"] },
      createdAt: { gte: since },
    },
    _count: { _all: true },
  });

  for (const row of crossScope) {
    if (row._count._all >= CROSS_SCOPE_THRESHOLD && row.actorUserId) {
      await raiseAlert({
        kind: "REPEATED_CROSS_SCOPE_ACCESS",
        severity: "CRITICAL",
        summary: `${row._count._all} cross-practice access attempts refused`,
        subjectUserId: row.actorUserId,
        evidence: { deniedAttempts: row._count._all, windowMinutes: windowMs / 60000 },
      });
      raised.push("REPEATED_CROSS_SCOPE_ACCESS");
    }
  }

  // Privilege changes are always worth a record, even when legitimate.
  const privilegeChanges = await prisma.event.findMany({
    where: {
      action: { in: ["PERMISSION_GRANTED", "ROLE_CHANGED", "USER_SUSPENDED"] },
      createdAt: { gte: since },
    },
    select: { id: true, action: true, actorUserId: true, practiceId: true, targetId: true },
  });

  if (privilegeChanges.length > 0) {
    await raiseAlert({
      kind: "PRIVILEGE_CHANGE",
      severity: "INFO",
      summary: `${privilegeChanges.length} privilege change(s) recorded`,
      evidence: {
        // Ids only — the detail stays in the audit trail.
        eventIds: privilegeChanges.map((p) => p.id),
        actions: privilegeChanges.map((p) => p.action),
      },
    });
    raised.push("PRIVILEGE_CHANGE");
  }

  // Failed background work.
  const failedJobs = await prisma.queuedJob.count({
    where: { state: "FAILED", finishedAt: { gte: since } },
  });
  if (failedJobs > 0) {
    await raiseAlert({
      kind: "QUEUE_FAILURE",
      severity: "WARNING",
      summary: `${failedJobs} background job(s) failed`,
      evidence: { failedJobs, windowMinutes: windowMs / 60000 },
    });
    raised.push("QUEUE_FAILURE");
  }

  return { raised, windowMs };
}

/** Called by the export path when a run looks unusually large. */
export async function checkExportVolume(params: {
  userId: string;
  practiceId: string | null;
  rowCount: number;
}) {
  if (params.rowCount < EXPORT_ROW_THRESHOLD) return null;

  return raiseAlert({
    kind: "ABNORMAL_EXPORT",
    severity: "WARNING",
    summary: `Export of ${params.rowCount} rows exceeds the ${EXPORT_ROW_THRESHOLD} row review threshold`,
    subjectUserId: params.userId,
    practiceId: params.practiceId,
    // Row COUNT, never row contents.
    evidence: { rowCount: params.rowCount, threshold: EXPORT_ROW_THRESHOLD },
  });
}
