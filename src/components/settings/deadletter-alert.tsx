'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

const REASON_LABEL: Record<string, string> = {
  no_config: 'número sem configuração (provisão)',
  db_error: 'erro temporário de banco',
  no_contacts: 'sem telefone (username/BSUID)',
  multiple_configs: 'configuração duplicada',
  parse_error: 'evento inválido',
};

type Summary = {
  needsAttention: number;
  byReason: Record<string, number>;
};

/**
 * Alerta no painel (decisão A2) quando há mensagens inbound que caíram na
 * dead-letter e ainda precisam de atenção (pendentes/falhas). Só aparece quando
 * há algo; silencioso caso contrário. Lê /api/whatsapp/deadletter/summary.
 */
export function DeadLetterAlert() {
  const [summary, setSummary] = useState<Summary | null>(null);

  useEffect(() => {
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
  }, []);

  if (!summary || summary.needsAttention <= 0) return null;

  const reasons = Object.entries(summary.byReason)
    .map(([r, n]) => `${n} ${REASON_LABEL[r] ?? r}`)
    .join(' · ');

  return (
    <Alert variant="destructive">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>
        {summary.needsAttention} mensagem(ns) recebida(s) não processada(s)
      </AlertTitle>
      <AlertDescription>
        Alguns eventos do WhatsApp não puderam ser processados e ficaram
        guardados (nada foi perdido). Motivos: {reasons}. O reprocessamento roda
        automaticamente; casos de &quot;número sem configuração&quot; costumam
        indicar uma provisão que precisa ser refeita.
      </AlertDescription>
    </Alert>
  );
}
