import { NextResponse } from "next/server";
import { badRequest, errorResponse, notFound } from "@/lib/api";
import { assertCsrf } from "@/lib/csrf";
import { requireUserId } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getConnector, rotateCredential, testConnector, updateConnector } from "@/lib/connectors";
import type { ConnectorStatus } from "@/generated/prisma/enums";

export const dynamic = "force-dynamic";

const STATUSES: ConnectorStatus[] = ["DRAFT", "ACTIVE", "DISABLED", "RETIRED"];

/** The practice is read from the STORED record, never the request body. */
async function storedPractice(connectorId: string) {
  const row = await prisma.connectorConfig.findUnique({ where: { id: connectorId }, select: { practiceId: true } });
  return row?.practiceId ?? null;
}

/** INT01: one connector with its rotation and test history. */
export async function GET(_request: Request, context: { params: Promise<{ connectorId: string }> }) {
  try {
    const userId = await requireUserId();
    const { connectorId } = await context.params;
    const practiceId = await storedPractice(connectorId);
    if (!practiceId) return notFound();
    return NextResponse.json({ connector: await getConnector(userId, practiceId, connectorId) });
  } catch (e) {
    return errorResponse(e);
  }
}

/** INT01: test | rotate | status. */
export async function POST(request: Request, context: { params: Promise<{ connectorId: string }> }) {
  try {
    const userId = await requireUserId();
    await assertCsrf(request);
    const { connectorId } = await context.params;
    const body = await request.json().catch(() => ({}));
    const practiceId = await storedPractice(connectorId);
    if (!practiceId) return notFound();

    if (body.action === "test") {
      return NextResponse.json(await testConnector({ actorUserId: userId, practiceId, connectorId }));
    }
    if (typeof body.expectedVersion !== "number") return badRequest("expectedVersion is required");
    if (body.action === "rotate") {
      const row = await rotateCredential({
        actorUserId: userId,
        practiceId,
        connectorId,
        expectedVersion: body.expectedVersion,
        newCredentialRef: String(body.newCredentialRef ?? ""),
        reason: String(body.reason ?? ""),
      });
      return NextResponse.json({ ok: true, version: row.version, credentialVersion: row.credentialVersion });
    }
    if (body.action === "status" || body.action === "update") {
      if (body.status !== undefined && !STATUSES.includes(body.status)) return badRequest("Unknown status");
      const row = await updateConnector({
        actorUserId: userId,
        practiceId,
        connectorId,
        expectedVersion: body.expectedVersion,
        status: body.status,
        purpose: typeof body.purpose === "string" ? body.purpose : undefined,
        ownerUserId: typeof body.ownerUserId === "string" ? body.ownerUserId : undefined,
        scope: Array.isArray(body.scope) ? body.scope.map(String) : undefined,
      });
      return NextResponse.json({ ok: true, version: row.version, status: row.status });
    }
    return badRequest("action must be test, rotate, status or update");
  } catch (e) {
    return errorResponse(e);
  }
}
