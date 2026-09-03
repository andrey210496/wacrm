import type { SupabaseClient } from '@supabase/supabase-js';
import { getDefaultUnitId } from './default-unit';

/**
 * Resolve the unit a *new operational record that belongs to the
 * operator* (broadcast / automation / flow) should be stamped with —
 * as opposed to a record that belongs to a specific contact (a deal),
 * which takes the contact's unit instead.
 *
 * Migration 043 made `unit_id` NOT NULL on these tables, and the RLS
 * INSERT policies require `can_see_unit(account_id, unit_id)`, so every
 * insert must carry a unit the caller can actually see.
 *
 * Resolution order (first non-null wins):
 *   1. `selectedUnitId` — the topbar unit selection from `useUnitScope()`.
 *      For an agent/viewer this is forced to their assigned unit, so it
 *      already satisfies `can_see_unit` on a client (RLS-scoped) insert.
 *      `null` means the admin "all units" view, or a server route with
 *      no client context.
 *   2. The caller's own `profiles.unit_id` — a sensible home unit for an
 *      admin viewing "all", and the only visible unit for an assigned
 *      member.
 *   3. `getDefaultUnitId` — the account's oldest active unit, as a last
 *      resort when the caller has no assigned unit (e.g. an owner who was
 *      never pinned to a unidade).
 *
 * Works with either the browser client or the SSR / service-role client;
 * server routes pass `selectedUnitId = null` since they have no topbar
 * context.
 */
export async function resolveOperatorUnitId(
  db: SupabaseClient,
  accountId: string,
  userId: string,
  selectedUnitId: string | null = null,
): Promise<string> {
  if (selectedUnitId) return selectedUnitId;

  const { data: profile } = await db
    .from('profiles')
    .select('unit_id')
    .eq('user_id', userId)
    .maybeSingle();
  const profileUnitId = (profile?.unit_id as string | null | undefined) ?? null;
  if (profileUnitId) return profileUnitId;

  return getDefaultUnitId(db, accountId);
}
