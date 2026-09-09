import type { Metadata } from "next";
import { cookies } from "next/headers";
import "./globals.css";
import { loadUxContext } from "@/lib/ux";
import { AppShell } from "@/components/app-shell";

export const metadata: Metadata = {
  title: "BHV Practice Management",
  description: "Practice management for B H Vyas & Co.",
};

/**
 * UX01: the theme is applied on the SERVER, from the user's saved preference,
 * as an attribute on <html>. That is what removes the flash of the wrong theme
 * — there is no client-side correction to see, because the first paint is
 * already right. The alternative (an inline script that reads localStorage) is
 * a blocking script on every page for something the session already knows.
 *
 * SYSTEM sets no attribute at all, which hands the decision to
 * prefers-color-scheme. The stylesheet's dark block is written as
 * `:root:not([data-theme="light"])` so that works in both directions.
 */
export default async function RootLayout({ children }: LayoutProps<"/">) {
  const cookieStore = await cookies();
  const requestedPractice = cookieStore.get("bhv_practice")?.value ?? null;
  const ctx = await loadUxContext(requestedPractice);

  const theme = ctx?.theme ?? "SYSTEM";
  const density = ctx?.density ?? "COMFORTABLE";

  return (
    <html
      lang="en"
      {...(theme === "SYSTEM" ? {} : { "data-theme": theme.toLowerCase() })}
      data-density={density.toLowerCase()}
    >
      <body>
        {ctx ? (
          <AppShell ctx={ctx}>{children}</AppShell>
        ) : (
          // Signed out. No shell, because the shell's identity cues and menu
          // would otherwise describe a practice nobody has proved they can
          // reach.
          <main className="main-region" id="main">
            {children}
          </main>
        )}
      </body>
    </html>
  );
}
