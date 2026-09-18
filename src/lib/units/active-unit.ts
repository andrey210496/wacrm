// ============================================================
// Request-scoped active-unit resolver — the one place that wires the
// account context, the caller's profile, the visibility rules
// (`context.ts`) and the `unidade` cookie together into the filter a
// page/topbar needs.
//
// SERVER-ONLY. It imports `next/headers` (cookies) and the Supabase
// SSR client (transitively, via `getCurrentAccount`), so it must never
// be imported from a client component — doing so is the classic
// RSC/pg bundle leak. Client components read the same selection from
// the `UnitScopeProvider` context instead.
// ============================================================

import { cookies } from "next/headers";

import { getCurrentAccount } from "@/lib/auth/account";
import { hasMinRole } from "@/lib/auth/roles";

import {
  getSelectedUnitId,
  getVisibleUnits,
  type Unit,
  type UnitScopeProfile,
} from "./context";
import { UNIT_COOKIE } from "./cookie";

export interface ActiveUnitFilter {
  /**
   * Unit whose data the UI should scope to right now. `null` means
   * "all units" — only ever reachable by admin+ (agents/viewers are
   * pinned to their assigned unit by `getSelectedUnitId`).
   */
  selectedUnitId: string | null;
  /** Every unit the caller may see (drives the selector's options). */
  visibleUnits: Unit[];
  /** True for admin+ — they get the "Todas as unidades" option. */
  canSeeAll: boolean;
}

/**
 * Resolve the active unit filter for the current request from the
 * caller's account + profile + the `unidade` cookie. Call this once
 * per request (topbar, or a list page) rather than duplicating the
 * cookie/visibility wiring.
 *
 * Propagates `UnauthorizedError` / `ForbiddenError` from
 * `getCurrentAccount` — callers rendering in a context where the user
 * may not be resolvable yet (e.g. the dashboard layout during a client
 * redirect) should guard with try/catch.
 */
export async function getActiveUnitFilter(): Promise<ActiveUnitFilter> {
  const { supabase, userId, accountId, role } = await getCurrentAccount();

  // `getCurrentAccount` intentionally doesn't select `unit_id`; pull it
  // here so agents/viewers resolve to their pinned unit.
  const { data: prof, error } = await supabase
    .from("profiles")
    .select("unit_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to load unit scope for user ${userId}: ${error.message}`,
    );
  }

  const profile: UnitScopeProfile = {
    account_id: accountId,
    account_role: role,
    unit_id: (prof?.unit_id as string | null | undefined) ?? null,
  };

  const visibleUnits = await getVisibleUnits(profile, supabase);

  const cookieStore = await cookies();
  const cookieValue = cookieStore.get(UNIT_COOKIE)?.value ?? null;
  const selectedUnitId = getSelectedUnitId(profile, cookieValue, visibleUnits);

  return {
    selectedUnitId,
    visibleUnits,
    canSeeAll: hasMinRole(role, "admin"),
  };
}
