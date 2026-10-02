'use client'

import { useEffect, useState } from 'react'

type Status = 'ONBOARDED' | 'ELIGIBLE' | 'UNKNOWN'

/**
 * Badge informativo do status MM Lite do número DA UNIDADE `unitId`. NÃO
 * bloqueia nada — só orienta o cliente a aceitar a ToS no WhatsApp Manager
 * para destravar a otimização de entrega. Best-effort: falha some silenciosa.
 * Re-busca quando a unidade ativa muda no painel.
 */
export function MmLiteStatusBadge({ unitId }: { unitId?: string | null }) {
  const [status, setStatus] = useState<Status | null>(null)

  useEffect(() => {
    if (!unitId) return
    let cancelled = false
    fetch(`/api/whatsapp/mm-lite/status?unit=${encodeURIComponent(unitId)}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setStatus((d?.status as Status) ?? 'UNKNOWN')
      })
      .catch(() => {
        if (!cancelled) setStatus('UNKNOWN')
      })
    return () => {
      cancelled = true
    }
  }, [unitId])

  if (!unitId || status === null) return null

  if (status === 'ONBOARDED') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-green-500/30 bg-green-500/10 px-2.5 py-1 text-xs font-medium text-green-500">
        MM Lite: Ativo
      </span>
    )
  }

  if (status === 'ELIGIBLE') {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-full border border-yellow-500/30 bg-yellow-500/10 px-2.5 py-1 text-xs font-medium text-yellow-500"
        title="Aceite os termos do Marketing Messages no WhatsApp Manager (Overview → Alerts → Accept terms) para ativar a entrega otimizada dos disparos."
      >
        MM Lite: aceite a ToS no WhatsApp Manager
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
      MM Lite: indisponível
    </span>
  )
}
