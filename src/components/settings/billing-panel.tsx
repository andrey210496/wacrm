'use client';

import { useCallback, useEffect, useState } from 'react';

type CategoryConsumption = {
  category: string;
  total: number;
  billable: number;
  free: number;
  rate: number;
  estimatedCost: number;
};
type UnitConsumption = {
  unitId: string;
  unitName: string;
  totalMessages: number;
  billableMessages: number;
  estimatedCost: number;
  referralConversations: number;
  byCategory: CategoryConsumption[];
};
type Summary = {
  from: string;
  to: string;
  currency: string;
  ratesConfigured: boolean;
  totalEstimatedCost: number;
  units: UnitConsumption[];
};

const CAT_LABEL: Record<string, string> = {
  marketing: 'Marketing',
  utility: 'Utilidade',
  authentication: 'Autenticação',
  service: 'Serviço (grátis)',
  unknown: 'Sem categoria ainda',
};

function brl(n: number): string {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/**
 * Painel de consumo de WhatsApp por unidade (Feature C). Só ADMIN+ (a API
 * devolve 403 pra os demais e o painel se esconde). Custo ESTIMADO = mensagens
 * cobráveis × tarifa configurada (a Meta é a fonte do que é cobrável).
 */
export function BillingPanel() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [hidden, setHidden] = useState(false);
  const [rates, setRates] = useState<Record<string, number>>({
    marketing: 0,
    utility: 0,
    authentication: 0,
  });
  const [savingRates, setSavingRates] = useState(false);
  const [rateMsg, setRateMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const r = await fetch('/api/whatsapp/billing/summary');
      if (r.status === 403) {
        setHidden(true);
        return;
      }
      if (!r.ok) {
        setLoadError('Não foi possível carregar o consumo.');
        return;
      }
      setSummary((await r.json()) as Summary);
    } catch {
      setLoadError('Falha de rede ao carregar o consumo.');
      return;
    } finally {
      setLoading(false);
    }
    // Tarifas — secundário, best-effort (não gateia o painel).
    try {
      const r = await fetch('/api/whatsapp/billing/rates');
      if (r.ok) {
        const d = (await r.json()) as { rates?: Record<string, number> };
        if (d?.rates) {
          setRates({
            marketing: d.rates.marketing ?? 0,
            utility: d.rates.utility ?? 0,
            authentication: d.rates.authentication ?? 0,
          });
        }
      }
    } catch {
      /* tarifas são secundárias */
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const saveRates = async () => {
    setSavingRates(true);
    setRateMsg(null);
    try {
      const r = await fetch('/api/whatsapp/billing/rates', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rates),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setRateMsg(j.error || 'Falha ao salvar tarifas.');
      } else {
        setRateMsg('Tarifas salvas. O custo estimado usa os novos valores.');
        load();
      }
    } finally {
      setSavingRates(false);
    }
  };

  // 403 = não-admin → o painel simplesmente não existe pra este usuário.
  if (hidden) return null;

  // Erro de carga: em vez de sumir silenciosamente, mostra o motivo + retry.
  if (loadError) {
    return (
      <div className="mt-8 rounded-xl border border-amber-700/40 bg-amber-950/20 p-5">
        <h3 className="text-sm font-semibold text-amber-200">Consumo por unidade</h3>
        <p className="mt-1 text-sm text-amber-300">{loadError}</p>
        <button type="button" onClick={() => load()} className="btn btn-ghost mt-3 text-xs">
          Tentar de novo
        </button>
      </div>
    );
  }

  // Carregando (primeira carga): esqueleto em vez de tela em branco.
  if (loading && !summary) {
    return (
      <div className="mt-8 animate-pulse rounded-xl border border-border bg-card p-5 motion-reduce:animate-none">
        <div className="h-4 w-40 rounded bg-muted" />
        <div className="mt-4 h-20 rounded bg-muted/60" />
      </div>
    );
  }

  if (!summary) return null;

  return (
    <div className="mt-8 rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">
          Consumo de WhatsApp (mês atual)
        </h3>
        <span className="text-sm font-semibold text-foreground">
          Estimado: {brl(summary.totalEstimatedCost)}
        </span>
      </div>

      {!summary.ratesConfigured && (
        <p className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
          Tarifas ainda não configuradas — o custo estimado aparece como R$ 0.
          Preencha os valores do rate card da Meta (BR) abaixo.
        </p>
      )}

      {/* Por unidade */}
      <div className="mt-4 space-y-3">
        {summary.units.length === 0 && (
          <p className="text-xs text-muted-foreground">
            Nenhuma mensagem enviada no período.
          </p>
        )}
        {summary.units.map((u) => (
          <div key={u.unitId} className="rounded-lg border border-border/60 p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-medium text-foreground">{u.unitName}</p>
              <p className="text-xs text-muted-foreground">
                {u.billableMessages} cobráveis de {u.totalMessages} · vindas de
                anúncio: {u.referralConversations} ·{' '}
                <span className="font-medium text-foreground">{brl(u.estimatedCost)}</span>
              </p>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
              {u.byCategory.map((c) => (
                <span key={c.category}>
                  {CAT_LABEL[c.category] ?? c.category}: {c.total}
                  {c.billable > 0 ? ` (${c.billable} cobr.)` : ''}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Configuração de tarifas */}
      <div className="mt-5 border-t border-border pt-4">
        <p className="text-xs font-medium text-foreground">
          Tarifas por mensagem cobrável (R$) — do rate card da Meta (BR)
        </p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Serviço e utilidade dentro da janela de atendimento são grátis (a Meta
          decide); estas tarifas só estimam o custo das cobráveis.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {(['marketing', 'utility', 'authentication'] as const).map((cat) => (
            <label key={cat} className="text-xs text-muted-foreground">
              {CAT_LABEL[cat]}
              <input
                type="number"
                step="0.001"
                min="0"
                className="input mt-1 w-full"
                value={rates[cat]}
                onChange={(e) =>
                  setRates((r) => ({ ...r, [cat]: Number(e.target.value) }))
                }
              />
            </label>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            className="btn btn-brand text-xs"
            onClick={saveRates}
            disabled={savingRates}
          >
            {savingRates ? 'Salvando…' : 'Salvar tarifas'}
          </button>
          {rateMsg && <span className="text-xs text-muted-foreground">{rateMsg}</span>}
        </div>
      </div>
    </div>
  );
}
