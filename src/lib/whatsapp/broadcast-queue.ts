// ============================================================
// Fila de broadcast: cria o broadcast + destinatários (pending) SEM o teto
// de 1000 (o cap é por PASSE de entrega, não por campanha).
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  claimBroadcastDelivery,
  releaseBroadcastDelivery,
  markBroadcastSending,
  planBroadcastResume,
} from '@/lib/whatsapp/broadcast-resume';
import { deliverBroadcast, finalizeBroadcastStatus } from '@/lib/whatsapp/broadcast-core';

const INSERT_BATCH_SIZE = 200;

export interface QueuedRecipient { contactId: string; phone: string; params: string[] }

export interface CreateBroadcastQueuedInput {
  name: string;
  unitId: string;
  templateName: string;
  templateLanguage: string;
  variables: Record<string, unknown>;
  audience: Record<string, unknown>;
  recipients: QueuedRecipient[];
  /**
   * Media URL for an IMAGE/VIDEO/DOCUMENT header. Persisted on the
   * campaign so BOTH the initial dispatch pass and the drain cron
   * (which rebuilds the plan from the DB) send the header — see
   * planBroadcastResume + deliverBroadcast.
   */
  headerMediaUrl?: string;
}

/** Cria o broadcast e insere TODOS os destinatários (pending) em blocos.
 *  Failsafe: erro num bloco marca o broadcast failed e lança. */
export async function createBroadcastQueued(
  db: SupabaseClient,
  accountId: string,
  auditUserId: string,
  input: CreateBroadcastQueuedInput,
): Promise<{ broadcastId: string; total: number }> {
  // Dedup por contactId (mesmo contato listado 2x / CSV+base).
  const seen = new Set<string>();
  const deduped = input.recipients.filter((r) => {
    if (seen.has(r.contactId)) return false;
    seen.add(r.contactId);
    return true;
  });
  if (deduped.length === 0) throw new Error('No recipients to queue');

  const { data: broadcast, error: bcErr } = await db
    .from('broadcasts')
    .insert({
      user_id: auditUserId,
      account_id: accountId,
      unit_id: input.unitId,
      name: input.name,
      template_name: input.templateName,
      template_language: input.templateLanguage,
      template_variables: input.variables,
      audience_filter: input.audience,
      header_media_url: input.headerMediaUrl ?? null,
      status: 'sending',
      total_recipients: deduped.length,
      sent_count: 0,
      delivered_count: 0,
      read_count: 0,
      replied_count: 0,
      failed_count: 0,
    })
    .select()
    .single();
  if (bcErr || !broadcast) throw new Error(`Failed to create broadcast: ${bcErr?.message ?? 'unknown'}`);

  const rows = deduped.map((r) => ({
    broadcast_id: broadcast.id,
    contact_id: r.contactId,
    status: 'pending' as const,
    template_params: r.params,
  }));
  for (let i = 0; i < rows.length; i += INSERT_BATCH_SIZE) {
    const batch = rows.slice(i, i + INSERT_BATCH_SIZE);
    const { error } = await db.from('broadcast_recipients').insert(batch);
    if (error) {
      await db.from('broadcasts').update({ status: 'failed', failed_count: deduped.length }).eq('id', broadcast.id);
      throw new Error(`Failed to insert recipient batch ${i / INSERT_BATCH_SIZE + 1}: ${error.message}`);
    }
  }
  return { broadcastId: broadcast.id, total: deduped.length };
}

/** Roda UM passe de entrega de um broadcast: claim → plan(pending) → deliver →
 *  finalize → release. Best-effort, nunca lança. O claim-lock garante que dois
 *  passes (chute + cron) nunca enviam em dobro. */
export async function runDrainPass(
  admin: SupabaseClient,
  accountId: string,
  broadcastId: string,
): Promise<{ skipped: boolean; remaining: number }> {
  const claimed = await claimBroadcastDelivery(admin, accountId, broadcastId);
  if (!claimed) return { skipped: true, remaining: -1 };

  let remaining = 0;
  try {
    const { plan, remaining: rem } = await planBroadcastResume(admin, accountId, broadcastId, 'pending');
    remaining = rem;
    await markBroadcastSending(admin, broadcastId);
    await deliverBroadcast(admin, plan);
  } catch (err) {
    // 'nothing_to_resume' (sem pending) é esperado; outros erros (config,
    // template) logamos pra não virar retry silencioso a cada passe do cron.
    const msg = err instanceof Error ? err.message : String(err);
    if (!/nothing to resume|no recipients/i.test(msg)) {
      console.error(`[broadcast-drain] passe do broadcast ${broadcastId} falhou:`, msg);
    }
  }
  try {
    await finalizeBroadcastStatus(admin, broadcastId);
  } catch {
    // best-effort
  }
  await releaseBroadcastDelivery(admin, broadcastId);
  return { skipped: false, remaining };
}
