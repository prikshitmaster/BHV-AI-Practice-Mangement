import { NextResponse } from "next/server";
import { badRequest, errorResponse, notFound } from "@/lib/api";
import { assertCsrf } from "@/lib/csrf";
import { requireUserId } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import {
  assessCertIn,
  getIncident,
  recordIncidentReport,
  reviseAwareness,
  updateRootCause,
} from "@/lib/incidents";
import type { IncidentClockRegime } from "@/generated/prisma/enums";

export const dynamic = "force-dynamic";

const REGIMES: IncidentClockRegime[] = [
  "CERT_IN_6H",
  "DPDP_AFFECTED_PERSONS",
  "DPDP_BOARD_INITIAL",
  "DPDP_BOARD_DETAILED_72H",
];

/** The practice is read from the STORED incident, never the request (IAM01). */
async function practiceOf(incidentId: string) {
  const row = await prisma.securityIncident.findUnique({
    where: { id: incidentId },
    select: { practiceId: true },
  });
  return row?.practiceId ?? null;
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function GET(_request: Request, context: { params: Promise<{ incidentId: string }> }) {
  try {
    const userId = await requireUserId();
    const { incidentId } = await context.params;
    const practiceId = await practiceOf(incidentId);
    if (!practiceId) return notFound();
    return NextResponse.json({ incident: await getIncident(userId, practiceId, incidentId) });
  } catch (e) {
    return errorResponse(e);
  }
}

/**
 * PRV04 actions on one incident: `assess` (CERT-In applicability), `report`
 * (a report actually made, with its reference), `awareness` (earlier-only
 * correction) and `root-cause`. None of them can move a clock except an
 * earlier awareness time.
 */
export async function POST(request: Request, context: { params: Promise<{ incidentId: string }> }) {
  try {
    const userId = await requireUserId();
    await assertCsrf(request);
    const { incidentId } = await context.params;
    const body = await request.json().catch(() => ({}));
    const practiceId = await practiceOf(incidentId);
    if (!practiceId) return notFound();

    switch (body.action) {
      case "assess": {
        if (typeof body.expectedVersion !== "number") return badRequest("expectedVersion is required");
        if (typeof body.applicable !== "boolean") return badRequest("applicable must be true or false");
        await assessCertIn({
          actorUserId: userId, practiceId, incidentId,
          expectedVersion: body.expectedVersion,
          applicable: body.applicable,
          category: typeof body.category === "string" ? body.category : null,
          reason: String(body.reason ?? ""),
        });
        break;
      }
      case "report": {
        if (!REGIMES.includes(body.regime)) return badRequest("Unknown reporting regime");
        const reportedAt = parseDate(body.reportedAt);
        if (!reportedAt) return badRequest("reportedAt must be a date and time");
        await recordIncidentReport({
          actorUserId: userId, practiceId, incidentId,
          regime: body.regime, reportedAt, reference: String(body.reference ?? ""),
        });
        break;
      }
      case "awareness": {
        if (typeof body.expectedVersion !== "number") return badRequest("expectedVersion is required");
        const newAwarenessAt = parseDate(body.awarenessAt);
        if (!newAwarenessAt) return badRequest("awarenessAt must be a date and time");
        await reviseAwareness({
          actorUserId: userId, practiceId, incidentId,
          expectedVersion: body.expectedVersion, newAwarenessAt, reason: String(body.reason ?? ""),
        });
        break;
      }
      case "root-cause": {
        if (typeof body.expectedVersion !== "number") return badRequest("expectedVersion is required");
        if (!["UNKNOWN", "INVESTIGATING", "IDENTIFIED"].includes(body.rootCause)) {
          return badRequest("Unknown root cause status");
        }
        await updateRootCause({
          actorUserId: userId, practiceId, incidentId,
          expectedVersion: body.expectedVersion, rootCause: body.rootCause,
          note: typeof body.note === "string" ? body.note : null,
        });
        break;
      }
      default:
        return badRequest("action must be assess, report, awareness or root-cause");
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
