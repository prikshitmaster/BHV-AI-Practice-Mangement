import { NextResponse } from "next/server";
import { apiError, errorResponse } from "@/lib/api";
import { requirePortalContact } from "@/lib/portal-session";
import { listPortalEntities, loadPortalHome } from "@/lib/portal";

export const dynamic = "force-dynamic";

/**
 * POR01 portal home for one entity.
 *
 * `entity` is a REQUEST, never an assertion of authority: `loadPortalHome`
 * checks it against live ContactAuthority and throws 404 for anything the
 * contact may not reach. This is the same rule NAV03 applies to a staff deep
 * link into the wrong practice — the switch does not happen, and nothing is
 * read under the requested scope.
 */
export async function GET(request: Request) {
  try {
    const actor = await requirePortalContact();
    const requested = new URL(request.url).searchParams.get("entity");

    const entities = await listPortalEntities({
      contactId: actor.contactId,
      practiceId: actor.practiceId,
    });
    if (entities.length === 0) {
      return apiError(404, "NO_ENTITIES", "Not found");
    }

    // An unrecognised entity id falls back to the first the contact holds,
    // rather than 404ing the whole screen — the same "reject safely, don't
    // switch authority" behaviour the staff shell has.
    const active =
      entities.find((e) => e.clientRelationshipId === requested) ?? entities[0];

    const home = await loadPortalHome({
      contactId: actor.contactId,
      practiceId: actor.practiceId,
      clientRelationshipId: active.clientRelationshipId,
    });

    return NextResponse.json(home);
  } catch (e) {
    return errorResponse(e);
  }
}
