/**
 * Agregação pura do consumo de mensagens do WhatsApp (Feature C).
 *
 * A Meta manda no webhook de status a categoria e se a mensagem é cobrável
 * (`pricing`) — a fonte da verdade do que é cobrado (janela de 24h, FEP 72h,
 * tiers etc. já entram no cálculo dela). Aqui só CONTAMOS por categoria/unidade
 * e multiplicamos as cobráveis pela tarifa configurada para estimar o custo.
 *
 * Sem tarifa configurada (price 0), o custo estimado é 0 e o painel avisa
 * "tarifa não configurada" — nunca inventamos um número.
 */

export type BillableCategory = 'marketing' | 'utility' | 'authentication';
const BILLABLE_CATEGORIES: BillableCategory[] = [
  'marketing',
  'utility',
  'authentication',
];

export type ConsumptionRow = {
  unitId: string | null;
  category: string | null;
  billable: boolean | null;
};

export type Rate = { category: string; price: number };

export type CategoryConsumption = {
  category: string;
  total: number;
  billable: number;
  free: number;
  rate: number; // tarifa configurada (0 = não configurada)
  estimatedCost: number; // billable × rate
};

export type UnitConsumption = {
  unitId: string;
  totalMessages: number;
  billableMessages: number;
  estimatedCost: number;
  byCategory: CategoryConsumption[];
};

function rateFor(rates: Rate[], category: string): number {
  const r = rates.find((x) => x.category === category);
  return r ? r.price : 0;
}

/**
 * Agrega linhas (uma por mensagem enviada, com unidade + categoria + cobrável)
 * em consumo por unidade e categoria, com custo estimado. Puro.
 */
export function aggregateConsumption(
  rows: ConsumptionRow[],
  rates: Rate[],
): UnitConsumption[] {
  // unitId -> category -> { total, billable }
  const byUnit = new Map<string, Map<string, { total: number; billable: number }>>();

  for (const row of rows) {
    const unitId = row.unitId ?? 'sem-unidade';
    // Categoria desconhecida (status sem pricing ainda) cai em 'unknown'.
    const category = row.category ?? 'unknown';
    if (!byUnit.has(unitId)) byUnit.set(unitId, new Map());
    const cats = byUnit.get(unitId)!;
    if (!cats.has(category)) cats.set(category, { total: 0, billable: 0 });
    const c = cats.get(category)!;
    c.total += 1;
    if (row.billable) c.billable += 1;
  }

  const result: UnitConsumption[] = [];
  for (const [unitId, cats] of byUnit) {
    const byCategory: CategoryConsumption[] = [];
    let totalMessages = 0;
    let billableMessages = 0;
    let estimatedCost = 0;

    for (const [category, { total, billable }] of cats) {
      const rate = BILLABLE_CATEGORIES.includes(category as BillableCategory)
        ? rateFor(rates, category)
        : 0;
      const cost = billable * rate;
      byCategory.push({
        category,
        total,
        billable,
        free: total - billable,
        rate,
        estimatedCost: cost,
      });
      totalMessages += total;
      billableMessages += billable;
      estimatedCost += cost;
    }

    byCategory.sort((a, b) => b.total - a.total);
    result.push({ unitId, totalMessages, billableMessages, estimatedCost, byCategory });
  }

  result.sort((a, b) => b.estimatedCost - a.estimatedCost);
  return result;
}
