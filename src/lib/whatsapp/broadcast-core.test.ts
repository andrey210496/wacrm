import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  createBroadcast,
  deliverBroadcast,
  finalizeBroadcastStatus,
  BroadcastError,
  type BroadcastPlan,
} from './broadcast-core';

vi.mock('@/lib/whatsapp/meta-api', () => ({
  sendTemplateMessage: vi.fn(async () => ({ messageId: 'wamid.1' })),
}));

// Contact resolution and token decryption are exercised elsewhere — stub
// them so these tests focus on the persistence boundary.
vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: () => 'plain-access-token',
}));
// Bulk contact resolution is exercised in contacts.test.ts — stub it here so
// these tests focus on the persistence boundary. Returns a Map keyed by the
// normalized phone key (digits only), as the real helper does.
vi.mock('@/lib/api/v1/contacts', () => ({
  findOrCreateContactsBulk: vi.fn(async (_db, _acc, _user, phones: string[]) => {
    const map = new Map<string, string>();
    for (const p of phones) map.set(p.replace(/\D/g, ''), 'c1');
    return map;
  }),
}));

// These assertions all fire in the pure validation prologue, before
// any Supabase call — a bare stub is enough.
const db = {} as SupabaseClient;

describe('createBroadcast validation', () => {
  it('rejects a missing template_name', async () => {
    await expect(
      createBroadcast(db, 'acc', 'user', {
        templateName: '',
        recipients: [{ to: '+14155550123' }],
        unitId: 'unit-1',
      })
    ).rejects.toMatchObject({ code: 'bad_request', status: 400 });
  });

  it('rejects an empty recipient list', async () => {
    await expect(
      createBroadcast(db, 'acc', 'user', {
        templateName: 'promo',
        recipients: [],
        unitId: 'unit-1',
      })
    ).rejects.toBeInstanceOf(BroadcastError);
  });

  it('rejects more than 1000 recipients', async () => {
    const recipients = Array.from({ length: 1001 }, () => ({
      to: '+14155550123',
    }));
    await expect(
      createBroadcast(db, 'acc', 'user', {
        templateName: 'promo',
        recipients,
        unitId: 'unit-1',
      })
    ).rejects.toMatchObject({ status: 400 });
  });
});

// Build a Supabase-shaped mock that gets createBroadcast past its config +
// template lookups and into persistence. `rpcResult` is what the atomic
// create_broadcast_with_recipients RPC returns.
function makeDb(rpcResult: { data: unknown; error: unknown }) {
  const calls = {
    rpc: [] as { name: string; args: unknown }[],
    // Incremented if the OLD non-atomic path (a direct broadcasts /
    // broadcast_recipients insert) is ever reached — it must not be.
    usedDirectInsert: 0,
    // Filters applied to the whatsapp_config lookup — proves per-unit scoping.
    configFilters: {} as Record<string, unknown>,
  };
  const database = {
    from(table: string) {
      if (table === 'whatsapp_config') {
        // select().eq('account_id').eq('unit_id').limit(1).single() — the
        // config is now resolved by the broadcast's unit (migration 042).
        const chain: Record<string, unknown> = {
          select: () => chain,
          eq: (col: string, val: unknown) => {
            calls.configFilters[col] = val;
            return chain;
          },
          limit: () => chain,
          single: () =>
            Promise.resolve({
              data: { phone_number_id: 'pn-1', access_token: 'enc' },
              error: null,
            }),
        };
        return chain;
      }
      if (table === 'message_templates') {
        const chain: Record<string, unknown> = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
        };
        return chain;
      }
      if (table === 'broadcasts' || table === 'broadcast_recipients') {
        calls.usedDirectInsert++;
        return {
          insert: () => ({
            select: () => ({
              single: () =>
                Promise.resolve({ data: { id: 'orphan' }, error: null }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
    rpc(name: string, args: unknown) {
      calls.rpc.push({ name, args });
      return Promise.resolve(rpcResult);
    },
  } as unknown as SupabaseClient;
  return { db: database, calls };
}

describe('createBroadcast atomicity (#370)', () => {
  it('creates parent + recipients through the atomic RPC, never a bare parent insert', async () => {
    const { db, calls } = makeDb({
      data: [{ broadcast_id: 'b-1', recipient_id: 'r-1', contact_id: 'c1' }],
      error: null,
    });

    const plan = await createBroadcast(db, 'acc', 'user', {
      templateName: 'promo',
      recipients: [{ to: '+14155550123' }],
      unitId: 'unit-1',
    });

    expect(calls.rpc).toHaveLength(1);
    expect(calls.rpc[0].name).toBe('create_broadcast_with_recipients');
    expect(calls.rpc[0].args).toMatchObject({ p_unit_id: 'unit-1' });
    // The send config is resolved by the broadcast's unit, so every
    // recipient goes out from that unit's WhatsApp number.
    expect(calls.configFilters).toMatchObject({
      account_id: 'acc',
      unit_id: 'unit-1',
    });
    expect(calls.usedDirectInsert).toBe(0);
    expect(plan.broadcastId).toBe('b-1');
    expect(plan.planned).toEqual([
      { recipientRowId: 'r-1', phone: '14155550123', params: [] },
    ]);
  });

  it('throws and leaves no orphaned parent when the atomic create fails', async () => {
    const { db, calls } = makeDb({
      data: null,
      error: { message: 'recipient insert failed' },
    });

    await expect(
      createBroadcast(db, 'acc', 'user', {
        templateName: 'promo',
        recipients: [{ to: '+14155550123' }],
        unitId: 'unit-1',
      })
    ).rejects.toBeInstanceOf(BroadcastError);

    // The RPC was the only persistence attempt; because it runs both
    // inserts in a single transaction, its failure rolls the parent back —
    // there is no separate parent insert that could survive as an orphan.
    expect(calls.rpc).toHaveLength(1);
    expect(calls.usedDirectInsert).toBe(0);
  });
});

// ============================================================
// deliverBroadcast — media header (onda 3, opção A). The per-broadcast
// header media URL must reach Meta via messageParams, and the drain
// path relies on it being read straight off the plan.
// ============================================================

/** Minimal Supabase-shaped mock: recipient-row updates + the count
 *  queries finalizeBroadcastStatus runs, all resolvable via `then`. */
function deliverDb(): SupabaseClient {
  return {
    from() {
      let status: string | null = null;
      const b: Record<string, unknown> = {
        select: () => b,
        update: () => b,
        eq: (col: string, val: unknown) => {
          if (col === 'status') status = val as string;
          return b;
        },
        then: (resolve: (r: { count: number; error: null }) => unknown) =>
          resolve({ count: status === 'pending' ? 0 : 0, error: null }),
      };
      return b;
    },
  } as unknown as SupabaseClient;
}

function basePlan(overrides: Partial<BroadcastPlan> = {}): BroadcastPlan {
  return {
    broadcastId: 'b1',
    templateName: 't',
    templateLanguage: 'pt_BR',
    phoneNumberId: 'pn',
    accessToken: 'tok',
    templateRow: null,
    planned: [{ recipientRowId: 'r1', phone: '5511999999999', params: ['X'] }],
    rejected: 0,
    ...overrides,
  };
}

describe('deliverBroadcast media header', () => {
  it('repassa o headerMediaUrl do plano ao sendTemplateMessage', async () => {
    const { sendTemplateMessage } = await import('@/lib/whatsapp/meta-api');
    const spy = vi.mocked(sendTemplateMessage);
    spy.mockClear();

    await deliverBroadcast(
      deliverDb(),
      basePlan({ headerMediaUrl: 'https://cdn.example.com/promo.jpg' }),
    );

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0].messageParams).toMatchObject({
      headerMediaUrl: 'https://cdn.example.com/promo.jpg',
    });
  });

  it('não passa messageParams quando a campanha não tem mídia', async () => {
    const { sendTemplateMessage } = await import('@/lib/whatsapp/meta-api');
    const spy = vi.mocked(sendTemplateMessage);
    spy.mockClear();

    await deliverBroadcast(deliverDb(), basePlan());

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0].messageParams).toBeUndefined();
  });
});

// ============================================================
// Terminal status (#472). Derived from the recipient rows, not from a
// counter local to one delivery pass — a resume only sends the
// leftovers, so "nothing sent this pass" must not condemn a campaign
// that already delivered hundreds.
// ============================================================

function statusDb(
  counts: Record<string, number>,
  total: number,
  writes: { update?: Record<string, unknown> },
) {
  return {
    from(table: string) {
      let status: string | null = null;
      const b: Record<string, unknown> = {
        select: () => b,
        eq: (col: string, val: unknown) => {
          if (col === 'status') status = val as string;
          return b;
        },
        update: (row: Record<string, unknown>) => {
          if (table === 'broadcasts') writes.update = row;
          return b;
        },
        then: (resolve: (r: { count: number; error: null }) => unknown) =>
          resolve({
            count: status === null ? total : (counts[status] ?? 0),
            error: null,
          }),
      };
      return b;
    },
  } as unknown as SupabaseClient;
}

describe('finalizeBroadcastStatus', () => {
  it('leaves a capped pass in "sending" while recipients are still pending', async () => {
    const writes: { update?: Record<string, unknown> } = {};
    await finalizeBroadcastStatus(statusDb({ pending: 25 }, 1025, writes), 'b-1');
    // No write at all — the UI keeps offering Resume.
    expect(writes.update).toBeUndefined();
  });

  it('marks a fully-failed broadcast failed', async () => {
    const writes: { update?: Record<string, unknown> } = {};
    await finalizeBroadcastStatus(
      statusDb({ pending: 0, failed: 10 }, 10, writes),
      'b-1',
    );
    expect(writes.update?.status).toBe('failed');
  });

  it('marks a partially-failed broadcast sent', async () => {
    const writes: { update?: Record<string, unknown> } = {};
    await finalizeBroadcastStatus(
      statusDb({ pending: 0, failed: 3 }, 10, writes),
      'b-1',
    );
    // 7 people got the message; failed_count carries the other 3.
    expect(writes.update?.status).toBe('sent');
  });

  it('does not condemn a campaign whose resume pass sent nothing new', async () => {
    const writes: { update?: Record<string, unknown> } = {};
    // 800 delivered on the original pass, the 200-recipient resume all
    // failed. Pre-fix this wrote 'failed' off a pass-local counter.
    await finalizeBroadcastStatus(
      statusDb({ pending: 0, failed: 200 }, 1000, writes),
      'b-1',
    );
    expect(writes.update?.status).toBe('sent');
  });
});
