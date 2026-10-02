// ============================================================
// GET /api/whatsapp/deadletter/drain — worker de retry da dead-letter.
//
// Reprocessa eventos inbound que caíram na dead-letter (erro transitório de
// banco, número recém-provisionado, etc.). Acionado por um pinger externo
// (cron do EasyPanel / n8n) com o header `x-cron-secret` = DEADLETTER_CRON_SECRET.
//
// Idempotente: reconstrói o `body` do evento e chama o MESMO processWebhook (o
// dedup por message_id evita duplicar). Se as mensagens do evento passarem a
// existir, marca `reprocessed`; senão incrementa `attempts` e, após o teto,
// marca `failed` (preservado e visível — nunca perdido).
// ============================================================

import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { processWebhook } from '@/lib/whatsapp/process-webhook'

const MAX_ATTEMPTS = 5
const BATCH = 25

function supabaseAdmin(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

type DeadLetterRow = {
  id: string
  raw_event: {
    metadata?: { phone_number_id?: string }
    messages?: Array<{ id?: string }>
  }
  attempts: number
}

export async function GET(request: Request) {
  const expected = process.env.DEADLETTER_CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  }
  const supplied = request.headers.get('x-cron-secret') ?? ''
  const a = Buffer.from(supplied)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = supabaseAdmin()
  const { data: pending, error } = await admin
    .from('whatsapp_inbound_deadletter')
    .select('id, raw_event, attempts')
    .eq('status', 'pending')
    .lt('attempts', MAX_ATTEMPTS)
    .order('created_at', { ascending: true })
    .limit(BATCH)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!pending || pending.length === 0) {
    return NextResponse.json({ processed: 0, reprocessed: 0, failed: 0 })
  }

  let reprocessed = 0
  let failed = 0

  for (const row of pending as DeadLetterRow[]) {
    const value = row.raw_event
    const messageIds = (value.messages ?? [])
      .map((m) => m?.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0)

    // Re-executa o mesmo processamento. O dedup por message_id torna isto
    // seguro de repetir. Um novo drop apenas faz upsert ignoreDuplicates (no-op).
    try {
      // raw_event vem do JSONB (tipo solto); processWebhook espera o shape
      // estrito do webhook. O cast é seguro — é o mesmo evento que a Meta mandou.
      await processWebhook({
        entry: [{ id: '', changes: [{ field: 'messages', value }] }],
      } as unknown as Parameters<typeof processWebhook>[0])
    } catch {
      // processWebhook não deve lançar; se lançar, tratamos como não-processado.
    }

    // Verdade no banco: as mensagens do evento passaram a existir?
    let allStored = false
    if (messageIds.length > 0) {
      const { data: stored } = await admin
        .from('messages')
        .select('message_id')
        .in('message_id', messageIds)
      allStored = (stored?.length ?? 0) >= messageIds.length
    }

    if (allStored) {
      await admin
        .from('whatsapp_inbound_deadletter')
        .update({
          status: 'reprocessed',
          attempts: row.attempts + 1,
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id)
      reprocessed++
    } else {
      const nextAttempts = row.attempts + 1
      const nextStatus = nextAttempts >= MAX_ATTEMPTS ? 'failed' : 'pending'
      await admin
        .from('whatsapp_inbound_deadletter')
        .update({
          status: nextStatus,
          attempts: nextAttempts,
          last_error: 'reprocesso não armazenou as mensagens (config ausente ou sem contato)',
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id)
      if (nextStatus === 'failed') failed++
    }
  }

  return NextResponse.json({
    processed: pending.length,
    reprocessed,
    failed,
  })
}
