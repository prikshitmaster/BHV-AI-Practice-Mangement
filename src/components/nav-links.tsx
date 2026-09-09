"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { NavItem } from "@/lib/ux";

/**
 * NAV01/NAV02 menu rendering.
 *
 * `aria-current="page"` is set from the live pathname, and the stylesheet
 * keys the active appearance off that same attribute — so the visual state
 * and the announced state cannot drift apart. A sighted user and a screen
 * reader user are told the same thing by the same fact.
 *
 * The list itself is decided server-side in buildNav() from the permission
 * engine. This component only draws it: it never filters, because a menu that
 * hides what the server would allow (or shows what it would refuse) is how the
 * UI and the authority get out of step.
 */
export function NavLinks({ items, label }: { items: NavItem[]; label?: string }) {
  const pathname = usePathname();

  return (
    <ul className="nav-list" aria-label={label}>
      {items.map((item) => (
        <li key={item.href}>
          <Link
            className="nav-link"
            href={item.href}
            aria-current={isCurrent(pathname, item.href) ? "page" : undefined}
          >
            {item.label}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function isCurrent(path: string, href: string): boolean {
  if (href === "/") return path === "/";
  return path === href || path.startsWith(`${href}/`);
}
