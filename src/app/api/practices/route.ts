import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAccessiblePracticeIds } from "@/lib/practice-scope";
import { requireUserId } from "@/lib/session";
import { errorResponse } from "@/lib/api";

export const dynamic = "force-dynamic";

/** ORG03: the firm switcher's data source — only practices the user may act in. */
export async function GET() {
  try {
    const userId = await requireUserId();
    const allowed = await getAccessiblePracticeIds(userId);

    const practices = await prisma.practice.findMany({
      where: { id: { in: allowed }, archivedAt: null },
      select: {
        id: true,
        name: true,
        registeredDisplayName: true,
        constitution: true,
        readOnlyFrom: true,
      },
      orderBy: { name: "asc" },
    });

    return NextResponse.json({ practices });
  } catch (e) {
    return errorResponse(e);
  }
}
