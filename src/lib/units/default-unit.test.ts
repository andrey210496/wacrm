import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { getDefaultUnitId } from './default-unit';

// ------------------------------------------------------------
// Chainable Supabase stub. Records the `.eq`/`.order` filters so the
// test can assert we selected the account's oldest ACTIVE unit, and
// resolves the terminal `.maybeSingle()` to the scripted result.
// ------------------------------------------------------------
interface Calls {
  table: string;
  eq: [string, unknown][];
  order?: { column: string; ascending?: boolean };
}

function makeDb(result: { data: unknown; error: unknown }): {
  db: SupabaseClient;
  calls: Calls;
} {
  const calls: Calls = { table: '', eq: [] };
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: (col: string, val: unknown) => {
      calls.eq.push([col, val]);
      return builder;
    },
    order: (column: string, opts?: { ascending?: boolean }) => {
      calls.order = { column, ascending: opts?.ascending };
      return builder;
    },
    limit: () => builder,
    maybeSingle: () => Promise.resolve(result),
  };
  const db = {
    from: (t: string) => {
      calls.table = t;
      return builder;
    },
  } as unknown as SupabaseClient;
  return { db, calls };
}

describe('getDefaultUnitId', () => {
  it('returns the oldest active unit id for the account', async () => {
    const { db, calls } = makeDb({ data: { id: 'unit-oldest' }, error: null });

    const id = await getDefaultUnitId(db, 'acct-1');

    expect(id).toBe('unit-oldest');
    expect(calls.table).toBe('unidades');
    expect(calls.eq).toContainEqual(['account_id', 'acct-1']);
    expect(calls.eq).toContainEqual(['active', true]);
    // Oldest-first so the default is stable (matches the backfilled Matriz).
    expect(calls.order).toEqual({ column: 'created_at', ascending: true });
  });

  it('throws when the account has no active unit (data-integrity bug)', async () => {
    const { db } = makeDb({ data: null, error: null });
    await expect(getDefaultUnitId(db, 'acct-empty')).rejects.toThrow(
      /no active unidade/,
    );
  });

  it('throws when the unit lookup errors', async () => {
    const { db } = makeDb({ data: null, error: { message: 'boom' } });
    await expect(getDefaultUnitId(db, 'acct-1')).rejects.toThrow(/boom/);
  });
});
