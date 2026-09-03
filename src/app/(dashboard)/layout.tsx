import type { Metadata } from "next";
import { DashboardShell } from "./dashboard-shell";
import { getActiveUnitFilter } from "@/lib/units/active-unit";
import type { UnitScopeInitial } from "@/components/units/unit-scope-provider";

// Server layout whose only job is to declare "do not index" metadata
// for the authed app. robots.ts already disallows these paths at the
// crawler-level and middleware redirects unauthenticated visitors, so
// this is belt-and-suspenders — but SEO-critical if a URL ever leaks
// via a link shared externally.
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
    },
  },
};

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Resolve the active-unit scope server-side (cookie + role + visible
  // units) so the topbar selector and the first client paint are
  // already correctly scoped. Middleware redirects unauthenticated
  // users away from these paths, but the layout can still render during
  // a client-side redirect, so degrade to "no scope" rather than throw.
  let unitScope: UnitScopeInitial | null = null;
  try {
    unitScope = await getActiveUnitFilter();
  } catch {
    unitScope = null;
  }

  return <DashboardShell unitScope={unitScope}>{children}</DashboardShell>;
}
