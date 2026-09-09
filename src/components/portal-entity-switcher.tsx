"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { PortalEntity } from "@/lib/portal";

/**
 * POR02's "visible entity switcher".
 *
 * The acceptance evidence is "a group CFO switches between two approved client
 * entities and cannot see a third", so two properties matter here:
 *
 *   - the list is exactly what the server returned from live ContactAuthority,
 *     and this component never filters or extends it;
 *   - switching is a NAVIGATION, not a client-side state change. The next
 *     screen is fetched under the new entity and re-checked server-side, so a
 *     revoked grant takes effect on the switch rather than after a refresh.
 *
 * With a single entity there is nothing to switch between, but the entity is
 * still named — a client acting for one company should still see which company
 * they are looking at.
 */
export function PortalEntitySwitcher({
  entities,
  activeId,
}: {
  entities: PortalEntity[];
  activeId: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  if (entities.length <= 1) {
    return (
      <p className="portal-entity-single">
        <span className="visually-hidden">Viewing</span>
        <strong>{entities[0]?.legalName ?? "No entity"}</strong>
      </p>
    );
  }

  return (
    <div className="field portal-switcher">
      <label className="field-label" htmlFor="portal-entity">
        Viewing
      </label>
      <select
        id="portal-entity"
        className="field-input"
        value={activeId}
        disabled={pending}
        onChange={(e) => {
          setPending(true);
          router.push(`/portal?entity=${encodeURIComponent(e.target.value)}`);
        }}
      >
        {entities.map((entity) => (
          <option key={entity.clientRelationshipId} value={entity.clientRelationshipId}>
            {entity.legalName}
          </option>
        ))}
      </select>
      <p className="field-hint">
        You act for {entities.length} entities. Everything on this page belongs to the one selected.
      </p>
    </div>
  );
}
