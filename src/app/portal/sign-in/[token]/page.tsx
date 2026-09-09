import Link from "next/link";
import { PortalSignIn } from "@/components/portal-sign-in";

export const dynamic = "force-dynamic";

/**
 * POR02: the invitation landing page.
 *
 * Note what is NOT on this page: no client name, no practice name, no contact
 * name, no indication of whether the token is real. An unauthenticated visitor
 * holding a stale or guessed link must learn nothing about who the firm acts
 * for — which is why the identity only appears after the redemption succeeds,
 * on the page this one redirects to.
 *
 * The redemption is a POST from the client rather than work done during this
 * render, because it sets a session cookie and mutates the invitation. A GET
 * that signed you in would be triggerable by any link preview or scanner that
 * happened to fetch the URL — and would burn the single use doing it.
 */
export default async function PortalSignInPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  return (
    <div className="portal-page portal-page--narrow">
      <h1>Sign in</h1>
      <p className="page-lede">
        This is a private document portal. Signing you in from the link you were sent.
      </p>

      <PortalSignIn token={token} />

      <p>
        <Link href="/portal/help">Get help instead</Link>
      </p>
    </div>
  );
}
