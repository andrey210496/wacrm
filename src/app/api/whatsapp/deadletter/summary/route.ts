// ============================================================
// GET /api/whatsapp/deadletter/summary — contadores da dead-letter pro painel.
//
// Alerta no painel (decisão A2): quantos eventos inbound ficaram pendentes /
// falharam, por motivo. Só ADMIN+ (sessão). Lê via service-role (a tabela é
// RLS deny-all). Não devolve o conteúdo cru — só contagens.
// ============================================================

import { NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

function admin(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

export async function GET() {
  try {
    await requireRole('admin')
  } catch (err) {
    return toErrorResponse(err)
  }

  const db = admin()
  const { data, error } = await db
    .from('whatsapp_inbound_deadletter')
    .select('reason, status')

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const rows = data ?? []
  const pending = rows.filter((r) => r.status === 'pending').length
  const failed = rows.filter((r) => r.status === 'failed').length
  const reprocessed = rows.filter((r) => r.status === 'reprocessed').length

  // Agrupa os que ainda precisam de atenção (pending + failed) por motivo.
  const byReason: Record<string, number> = {}
  for (const r of rows) {
    if (r.status === 'pending' || r.status === 'failed') {
      byReason[r.reason] = (byReason[r.reason] ?? 0) + 1
    }
  }

  return NextResponse.json({
    // Total que precisa de atenção — o número pro badge/banner do painel.
    needsAttention: pending + failed,
    pending,
    failed,
    reprocessed,
    byReason,
  })
}
