import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getConsolidatedMetrics } from "./metrics";

// ------------------------------------------------------------
// Table-dispatching Supabase stub. Unlike the single-result stub in
// `context.test.ts`, `getConsolidatedMetrics` fires five different
// queries in one `Promise.all`, so the mock returns a per-table
// scripted result. Every builder is thenable (the queries are awaited
// directly, no terminal `.single()`), and `select`/`eq`/`order` all
// return the builder so any chain shape resolves to the table's data.
// ------------------------------------------------------------
type TableResults = Record<string, { data: unknown; error: unknown }>;

function makeDb(results: TableResults): SupabaseClient {
  const db = {
    from: (table: string) => {
      const result = results[table] ?? { data: [], error: null };
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        then: (
          resolve: (value: { data: unknown; error: unknown }) => void,
          reject: (reason: unknown) => void,
        ) => Promise.resolve(result).then(resolve, reject),
      };
      return builder;
    },
  } as unknown as SupabaseClient;
  return db;
}

const UNITS = [
  { id: "u1", name: "Matriz", slug: "matriz", active: true },
  { id: "u2", name: "Filial", slug: "filial", active: true },
];

const STAGES = [
  { id: "s1", name: "New", position: 0, color: "#111" },
  { id: "s2", name: "Won", position: 1, color: "#222" },
];

describe("getConsolidatedMetrics", () => {
  it("aggregates per-unit and account totals from grouped rows", async () => {
    const db = makeDb({
      unidades: { data: UNITS, error: null },
      contacts: {
        // u1: 3 leads, u2: 1 lead
        data: [
          { unit_id: "u1" },
          { unit_id: "u1" },
          { unit_id: "u1" },
          { unit_id: "u2" },
        ],
        error: null,
      },
      conversations: {
        // active = open|pending; closed is excluded
        data: [
          { unit_id: "u1", status: "open" },
          { unit_id: "u1", status: "pending" },
          { unit_id: "u1", status: "closed" },
          { unit_id: "u2", status: "open" },
        ],
        error: null,
      },
      deals: {
        data: [
          // u1: 3 deals, 2 won (100 + 300 = 400 wonValue)
          { unit_id: "u1", stage_id: "s1", value: 50, status: "open" },
          { unit_id: "u1", stage_id: "s2", value: 100, status: "won" },
          { unit_id: "u1", stage_id: "s2", value: 300, status: "won" },
          // u2: 1 deal, 0 won
          { unit_id: "u2", stage_id: "s1", value: 999, status: "lost" },
        ],
        error: null,
      },
      pipeline_stages: { data: STAGES, error: null },
    });

    const m = await getConsolidatedMetrics(db, "acct-1");

    expect(m.hasOriginData).toBe(false);
    expect(m.stages.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(m.units).toHaveLength(2);

    const u1 = m.units.find((u) => u.unitId === "u1")!;
    expect(u1.unitName).toBe("Matriz");
    expect(u1.leads).toBe(3);
    expect(u1.openConversations).toBe(2); // open + pending, not closed
    expect(u1.deals).toBe(3);
    expect(u1.wonCount).toBe(2);
    expect(u1.wonValue).toBe(400);
    expect(u1.conversionRate).toBeCloseTo(2 / 3);
    // Funnel lines up with the ordered stage list, per unit.
    expect(u1.funnel).toEqual([
      { stageId: "s1", stageName: "New", dealCount: 1, totalValue: 50 },
      { stageId: "s2", stageName: "Won", dealCount: 2, totalValue: 400 },
    ]);

    const u2 = m.units.find((u) => u.unitId === "u2")!;
    expect(u2.leads).toBe(1);
    expect(u2.openConversations).toBe(1);
    expect(u2.deals).toBe(1);
    expect(u2.wonCount).toBe(0);
    expect(u2.wonValue).toBe(0);
    expect(u2.conversionRate).toBe(0);

    // Account totals = pooled sums.
    expect(m.totals.leads).toBe(4);
    expect(m.totals.openConversations).toBe(3);
    expect(m.totals.deals).toBe(4);
    expect(m.totals.wonCount).toBe(2);
    expect(m.totals.wonValue).toBe(400);
    // Conversion computed on pooled won/leads (2/4), not an average of
    // per-unit rates ((2/3 + 0) / 2).
    expect(m.totals.conversionRate).toBeCloseTo(2 / 4);
    expect(m.totals.funnel).toEqual([
      { stageId: "s1", stageName: "New", dealCount: 2, totalValue: 1049 },
      { stageId: "s2", stageName: "Won", dealCount: 2, totalValue: 400 },
    ]);
  });

  it("seeds a zero row for a unit with no activity", async () => {
    const db = makeDb({
      unidades: { data: UNITS, error: null },
      contacts: { data: [{ unit_id: "u1" }], error: null },
      conversations: { data: [], error: null },
      deals: { data: [], error: null },
      pipeline_stages: { data: STAGES, error: null },
    });

    const m = await getConsolidatedMetrics(db, "acct-1");
    const u2 = m.units.find((u) => u.unitId === "u2")!;
    expect(u2.leads).toBe(0);
    expect(u2.deals).toBe(0);
    expect(u2.conversionRate).toBe(0);
    expect(u2.funnel).toEqual([
      { stageId: "s1", stageName: "New", dealCount: 0, totalValue: 0 },
      { stageId: "s2", stageName: "Won", dealCount: 0, totalValue: 0 },
    ]);
  });

  it("ignores rows whose unit_id matches no known unit", async () => {
    const db = makeDb({
      unidades: { data: [UNITS[0]], error: null },
      contacts: {
        data: [{ unit_id: "u1" }, { unit_id: "ghost" }, { unit_id: null }],
        error: null,
      },
      conversations: { data: [], error: null },
      deals: { data: [], error: null },
      pipeline_stages: { data: STAGES, error: null },
    });

    const m = await getConsolidatedMetrics(db, "acct-1");
    expect(m.units).toHaveLength(1);
    expect(m.units[0].leads).toBe(1); // only the u1 row counts
    expect(m.totals.leads).toBe(1);
  });

  it("returns empty structure for an account with no units", async () => {
    const db = makeDb({
      unidades: { data: [], error: null },
      contacts: { data: [], error: null },
      conversations: { data: [], error: null },
      deals: { data: [], error: null },
      pipeline_stages: { data: [], error: null },
    });

    const m = await getConsolidatedMetrics(db, "acct-1");
    expect(m.units).toEqual([]);
    expect(m.totals.leads).toBe(0);
    expect(m.totals.conversionRate).toBe(0);
    expect(m.stages).toEqual([]);
  });

  it("throws with a descriptive message when a query errors", async () => {
    const db = makeDb({
      unidades: { data: UNITS, error: null },
      contacts: { data: null, error: { message: "boom" } },
      conversations: { data: [], error: null },
      deals: { data: [], error: null },
      pipeline_stages: { data: STAGES, error: null },
    });

    await expect(getConsolidatedMetrics(db, "acct-1")).rejects.toThrow(
      /contacts.*boom/,
    );
  });
});
