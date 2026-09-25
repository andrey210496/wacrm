import { describe, it, expect } from 'vitest';
import {
  aggregateConsumption,
  normalizePricingCategory,
  type ConsumptionRow,
  type Rate,
} from './billing';

describe('aggregateConsumption', () => {
  const rates = [
    { category: 'marketing', price: 0.5 },
    { category: 'utility', price: 0.1 },
    { category: 'authentication', price: 0.2 },
  ];

  it('conta por unidade/categoria e estima o custo das cobráveis', () => {
    const rows = [
      { unitId: 'u1', category: 'marketing', billable: true },
      { unitId: 'u1', category: 'marketing', billable: true },
      { unitId: 'u1', category: 'utility', billable: false }, // grátis (janela)
      { unitId: 'u2', category: 'authentication', billable: true },
    ];
    const out = aggregateConsumption(rows, rates);

    const u1 = out.find((u) => u.unitId === 'u1')!;
    expect(u1.totalMessages).toBe(3);
    expect(u1.billableMessages).toBe(2);
    expect(u1.estimatedCost).toBeCloseTo(1.0); // 2 × 0.5
    const mkt = u1.byCategory.find((c) => c.category === 'marketing')!;
    expect(mkt).toMatchObject({ total: 2, billable: 2, free: 0, estimatedCost: 1.0 });
    const util = u1.byCategory.find((c) => c.category === 'utility')!;
    expect(util).toMatchObject({ total: 1, billable: 0, free: 1, estimatedCost: 0 });

    const u2 = out.find((u) => u.unitId === 'u2')!;
    expect(u2.estimatedCost).toBeCloseTo(0.2);
  });

  it('sem tarifa configurada (rate 0) → custo 0, nunca inventa', () => {
    const out = aggregateConsumption(
      [{ unitId: 'u1', category: 'marketing', billable: true }],
      [], // sem tarifas
    );
    expect(out[0].estimatedCost).toBe(0);
    expect(out[0].byCategory[0].rate).toBe(0);
  });

  it('categoria service/desconhecida não estima custo mesmo se billable', () => {
    const out = aggregateConsumption(
      [{ unitId: 'u1', category: 'service', billable: true }],
      rates,
    );
    expect(out[0].estimatedCost).toBe(0);
  });

  it('unitId null vira "sem-unidade"; ordena por custo desc', () => {
    const out = aggregateConsumption(
      [
        { unitId: null, category: 'utility', billable: true },
        { unitId: 'u1', category: 'marketing', billable: true },
      ],
      rates,
    );
    expect(out[0].unitId).toBe('u1'); // 0.5 > 0.1
    expect(out.some((u) => u.unitId === 'sem-unidade')).toBe(true);
  });
});

describe('normalizePricingCategory', () => {
  it('marketing_lite -> marketing', () => {
    expect(normalizePricingCategory('marketing_lite')).toBe('marketing');
  });
  it('marketing/utility passam direto', () => {
    expect(normalizePricingCategory('marketing')).toBe('marketing');
    expect(normalizePricingCategory('utility')).toBe('utility');
  });
  it('null/undefined -> unknown', () => {
    expect(normalizePricingCategory(null)).toBe('unknown');
    expect(normalizePricingCategory(undefined)).toBe('unknown');
  });
});

describe('aggregateConsumption com marketing_lite', () => {
  it('conta marketing_lite sob a tarifa de marketing', () => {
    const rows: ConsumptionRow[] = [
      { unitId: 'u1', category: 'marketing_lite', billable: true },
      { unitId: 'u1', category: 'marketing', billable: true },
    ];
    const rates: Rate[] = [{ category: 'marketing', price: 0.35 }];
    const out = aggregateConsumption(rows, rates);
    const u1 = out.find((u) => u.unitId === 'u1')!;
    const marketing = u1.byCategory.find((c) => c.category === 'marketing')!;
    // As duas mensagens caem em 'marketing' e são cobradas à tarifa.
    expect(marketing.total).toBe(2);
    expect(marketing.billable).toBe(2);
    expect(u1.estimatedCost).toBeCloseTo(0.7, 5);
  });
});
