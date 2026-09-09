/**
 * Shared API-route plumbing.
 *
 * Turns scope/auth failures into responses that leak nothing: a practice the
 * caller may not see returns 404, never 403, so the response cannot be used to
 * prove that a Company record exists.
 */

import { NextResponse } from "next/server";
import { PracticeAccessError } from "@/lib/practice-scope";
import { UnauthenticatedError } from "@/lib/session";

export function errorResponse(e: unknown): NextResponse {
  if (e instanceof UnauthenticatedError) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  if (e instanceof PracticeAccessError) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  console.error("Unhandled API error:", e);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

/** Wraps a route handler so every scope/auth failure is handled identically. */
export function route<T>(handler: () => Promise<T>) {
  return async (): Promise<NextResponse> => {
    try {
      return NextResponse.json(await handler());
    } catch (e) {
      return errorResponse(e);
    }
  };
}
