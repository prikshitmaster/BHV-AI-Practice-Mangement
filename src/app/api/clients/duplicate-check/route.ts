import { NextResponse } from "next/server";
import { assertPracticeAccess } from "@/lib/practice-scope";
import { requireUserId } from "@/lib/session";
import { errorResponse } from "@/lib/api";
import { assertCsrf } from "@/lib/csrf";
import { checkForDuplicates } from "@/lib/client-registry";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * CLI02 duplicate detection.
 *
 * Returns a warning when an identifier already exists elsewhere in the firm,
 * but carries no identifying detail for out-of-scope matches — see
 * client-registry.ts for why.
 */
export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    await assertCsrf(request);

    const body = (await request.json()) as {
      practiceId?: string;
      identifiers?: { kind: string; value: string }[];
    };

    if (!body.practiceId || !body.identifiers?.length) {
      return NextResponse.json(
        { error: "practiceId and at least one identifier are required" },
        { status: 400 },
      );
    }

    await assertPracticeAccess(userId, body.practiceId);

    const practice = await prisma.practice.findUniqueOrThrow({
      where: { id: body.practiceId },
      select: { tenantId: true },
    });

    const result = await checkForDuplicates({
      userId,
      tenantId: practice.tenantId,
      identifiers: body.identifiers as never,
    });

    return NextResponse.json(result);
  } catch (e) {
    return errorResponse(e);
  }
}
