import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getCurrentAccount } from "@/lib/auth/account";
import { hasMinRole } from "@/lib/auth/roles";
import { getConsolidatedMetrics } from "@/lib/units/metrics";
import { ConsolidatedView } from "@/components/dashboard/consolidado/consolidated-view";

export const metadata: Metadata = {
  title: "Consolidado",
};

// Consolidated multi-unit management view. Admin+ only — the numbers
// here span every unit in the account, so agents/viewers (who are
// RLS-scoped to their single unit) are redirected to the regular
// dashboard. This mirrors the account-context guard used across the
// app: resolve the caller, redirect on any failure or insufficient
// role rather than rendering an error page (middleware already blocks
// the unauthenticated, so a throw here means a transient/edge state).
export default async function ConsolidadoPage() {
  let ctx: Awaited<ReturnType<typeof getCurrentAccount>> | null = null;
  try {
    ctx = await getCurrentAccount();
  } catch {
    redirect("/dashboard");
  }

  if (!ctx || !hasMinRole(ctx.role, "admin")) {
    redirect("/dashboard");
  }

  // RLS lets admin+ read every unit's rows, so the totals are truly
  // account-wide. Fetched server-side so the first paint is populated.
  const metrics = await getConsolidatedMetrics(ctx.supabase, ctx.accountId);

  return <ConsolidatedView metrics={metrics} accountName={ctx.account.name} />;
}
