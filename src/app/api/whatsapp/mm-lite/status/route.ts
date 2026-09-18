// ============================================================
// GET /api/whatsapp/mm-lite/status[?unit=<unitId>]
//
// Status de onboarding do Marketing Messages API (MM Lite) para o número
// (WABA) de uma unidade. Somente leitura (viewer). Best-effort: erro -> UNKNOWN.
// Não escreve nada; sem migration.
// ============================================================

import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { resolveOperatorUnitId } from '@/lib/units/operator-unit'
import { decrypt } from '@/lib/whatsapp/encryption'
import { getMarketingOnboardingStatus } from '@/lib/whatsapp/mm-lite'

export async function GET(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('viewer')

    const unitParam = new URL(request.url).searchParams.get('unit')
    const unitId =
      unitParam || (await resolveOperatorUnitId(supabase, accountId, userId))

    const { data: config } = await supabase
      .from('whatsapp_config')
      .select('waba_id, access_token')
      .eq('account_id', accountId)
      .eq('unit_id', unitId)
      .limit(1)
      .single()

    if (!config?.waba_id || !config?.access_token) {
      return NextResponse.json({ status: 'UNKNOWN', configured: false, unitId })
    }

    const { status, raw } = await getMarketingOnboardingStatus(
      config.waba_id as string,
      decrypt(config.access_token as string),
    )
    return NextResponse.json({ status, raw, configured: true, unitId })
  } catch (err) {
    return toErrorResponse(err)
  }
}
