import { NextResponse } from "next/server";
import { badRequest, errorResponse } from "@/lib/api";
import { assertCsrf } from "@/lib/csrf";
import { requireUserId } from "@/lib/session";
import { getAccessiblePracticeIds } from "@/lib/practice-scope";
import {
  MONITORED_SERVICES,
  assertSystemAdministrator,
  localFunctionAvailability,
  probeServices,
  reportServiceState,
  serviceStatusBoard,
} from "@/lib/continuity";
import type { MonitoredService, ServiceState } from "@/generated/prisma/enums";

export const dynamic = "force-dynamic";

const STATES: ServiceState[] = ["OPERATIONAL", "DEGRADED", "OFFLINE", "UNKNOWN"];

/**
 * BCP04 "Show degraded status". Every member sees it — an outage that only the
 * IT administrator can see is an outage the office discovers by failing. The
 * board carries no record data, only service states and guidance.
 */
export async function GET() {
  try {
    const userId = await requireUserId();
    // Any live membership; someone with no standing anywhere sees nothing.
    if ((await getAccessiblePracticeIds(userId)).length === 0) {
      return NextResponse.json({ services: [], functions: [] });
    }
    const board = await serviceStatusBoard();
    return NextResponse.json({ services: board, functions: localFunctionAvailability(board) });
  } catch (e) {
    return errorResponse(e);
  }
}

/**
 * System administrators only: `{ "action": "probe" }` re-measures the probed
 * services now; `{ service, state, detail }` reports one the system cannot
 * measure (internet, email, AI, connectors).
 */
export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    await assertCsrf(request);
    const body = await request.json().catch(() => ({}));

    if (body.action === "probe") {
      await assertSystemAdministrator(userId);
      const results = await probeServices();
      const board = await serviceStatusBoard();
      return NextResponse.json({ results, services: board, functions: localFunctionAvailability(board) });
    }

    if (!MONITORED_SERVICES.includes(body.service as MonitoredService)) return badRequest("Unknown service");
    if (!STATES.includes(body.state as ServiceState)) return badRequest("Unknown state");
    if (typeof body.detail !== "string") return badRequest("detail is required");

    const result = await reportServiceState({
      actorUserId: userId,
      service: body.service,
      state: body.state,
      detail: body.detail,
    });
    return NextResponse.json({ ok: true, changed: result.changed });
  } catch (e) {
    return errorResponse(e);
  }
}
