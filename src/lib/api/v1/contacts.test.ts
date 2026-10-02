import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  serializeContact,
  findOrCreateContact,
  findOrCreateContactsBulk,
  ContactError,
} from './contacts';

describe('serializeContact', () => {
  it('flattens contact_tags(tags(*)) onto a tags array and nulls missing fields', () => {
    const row = {
      id: 'c1',
      phone: '+14155550123',
      name: 'Jane',
      email: null,
      company: 'Acme',
      avatar_url: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
      contact_tags: [
        { tags: { id: 't1', name: 'vip', color: '#fff' } },
        { tags: null }, // orphaned join — dropped
      ],
    };
    expect(serializeContact(row)).toEqual({
      id: 'c1',
      phone: '+14155550123',
      name: 'Jane',
      email: null,
      company: 'Acme',
      avatar_url: null,
      tags: [{ id: 't1', name: 'vip', color: '#fff' }],
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
    });
  });

  it('tolerates a row with no contact_tags key', () => {
    const row = {
      id: 'c2',
      phone: '+1',
      name: null,
      email: null,
      company: null,
      avatar_url: null,
      created_at: 'a',
      updated_at: 'b',
    };
    expect(serializeContact(row).tags).toEqual([]);
  });
});

describe('findOrCreateContact', () => {
  const noopDb = {} as SupabaseClient;

  it('rejects a non-E.164 phone with a 400 ContactError', async () => {
    await expect(
      findOrCreateContact(noopDb, 'acc', 'user', { phone: 'not-a-number' })
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      findOrCreateContact(noopDb, 'acc', 'user', { phone: 'not-a-number' })
    ).rejects.toBeInstanceOf(ContactError);
  });

  it('stamps the account default unit on a newly created contact', async () => {
    // No per-unit key on the public API (SP1) — the contact targets the
    // account's default unit, and dedup is scoped to it.
    let contactInsert: Record<string, unknown> | undefined;

    const db = {
      from(table: string) {
        if (table === 'unidades') {
          const b: Record<string, unknown> = {
            select: () => b,
            eq: () => b,
            order: () => b,
            limit: () => b,
            maybeSingle: () =>
              Promise.resolve({ data: { id: 'unit-default' }, error: null }),
          };
          return b;
        }
        if (table === 'contacts') {
          const b: Record<string, unknown> = {
            // findExistingContact: select().eq().eq().like() -> miss.
            select: () => b,
            eq: () => b,
            like: () => Promise.resolve({ data: [], error: null }),
            insert: (row: Record<string, unknown>) => {
              contactInsert = row;
              return {
                select: () => ({
                  single: () =>
                    Promise.resolve({ data: { id: 'c-new' }, error: null }),
                }),
              };
            },
          };
          return b;
        }
        throw new Error(`unexpected table: ${table}`);
      },
    } as unknown as SupabaseClient;

    const res = await findOrCreateContact(db, 'acc', 'user', {
      phone: '+14155550123',
    });

    expect(res).toEqual({ id: 'c-new', created: true });
    expect(contactInsert).toMatchObject({
      account_id: 'acc',
      unit_id: 'unit-default',
    });
  });
});

describe('findOrCreateContactsBulk', () => {
  // Mock db: 'unidades' resolves the default unit; 'contacts' answers the
  // bulk lookup (.in on phone_normalized) with `existing`, and the batch
  // insert echoes rows back with a synthetic id + generated phone_normalized.
  function bulkDb(existing: Record<string, string>) {
    const inserted: { phone: string }[] = [];
    let lookups = 0;
    let insertCalls = 0;
    const db = {
      from(table: string) {
        if (table === 'unidades') {
          const b: Record<string, unknown> = {
            select: () => b,
            eq: () => b,
            order: () => b,
            limit: () => b,
            maybeSingle: () =>
              Promise.resolve({ data: { id: 'unit-default' }, error: null }),
          };
          return b;
        }
        if (table === 'contacts') {
          const b: Record<string, unknown> = {
            select: () => b,
            eq: () => b,
            in: (_col: string, keys: string[]) => {
              lookups++;
              return Promise.resolve({
                data: keys
                  .filter((k) => existing[k])
                  .map((k) => ({ id: existing[k], phone_normalized: k })),
                error: null,
              });
            },
            insert: (rows: { phone: string }[]) => {
              insertCalls++;
              inserted.push(...rows);
              return {
                select: () =>
                  Promise.resolve({
                    data: rows.map((r) => ({
                      id: `new-${r.phone.replace(/\D/g, '')}`,
                      phone_normalized: r.phone.replace(/\D/g, ''),
                    })),
                    error: null,
                  }),
              };
            },
          };
          return b;
        }
        throw new Error(`unexpected table: ${table}`);
      },
    } as unknown as SupabaseClient;
    return { db, stats: () => ({ inserted, lookups, insertCalls }) };
  }

  it('reuses existing contacts and creates only the missing ones, keyed by normalized phone', async () => {
    const { db, stats } = bulkDb({ '14155550002': 'c-existing' });

    const map = await findOrCreateContactsBulk(db, 'acc', 'user', [
      '+14155550001',
      '+14155550002',
      '+14155550003',
    ]);

    expect(map.get('14155550002')).toBe('c-existing');
    expect(map.get('14155550001')).toBe('new-14155550001');
    expect(map.get('14155550003')).toBe('new-14155550003');
    // One bulk lookup + one bulk insert — not per-contact round-trips.
    expect(stats().lookups).toBe(1);
    expect(stats().insertCalls).toBe(1);
    expect(stats().inserted).toHaveLength(2);
  });

  it('de-dups by normalized key and drops invalid phones', async () => {
    const { db, stats } = bulkDb({});

    const map = await findOrCreateContactsBulk(db, 'acc', 'user', [
      '+14155550001',
      '+1 (415) 555-0001', // same number, different formatting
      'not-a-number',
      '',
    ]);

    expect(map.size).toBe(1);
    expect(map.get('14155550001')).toBe('new-14155550001');
    expect(stats().inserted).toHaveLength(1); // deduped before insert
  });

  it('returns an empty map when there are no valid phones (no db calls)', async () => {
    const { db, stats } = bulkDb({});
    const map = await findOrCreateContactsBulk(db, 'acc', 'user', [
      'x',
      '',
    ]);
    expect(map.size).toBe(0);
    expect(stats().lookups).toBe(0);
    expect(stats().insertCalls).toBe(0);
  });
});
