import { cookies } from "next/headers";
import { loadUxContext, type UxContext } from "@/lib/ux";
import { can, type Action } from "@/lib/permissions";

/**
 * The scope every screen resolves before it reads anything.
 *
 * Screens call this instead of touching cookies or loadUxContext directly, so
 * that "which practice am I in, and may I read this?" is answered in one place
 * and answered the same way each time. A screen that forgets is a screen that
 * queries unscoped — which is the failure ORG04 and IAM01 exist to prevent, and
 * the one a UI layer is most likely to reintroduce.
 */
export type ScreenContext =
  | { state: "signed-out" }
  | { state: "no-practice"; ctx: UxContext }
  | { state: "denied"; ctx: UxContext; practiceId: string }
  | { state: "ok"; ctx: UxContext; practiceId: string };

export async function screenContext(required?: Action): Promise<ScreenContext> {
  const cookieStore = await cookies();
  const ctx = await loadUxContext(cookieStore.get("bhv_practice")?.value ?? null);

  if (!ctx) return { state: "signed-out" };
  if (!ctx.activePractice || !ctx.membership) return { state: "no-practice", ctx };

  const practiceId = ctx.activePractice.id;

  if (required && !can(ctx.membership, required)) {
    return { state: "denied", ctx, practiceId };
  }
  return { state: "ok", ctx, practiceId };
}
