// ============================================================
// Server-side unit ("unidade") context — mirrors the account-context
// pattern in `@/lib/auth/account`, but for the unit-scoping layer
// introduced by migrations 040-046.
//
// Visibility rules (migration 041 comment, `can_see_unit`):
//   owner/admin  — see ALL unidades in the account (role >= admin).
//   agent/viewer — see ONLY the single unidade matching their
//                  `profiles.unit_id`. Unassigned (`unit_id === null`)
//                  means they see nothing until an admin assigns one.
//
// Selection (which unit's data is currently "active" in the UI):
//   agent/viewer — forced to their assigned unit; a stray cookie
//                  from before they were reassigned (or from a
//                  shared browser) is ignored.
//   owner/admin  — free to pick any visible unit via a cookie, or
//                  view "all units" (represented as `null`) when no
//                  cookie is set or the cookie no longer names a
//                  visible unit (e.g. it was deleted).
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import { hasMinRole, type AccountRole } from "@/lib/auth/roles";

export interface Unit {
  id: string;
  name: string;
  slug: string;
  active: boolean;
}

/**
 * Minimal profile shape this module needs. Deliberately narrower than
 * the app-wide `Profile` type (`@/types`) so callers can pass either
 * a full profile row or a lightweight `AccountContext`-derived object
 * without an adapter.
 */
export interface UnitScopeProfile {
  account_id: string;
  account_role: AccountRole;
  unit_id: string | null;
}

/**
 * Resolve every unidade the caller is allowed to see.
 *
 * admin+: every unidade in the account, oldest first (stable default
 * ordering — matches `getDefaultUnitId`'s "oldest active unit" pick).
 *
 * agent/viewer: just their assigned unit, or `[]` if unassigned.
 * Fetched (rather than trusting `profile.unit_id` blindly) so a
 * stale/deleted unit_id resolves to "no visible units" instead of a
 * dangling reference.
 */
export async function getVisibleUnits(
  profile: UnitScopeProfile,
  client: SupabaseClient,
): Promise<Unit[]> {
  if (hasMinRole(profile.account_role, "admin")) {
    const { data, error } = await client
      .from("unidades")
      .select("id, name, slug, active")
      .eq("account_id", profile.account_id)
      .order("created_at", { ascending: true });

    if (error) {
      throw new Error(
        `Failed to load units for account ${profile.account_id}: ${error.message}`,
      );
    }
    return (data ?? []) as Unit[];
  }

  if (!profile.unit_id) return [];

  const { data, error } = await client
    .from("unidades")
    .select("id, name, slug, active")
    .eq("id", profile.unit_id)
    .eq("account_id", profile.account_id)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to load assigned unit ${profile.unit_id}: ${error.message}`,
    );
  }
  return data ? [data as Unit] : [];
}

/**
 * Resolve which unit is "selected" right now — the unit whose data
 * the UI should scope to. `null` means "all units" (only reachable
 * by admin+).
 *
 * agent/viewer: always their assigned unit; `cookieValue` is ignored
 * entirely, so a role downgrade or reassignment can't be bypassed by
 * a leftover cookie.
 *
 * admin+: `cookieValue` wins if it names a unit in `visibleUnits`;
 * anything else (no cookie, a deleted/foreign unit id) falls back to
 * `null` ("all units").
 */
export function getSelectedUnitId(
  profile: UnitScopeProfile,
  cookieValue: string | null | undefined,
  visibleUnits: Unit[],
): string | null {
  if (!hasMinRole(profile.account_role, "admin")) {
    return profile.unit_id ?? null;
  }

  if (cookieValue && visibleUnits.some((u) => u.id === cookieValue)) {
    return cookieValue;
  }

  return null;
}
