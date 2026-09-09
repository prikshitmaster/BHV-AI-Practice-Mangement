/**
 * The single client-side path for mutating requests.
 *
 * SEC03's double submit only works if every mutating fetch echoes the raw
 * token in the header. Leaving that to each call site is how one of them
 * quietly forgets and someone "fixes" it by relaxing the guard — so there is
 * one helper, and components use it rather than calling fetch directly.
 */

// csrf-shared, not csrf: that one imports next/headers and node:crypto, which
// cannot be bundled for the browser.
import { CSRF_HEADER, CSRF_RAW_COOKIE } from "@/lib/csrf-shared";

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(
    new RegExp(`(?:^|; )${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=([^;]*)`),
  );
  return match ? decodeURIComponent(match[1]) : null;
}

/** fetch() with the CSRF header attached. Same signature otherwise. */
export async function mutate(input: string, init: RequestInit = {}): Promise<Response> {
  const token = readCookie(CSRF_RAW_COOKIE);
  const headers = new Headers(init.headers);
  if (token) headers.set(CSRF_HEADER, token);
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  return fetch(input, { ...init, headers, credentials: "same-origin" });
}
