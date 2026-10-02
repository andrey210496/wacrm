import { describe, it, expect, vi } from 'vitest';
import { createBroadcastQueued } from './broadcast-queue';
import type { SupabaseClient } from '@supabase/supabase-js';
import { runDrainPass } from './broadcast-queue';
import * as resume from '@/lib/whatsapp/broadcast-resume';
import * as core from '@/lib/whatsapp/broadcast-core';

function makeDb(recipientInsertError: unknown = null) {
  const calls = {
    recipientBatches: 0,
    broadcastUpdatedFailed: false,
    broadcastInsert: undefined as Record<string, unknown> | undefined,
  };
  const db = {
    from(table: string) {
      if (table === 'broadcasts') {
        return {
          insert: (row: Record<string, unknown>) => { calls.broadcastInsert = row; return { select: () => ({ single: () => Promise.resolve({ data: { id: 'b1' }, error: null }) }) }; },
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

  it('persiste header_media_url quando fornecido', async () => {
    const { db, calls } = makeDb();
    await createBroadcastQueued(db, 'acc', 'user', {
      name: 'promo', unitId: 'u1', templateName: 't', templateLanguage: 'pt_BR', variables: {}, audience: { type: 'all' },
      recipients: [{ contactId: 'c1', phone: '+1', params: [] }],
      headerMediaUrl: 'https://cdn.example.com/promo.jpg',
    });
    expect(calls.broadcastInsert?.header_media_url).toBe('https://cdn.example.com/promo.jpg');
  });

  it('grava header_media_url null quando ausente (não undefined)', async () => {
    const { db, calls } = makeDb();
    await createBroadcastQueued(db, 'acc', 'user', {
      name: 'promo', unitId: 'u1', templateName: 't', templateLanguage: 'pt_BR', variables: {}, audience: { type: 'all' },
      recipients: [{ contactId: 'c1', phone: '+1', params: [] }],
    });
    expect(calls.broadcastInsert).toHaveProperty('header_media_url', null);
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

describe('runDrainPass', () => {
  it('pula quando não consegue o lock', async () => {
    vi.spyOn(resume, 'claimBroadcastDelivery').mockResolvedValue(false);
    const r = await runDrainPass({} as never, 'acc', 'b1');
    expect(r.skipped).toBe(true);
  });

  it('claim ok: planeja pending, entrega, finaliza e libera', async () => {
    vi.spyOn(resume, 'claimBroadcastDelivery').mockResolvedValue(true);
    const plan = { broadcastId: 'b1', planned: [{ recipientRowId: 'r1', phone: '1', params: [] }] } as never;
    const planSpy = vi.spyOn(resume, 'planBroadcastResume').mockResolvedValue({ plan, remaining: 0, unsendable: 0 } as never);
    vi.spyOn(resume, 'markBroadcastSending').mockResolvedValue(undefined as never);
    const deliverSpy = vi.spyOn(core, 'deliverBroadcast').mockResolvedValue(undefined);
    const finalizeSpy = vi.spyOn(core, 'finalizeBroadcastStatus').mockResolvedValue(undefined);
    const releaseSpy = vi.spyOn(resume, 'releaseBroadcastDelivery').mockResolvedValue(undefined);
    const r = await runDrainPass({} as never, 'acc', 'b1');
    expect(planSpy).toHaveBeenCalledWith(expect.anything(), 'acc', 'b1', 'pending');
    expect(deliverSpy).toHaveBeenCalled();
    expect(finalizeSpy).toHaveBeenCalled();
    expect(releaseSpy).toHaveBeenCalled();
    expect(r.skipped).toBe(false);
    expect(r.remaining).toBe(0);
  });

  it('sem pending (plan lança): finaliza e libera mesmo assim', async () => {
    vi.spyOn(resume, 'claimBroadcastDelivery').mockResolvedValue(true);
    vi.spyOn(resume, 'planBroadcastResume').mockRejectedValue(new Error('nothing to resume'));
    const finalizeSpy = vi.spyOn(core, 'finalizeBroadcastStatus').mockResolvedValue(undefined);
    const releaseSpy = vi.spyOn(resume, 'releaseBroadcastDelivery').mockResolvedValue(undefined);
    const r = await runDrainPass({} as never, 'acc', 'b1');
    expect(finalizeSpy).toHaveBeenCalled();
    expect(releaseSpy).toHaveBeenCalled();
    expect(r.skipped).toBe(false);
  });
});
