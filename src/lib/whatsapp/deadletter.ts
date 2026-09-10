import crypto from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Dead-letter de inbound do WhatsApp.
 *
 * O webhook/relay sempre responde 200 pra Meta (pra ela não re-tentar em loop),
 * então todo evento que o processamento descartava (`continue`) era perdido de
 * vez. Aqui gravamos o evento cru + motivo ANTES do descarte, de forma
 * idempotente, para não perder nada e permitir reprocessamento e alerta.
 *
 * Ver migration 049 e src/lib/whatsapp/process-webhook.ts (pontos de captura).
 */

export type DeadLetterReason =
  | 'no_contacts'
  | 'db_error'
  | 'no_config'
  | 'multiple_configs'
  | 'parse_error'

/** Formato mínimo do `value` de uma mudança do webhook, para extrair a chave. */
type ChangeValue = {
  metadata?: { phone_number_id?: string }
  messages?: Array<{ id?: string }>
}

/**
 * Chave de idempotência de uma linha de dead-letter. Deriva de
 * (phone_number_id + ids das mensagens), então o MESMO evento caindo de novo
 * (Meta reenviando, ou reprocesso que ainda falha) NÃO cria linha duplicada.
 * Sem ids de mensagem (evento atípico), usa o hash do corpo inteiro. Pura.
 */
export function deadletterKey(
  phoneNumberId: string | null | undefined,
  value: ChangeValue,
): string {
  const ids = (value.messages ?? [])
    .map((m) => m?.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
    .sort()

  const basis =
    ids.length > 0
      ? `${phoneNumberId ?? ''}:${ids.join(',')}`
      : `raw:${JSON.stringify(value)}`

  return crypto.createHash('sha256').update(basis).digest('hex')
}

/**
 * Grava (ou ignora, se já existe) uma linha de dead-letter. Nunca lança — o
 * caminho do webhook não pode quebrar por causa da própria rede de segurança;
 * em falha, loga e segue (o ack 200 pra Meta continua). Usa o admin client
 * (service-role) porque a tabela é RLS deny-all.
 */
export async function recordDeadLetter(
  admin: SupabaseClient,
  params: {
    phoneNumberId: string | null | undefined
    value: ChangeValue
    reason: DeadLetterReason
    lastError?: string | null
  },
): Promise<void> {
  try {
    const idempotency_key = deadletterKey(params.phoneNumberId, params.value)
    await admin
      .from('whatsapp_inbound_deadletter')
      .upsert(
        {
          idempotency_key,
          phone_number_id: params.phoneNumberId ?? null,
          raw_event: params.value,
          reason: params.reason,
          status: 'pending',
          last_error: params.lastError ?? null,
        },
        { onConflict: 'idempotency_key', ignoreDuplicates: true },
      )
  } catch (err) {
    // A rede de segurança nunca derruba o processamento nem o ack 200.
    console.error(
      '[deadletter] falha ao gravar evento descartado (reason=' +
        params.reason +
        '):',
      err instanceof Error ? err.message : err,
    )
  }
}
