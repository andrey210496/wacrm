import { describe, it, expect, vi } from 'vitest';
import { createBroadcastQueued } from './broadcast-queue';
import type { SupabaseClient } from '@supabase/supabase-js';

function makeDb(recipientInsertError: unknown = null) {
  const calls = { recipientBatches: 0, broadcastUpdatedFailed: false };
  const db = {
    from(table: string) {
      if (table === 'broadcasts') {
        return {
          insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: { id: 'b1' }, error: null }) }) }),
          update: (row: Record<string, unknown>) => ({ eq: () => { if (row.status === 'failed') calls.broadcastUpdatedFailed = true; return Promise.resolve({ error: null }); } }),
        };
      }
      if (table === 'broadcast_recipients') {
        return { insert: () => { calls.recipientBatches++; return Promise.resolve({ error: recipientInsertError }); } };
      }
      throw new Error(`unexpected ${table}`);
    },
  } as unknown as SupabaseClient;
  return { db, calls };
}

describe('createBroadcastQueued', () => {
  it('cria broadcast + insere destinatários pending em blocos, retorna id/total', async () => {
    const { db, calls } = makeDb();
    const recipients = Array.from({ length: 250 }, (_, i) => ({ contactId: `c${i}`, phone: `+1555${i}`, params: [] as string[] }));
    const r = await createBroadcastQueued(db, 'acc', 'user', {
      name: 'promo', unitId: 'u1', templateName: 't', templateLanguage: 'pt_BR', variables: {}, audience: { type: 'all' }, recipients,
    });
    expect(r.broadcastId).toBe('b1');
    expect(r.total).toBe(250);
    expect(calls.recipientBatches).toBe(2); // 200 + 50
    expect(calls.broadcastUpdatedFailed).toBe(false);
  });

  it('erro em bloco de destinatários marca o broadcast failed e lança', async () => {
    const { db, calls } = makeDb({ message: 'insert boom' });
    const recipients = [{ contactId: 'c1', phone: '+1', params: [] as string[] }];
    await expect(createBroadcastQueued(db, 'acc', 'user', {
      name: 'promo', unitId: 'u1', templateName: 't', templateLanguage: 'pt_BR', variables: {}, audience: { type: 'all' }, recipients,
    })).rejects.toThrow(/insert boom|recipient/i);
    expect(calls.broadcastUpdatedFailed).toBe(true);
  });

  it('dedup por contactId', async () => {
    const { db } = makeDb();
    const r = await createBroadcastQueued(db, 'acc', 'user', {
      name: 'x', unitId: 'u1', templateName: 't', templateLanguage: 'pt_BR', variables: {}, audience: { type: 'all' },
      recipients: [{ contactId: 'c1', phone: '+1', params: [] }, { contactId: 'c1', phone: '+1', params: [] }],
    });
    expect(r.total).toBe(1);
  });
});
