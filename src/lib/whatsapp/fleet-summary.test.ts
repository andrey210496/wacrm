import { describe, it, expect } from 'vitest';
import { buildFleetSummary } from './fleet-summary';
import type { ConsumptionRow, Rate } from './billing';

const rates: Rate[] = [
  { category: 'marketing', price: 0.05 },
  { category: 'utility', price: 0.02 },
];

describe('buildFleetSummary', () => {
  it('agrega múltiplas contas/unidades com custo, cobrável e grátis', () => {
    const rows: ConsumptionRow[] = [
      { unitId: 'u1', category: 'marketing', billable: true },
      { unitId: 'u1', category: 'marketing', billable: true },
      { unitId: 'u1', category: 'utility', billable: false }, // grátis (janela)
      { unitId: 'u2', category: 'utility', billable: true },
    ];
    const unitMeta = new Map([
      ['u1', { accountId: 'acc-A', name: 'Unidade Centro' }],
      ['u2', { accountId: 'acc-B', name: 'Unidade Sul' }],
    ]);
    const referralByUnit = new Map([['u1', 3]]);

    const out = buildFleetSummary({ rows, rates, unitMeta, referralByUnit });

    expect(out.ratesConfigured).toBe(true);
    // u1: 2 marketing cobráveis × 0.05 = 0.10 ; u2: 1 utility × 0.02 = 0.02
    expect(out.totalEstimatedCost).toBeCloseTo(0.12, 5);

    const u1 = out.units.find((u) => u.unitId === 'u1')!;
    expect(u1.accountId).toBe('acc-A');
    expect(u1.unitName).toBe('Unidade Centro');
    expect(u1.billableCount).toBe(2);
    expect(u1.freeCount).toBe(1);
    expect(u1.referralConversations).toBe(3);
    expect(u1.estimatedCost).toBeCloseTo(0.1, 5);

    const u2 = out.units.find((u) => u.unitId === 'u2')!;
    expect(u2.accountId).toBe('acc-B');
    expect(u2.referralConversations).toBe(0);
  });

  it('unidade nula vira "Sem unidade" e ratesConfigured=false sem tarifa', () => {
    const rows: ConsumptionRow[] = [{ unitId: null, category: 'marketing', billable: true }];
    const out = buildFleetSummary({
      rows,
      rates: [{ category: 'marketing', price: 0 }],
      unitMeta: new Map(),
      referralByUnit: new Map(),
    });
    expect(out.ratesConfigured).toBe(false);
    expect(out.totalEstimatedCost).toBe(0);
    expect(out.units[0].unitName).toBe('Sem unidade');
    expect(out.units[0].accountId).toBeNull();
    expect(out.units[0].billableCount).toBe(1);
  });

  it('sem linhas → frota vazia, custo 0', () => {
    const out = buildFleetSummary({ rows: [], rates, unitMeta: new Map(), referralByUnit: new Map() });
    expect(out.units).toEqual([]);
    expect(out.totalEstimatedCost).toBe(0);
  });
});
