// ============================================================
// POST /api/whatsapp/relay-uazapi?token=...&unit=<unitId>
//
// Inbound do canal uazapi (não-oficial). A uazapi posta aqui direto (a central
// configura o webhook por unidade). Diferente do oficial, NÃO há phone_number_id
// — a UNIDADE vem na URL (`unit`). Autenticado por um token DERIVADO do segredo
// de licença (a central e a instância chegam ao mesmo valor). Fail-closed.
//
// Normaliza o payload uazapi e chama `ingestNormalizedInbound` — o MESMO
// pipeline de contato/conversa/automações/fluxos/IA do inbound oficial, só que
// roteado por unidade. Sempre 200 após auth (erro vira log + 200; a uazapi não
// fica re-tentando em loop).
// ============================================================

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { verifyUazapiRelayToken } from '@/lib/uazapi/relay-auth'
import { normalizeUazapiInbound } from '@/lib/uazapi/normalize'
import { ingestNormalizedInbound } from '@/lib/whatsapp/process-webhook'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

export async function POST(request: Request) {
  const url = new URL(request.url)
  const token = url.searchParams.get('token')
  const unitId = url.searchParams.get('unit')

  // Auth fail-closed.
  if (!verifyUazapiRelayToken(token)) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
  }
  if (!unitId) {
    return NextResponse.json({ error: 'unit ausente' }, { status: 400 })
  }

  // Corpo cru (tolerante) → normaliza.
  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ ok: true }, { status: 200 }) // corpo inválido: ack e ignora
  }

  const norm = normalizeUazapiInbound(payload)
  // Sem mensagem, ou é echo do que NÓS enviamos (fromMe) → ack sem processar.
  if (!norm || norm.fromMe) {
    return NextResponse.json({ ok: true }, { status: 200 })
  }

  try {
    const db = admin()

    // Resolve a tenancy pela unidade (account + dono).
    const { data: unit } = await db
      .from('unidades')
      .select('id, account_id, active')
      .eq('id', unitId)
      .maybeSingle()
    if (!unit || !unit.active) {
      // Unidade inválida — ack (não re-tenta) e loga.
      console.error('[relay-uazapi] unidade não encontrada/inativa:', unitId)
      return NextResponse.json({ ok: true }, { status: 200 })
    }

    const { data: account } = await db
      .from('accounts')
      .select('owner_user_id')
      .eq('id', unit.account_id)
      .maybeSingle()
    if (!account?.owner_user_id) {
      console.error('[relay-uazapi] conta sem dono para a unidade:', unitId)
      return NextResponse.json({ ok: true }, { status: 200 })
    }

    const messageId =
      norm.messageId ||
      `uazapi:${norm.timestamp ?? Date.now()}:${norm.fromPhone ?? 'anon'}`

    await ingestNormalizedInbound({
      accountId: unit.account_id,
      unitId: unit.id,
      configOwnerUserId: account.owner_user_id,
      identity: {
        phone: norm.fromPhone,
        bsuid: null,
        username: null,
        name: norm.fromName,
      },
      content: { type: norm.type, text: norm.text, mediaUrl: norm.mediaUrl },
      messageId,
      timestamp: norm.timestamp,
    })
  } catch (err) {
    // Erro interno vira log + 200 (a uazapi não re-tenta em loop).
    console.error('[relay-uazapi] erro ao processar:', err)
  }

  return NextResponse.json({ ok: true }, { status: 200 })
}
