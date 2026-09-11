import { NextResponse } from "next/server";
import { badRequest, errorResponse } from "@/lib/api";
import { assertCsrf } from "@/lib/csrf";
import { requireUserId } from "@/lib/session";
import { createConnector, listConnectors, runtimeEnvironment } from "@/lib/connectors";
import type { ConnectorEnvironment } from "@/generated/prisma/enums";

export const dynamic = "force-dynamic";

const ENVIRONMENTS: ConnectorEnvironment[] = ["DEVELOPMENT", "TEST", "PRODUCTION"];
const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : typeof v === "string" ? v.split(",") : []);

/** INT01: this practice's connectors. Never returns a secret — none is loaded. */
export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    const practiceId = new URL(request.url).searchParams.get("practiceId");
    if (!practiceId) return badRequest("practiceId is required");
    return NextResponse.json({
      runtimeEnvironment: runtimeEnvironment(),
      connectors: await listConnectors(userId, practiceId),
    });
  } catch (e) {
    return errorResponse(e);
  }
}

/** INT01: configure a connector against a credential REFERENCE. */
export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    await assertCsrf(request);
    const body = await request.json().catch(() => ({}));
    if (typeof body.practiceId !== "string") return badRequest("practiceId is required");
    if (!ENVIRONMENTS.includes(body.environment)) return badRequest("Unknown environment");
    const row = await createConnector({
      actorUserId: userId,
      practiceId: body.practiceId,
      input: {
        name: String(body.name ?? ""),
        provider: String(body.provider ?? ""),
        purpose: String(body.purpose ?? ""),
        ownerUserId: String(body.ownerUserId ?? ""),
        environment: body.environment,
        scope: list(body.scope),
        credentialRef: String(body.credentialRef ?? ""),
      },
    });
    return NextResponse.json({ ok: true, id: row.id }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
