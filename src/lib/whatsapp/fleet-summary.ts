/**
 * Montagem PURA do resumo de consumo do SILO inteiro (Frente 4), pra central
 * puxar via `x-license-secret`. Diferente do `billing/summary` (1 conta, sessão
 * admin), aqui agregamos TODAS as contas/unidades da instância.
 *
 * Reaproveita `aggregateConsumption` (mesma contagem cobrável × tarifa) e só
 * decora cada unidade com conta/nome e conversas de anúncio (referral). Puro:
 * recebe linhas já lidas do banco, devolve o payload — testável sem Supabase.
 */

import { aggregateConsumption, type ConsumptionRow, type Rate } from './billing';

export type UnitMeta = { accountId: string | null; name: string | null };

export type FleetUnitSummary = {
  accountId: string | null;
  unitId: string;
  unitName: string;
  billableCount: number;
  freeCount: number;
  referralConversations: number;
  estimatedCost: number;
};

export type FleetSummary = {
  ratesConfigured: boolean;
  totalEstimatedCost: number;
  units: FleetUnitSummary[];
};

export function buildFleetSummary(input: {
  rows: ConsumptionRow[];
  rates: Rate[];
  /** unitId -> { accountId, name } (da tabela unidades). */
  unitMeta: Map<string, UnitMeta>;
  /** unitId -> nº de conversas vindas de anúncio no período. */
  referralByUnit: Map<string, number>;
}): FleetSummary {
  const { rows, rates, unitMeta, referralByUnit } = input;
  const perUnit = aggregateConsumption(rows, rates);

  const units: FleetUnitSummary[] = perUnit.map((u) => {
    const meta = unitMeta.get(u.unitId);
    const unitName =
      u.unitId === 'sem-unidade' ? 'Sem unidade' : meta?.name ?? u.unitId;
    return {
      accountId: meta?.accountId ?? null,
      unitId: u.unitId,
      unitName,
      billableCount: u.billableMessages,
      freeCount: u.totalMessages - u.billableMessages,
      referralConversations: referralByUnit.get(u.unitId) ?? 0,
      estimatedCost: u.estimatedCost,
    };
  });

  return {
    ratesConfigured: rates.some((r) => r.price > 0),
    totalEstimatedCost: units.reduce((s, u) => s + u.estimatedCost, 0),
    units,
  };
}
