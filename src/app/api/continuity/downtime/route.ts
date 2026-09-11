import { NextResponse } from "next/server";
import { badRequest, errorResponse } from "@/lib/api";
import { assertCsrf } from "@/lib/csrf";
import { requireUserId } from "@/lib/session";
import {
  MONITORED_SERVICES,
  recordDowntimeWork,
  unreconciledDowntimeWork,
  type DowntimeEntry,
} from "@/lib/continuity";
import type { MonitoredService } from "@/generated/prisma/enums";

export const dynamic = "force-dynamic";

/** BCP04: downtime work in one practice still waiting to be reconciled. */
export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    const practiceId = new URL(request.url).searchParams.get("practiceId");
    if (!practiceId) return badRequest("practiceId is required");
    const records = await unreconciledDowntimeWork(userId, practiceId);
    return NextResponse.json({ records });
  } catch (e) {
    return errorResponse(e);
  }
}

/**
 * Enter a downtime sheet. All-or-nothing — see recordDowntimeWork. The body
 * shape is validated here; authority and cross-practice links are checked in
 * the library.
 */
export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    await assertCsrf(request);
    const body = await request.json().catch(() => ({}));

    if (typeof body.practiceId !== "string") return badRequest("practiceId is required");
    if (!Array.isArray(body.entries)) return badRequest("entries must be a list");

    const entries: DowntimeEntry[] = [];
    for (const [i, raw] of (body.entries as Record<string, unknown>[]).entries()) {
      if (typeof raw?.description !== "string" || typeof raw?.occurredAt !== "string") {
        return badRequest(`Line ${i + 1}: description and occurredAt are required`);
      }
      if (raw.service != null && !MONITORED_SERVICES.includes(raw.service as MonitoredService)) {
        return badRequest(`Line ${i + 1}: unknown service`);
      }
      entries.push({
        description: raw.description,
        occurredAt: new Date(raw.occurredAt),
        service: (raw.service as MonitoredService | undefined) ?? null,
        jobId: typeof raw.jobId === "string" && raw.jobId ? raw.jobId : null,
        obligationId: typeof raw.obligationId === "string" && raw.obligationId ? raw.obligationId : null,
      });
    }

    const result = await recordDowntimeWork({ actorUserId: userId, practiceId: body.practiceId, entries });
    return NextResponse.json({ ok: true, ids: result.ids });
  } catch (e) {
    return errorResponse(e);
  }
}
