import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/session";
import { badRequest, errorResponse } from "@/lib/api";
import { assertCsrf } from "@/lib/csrf";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const THEMES = ["LIGHT", "DARK", "SYSTEM"] as const;
const DENSITIES = ["COMFORTABLE", "COMPACT"] as const;

/**
 * UX01/UX02 — save the signed-in user's own display preferences.
 *
 * Scoped to the caller by construction: the id comes from the session, and
 * there is no field in this body that names a user. A preference is
 * presentation only, so it is not audited as a sensitive change (SEC04) — but
 * it is still written only for the person who asked for it.
 */
export async function PUT(request: Request) {
  try {
    const userId = await requireUserId();
    await assertCsrf(request);
    const body = await request.json();

    const theme = body.themePreference;
    const density = body.densityPreference;

    if (theme !== undefined && !THEMES.includes(theme)) {
      return badRequest(`themePreference must be one of ${THEMES.join(", ")}`, "BAD_THEME");
    }
    if (density !== undefined && !DENSITIES.includes(density)) {
      return badRequest(`densityPreference must be one of ${DENSITIES.join(", ")}`, "BAD_DENSITY");
    }
    if (theme === undefined && density === undefined) {
      return badRequest("Nothing to change", "NO_CHANGE");
    }

    const saved = await prisma.user.update({
      where: { id: userId },
      data: {
        ...(theme !== undefined ? { themePreference: theme } : {}),
        ...(density !== undefined ? { densityPreference: density } : {}),
      },
      select: { themePreference: true, densityPreference: true },
    });

    return NextResponse.json(saved);
  } catch (e) {
    return errorResponse(e);
  }
}
