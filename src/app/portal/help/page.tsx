import Link from "next/link";
import { optionalPortalContact } from "@/lib/portal-session";
import { listSupportContacts } from "@/lib/portal";
import { PortalRenewalForm } from "@/components/portal-renewal-form";

export const dynamic = "force-dynamic";

/**
 * POR05 — accessibility, support and recovery.
 *
 * "Clear recovery for expired links, missing permissions and interrupted
 * uploads. Provide a call / message route using verified firm contact details
 * configured by the owner."
 *
 * The page is deliberately usable in both states. Signed in, it names the
 * firm's verified support route. Signed OUT, it shows no firm details at all —
 * an unauthenticated visitor must not be able to learn which practice a link
 * belonged to — and offers the one safe action instead: paste the dead link and
 * ask for a new one.
 */
export default async function PortalHelpPage() {
  const actor = await optionalPortalContact();
  const support = actor ? await listSupportContacts(actor.practiceId) : [];

  return (
    <div className="portal-page portal-page--narrow">
      <h1>Help</h1>

      {actor ? (
        <section aria-labelledby="portal-contact-heading">
          <h2 id="portal-contact-heading">Contact the team</h2>
          {support.length === 0 ? (
            // A support number nobody has verified is worse than none — it
            // sends a client with a real problem somewhere unknown. So an
            // unverified row is withheld and this says so plainly.
            <p>
              No contact route has been published here yet. Reply to the email the team last sent
              you and it will reach them.
            </p>
          ) : (
            <ul className="portal-items">
              {support.map((c) => (
                <li key={`${c.label}-${c.phone ?? c.email ?? c.helpUrl}`}>
                  <strong>{c.label}</strong>
                  {c.hoursLabel ? <p className="muted">{c.hoursLabel}</p> : null}
                  <ul className="portal-contact-routes">
                    {c.phone ? (
                      <li>
                        <a href={`tel:${c.phone.replace(/\s+/g, "")}`}>{c.phone}</a>
                      </li>
                    ) : null}
                    {c.email ? (
                      <li>
                        <a href={`mailto:${c.email}`}>{c.email}</a>
                      </li>
                    ) : null}
                    {c.helpUrl ? (
                      <li>
                        <a href={c.helpUrl}>Help pages</a>
                      </li>
                    ) : null}
                  </ul>
                </li>
              ))}
            </ul>
          )}
          <p>
            <Link href="/portal">Back to your documents</Link>
          </p>
        </section>
      ) : null}

      <section aria-labelledby="portal-link-heading">
        <h2 id="portal-link-heading">Your sign-in link has expired</h2>
        <p>
          Sign-in links can only be used once, and they stop working after a while. Paste the link
          you were sent and we&rsquo;ll ask the team to send a fresh one to the contact details they
          hold for you.
        </p>
        <PortalRenewalForm />
      </section>

      <section aria-labelledby="portal-upload-help-heading">
        <h2 id="portal-upload-help-heading">An upload stopped part way</h2>
        <p>
          Nothing is lost. Open the same request again, choose the same file, and the upload carries
          on from where it stopped — it will not send a second copy of what we already have.
        </p>
      </section>

      <section aria-labelledby="portal-access-heading">
        <h2 id="portal-access-heading">You can&rsquo;t see something you expected</h2>
        <p>
          You&rsquo;ll only see the entities you have been given access to. If a company is missing,
          ask the team to add it — for everyone&rsquo;s protection we can&rsquo;t confirm over this
          page whether a particular company exists on our records.
        </p>
      </section>
    </div>
  );
}
