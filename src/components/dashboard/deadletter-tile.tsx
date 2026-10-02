'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ChevronRight } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';

const REASON_LABEL: Record<string, string> = {
  no_config: 'número sem configuração',
  db_error: 'erro temporário',
  no_contacts: 'sem telefone (username)',
  multiple_configs: 'configuração duplicada',
  parse_error: 'evento inválido',
};

type Summary = {
  needsAttention: number;
  byReason: Record<string, number>;
};

/**
 * Tile no dashboard, só pro DONO/ADMIN, quando há mensagens inbound retidas na
 * dead-letter (pendentes/falhas). O atendente comum não vê — é ação de admin
 * (reprovisionar / chamar o operador). Silencioso quando não há nada.
 */
export function DeadLetterTile() {
  const { accountRole } = useAuth();
  const canSee = accountRole === 'owner' || accountRole === 'admin';
  const [summary, setSummary] = useState<Summary | null>(null);

  useEffect(() => {
    if (!canSee) return;
    let cancelled = false;
    fetch('/api/whatsapp/deadletter/summary')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Summary | null) => {
        if (!cancelled && d) setSummary(d);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [canSee]);

  if (!canSee || !summary || summary.needsAttention <= 0) return null;

  const reasons = Object.entries(summary.byReason)
    .map(([r, n]) => `${n} ${REASON_LABEL[r] ?? r}`)
    .join(' · ');

  return (
    <Link
      href="/settings"
      className="flex items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm transition-colors hover:bg-destructive/15"
    >
      <AlertTriangle className="h-5 w-5 shrink-0 text-destructive" />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-foreground">
          {summary.needsAttention} mensagem(ns) recebida(s) não processada(s)
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {reasons} — nada foi perdido; ver detalhes nas Configurações
        </p>
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}
