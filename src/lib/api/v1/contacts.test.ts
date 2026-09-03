import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  serializeContact,
  findOrCreateContact,
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
