import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Resolve the account's DEFAULT unit — the oldest still-active `unidades`
 * row for the account (migration 040). Write paths that don't (yet) carry
 * an explicit unit use this: the public API v1 (send-to-phone
 * `resolve-conversation` + `POST /api/v1/contacts`) and the manual
 * contact form's management fallback.
 *
 * Per-unit API keys and an explicit unit selector are a later SP2 task —
 * for SP1 these paths target the account's default unit.
 *
 * Throws when the account has no active unit at all. That should never
 * happen post-migration-042, which backfills a "Matriz" unidade for every
 * existing account, so it signals a data-integrity problem (a caller
 * relying on a unit that was never created) rather than a normal state.
 */
export async function getDefaultUnitId(
  db: SupabaseClient,
  accountId: string,
): Promise<string> {
  const { data, error } = await db
    .from('unidades')
    .select('id')
    .eq('account_id', accountId)
    .eq('active', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to resolve default unit for account ${accountId}: ${error.message}`,
    );
  }
  if (!data) {
    throw new Error(
      `Account ${accountId} has no active unidade — every account should ` +
        `have a backfilled Matriz (migration 042). This is a data-integrity bug.`,
    );
  }
  return data.id as string;
}
