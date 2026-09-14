// ============================================================
// Consolidated (multi-unit) management metrics.
//
// SERVER-ONLY in practice (the caller passes an RLS-scoped SSR
// Supabase client), but the module itself is pure aggregation over
// whatever client it's handed — no `next/headers`, no DB client
// construction — so it stays unit-testable with a mocked client.
//
// Aggregation strategy: pull the raw operational rows scoped to the
// account in a handful of parallel queries, then fold them into
// per-unit + account-total buckets in JS. This mirrors the existing
// dashboard's client-side aggregation approach (`@/lib/dashboard/
// queries`) and keeps each query shape trivial to assert in tests.
// RLS already scopes every table to the caller's account; admin+
// (the only role that reaches the consolidated view) can see all
// units, so the account_id filter is belt-and-suspenders that also
// makes the query shape explicit.
//
// "Won" convention — matches the repo's `DealStatus = 'open' | 'won'
// | 'lost'` (src/types/index.ts) and the DB CHECK constraint
// `deals_status_check CHECK (status IN ('open', 'won', 'lost'))`
// (migration 002). `wonValue` sums `deals.value` where status = 'won'.
//
// Lead-origin: there is NO source/origin/channel column on `contacts`
// or `conversations` anywhere in the schema (verified across all
// migrations), so the origin breakdown is deliberately OMITTED rather
// than invented. `hasOriginData` is exposed as `false` so the UI can
// branch without guessing.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";

/** A single pipeline stage, in board order. Drives the funnel columns. */
export interface FunnelStageMeta {
  id: string;
  name: string;
  /** Board position (ascending). */
  position: number;
  /** Stage colour (hex), for chart theming. Falls back to slate. */
  color: string;
}

/** Per-stage deal breakdown for one unit (or the account total). */
export interface FunnelStageCount {
  stageId: string;
  stageName: string;
  dealCount: number;
  totalValue: number;
}

/** The numbers we compute for each unit AND for the account as a whole. */
export interface MetricTotals {
  /** Contacts (leads) belonging to the unit. */
  leads: number;
  /** Conversations in an active state (status open or pending). */
  openConversations: number;
  /** Deals of any status. */
  deals: number;
  /** Count of won deals. */
  wonCount: number;
  /** Sum of `value` across won deals. */
  wonValue: number;
  /**
   * Won deals / leads, as a 0–1 fraction. `0` when the unit has no
   * leads (avoids a divide-by-zero producing NaN/Infinity in the UI).
   */
  conversionRate: number;
  /** Per-stage deal breakdown, one entry per account stage, in order. */
  funnel: FunnelStageCount[];
}

/** Everything a single unit contributes to the consolidated view. */
export interface UnitMetrics extends MetricTotals {
  unitId: string;
  unitName: string;
  unitSlug: string;
  active: boolean;
}

/** The full payload the consolidated dashboard renders. */
export interface ConsolidatedMetrics {
  /** One entry per unit in the account, in `unidades.created_at` order. */
  units: UnitMetrics[];
  /** Account-wide totals (the sum across every unit). */
  totals: MetricTotals;
  /** Ordered stage list — the shared funnel columns across all units. */
  stages: FunnelStageMeta[];
  /**
   * Whether a lead-origin breakdown is available. Always `false` today
   * (no origin/source column exists on contacts or conversations). Kept
   * as a flag so the UI can light up an origin chart the day the schema
   * grows such a column, without a signature change here.
   */
  hasOriginData: false;
}

// Conversation states that count as "open work" for the ops view.
const ACTIVE_CONVERSATION_STATUSES = new Set(["open", "pending"]);

interface UnitRow {
  id: string;
  name: string;
  slug: string;
  active: boolean;
}
interface ContactRow {
  unit_id: string | null;
}
interface ConversationRow {
  unit_id: string | null;
  status: string | null;
}
interface DealRow {
  unit_id: string | null;
  stage_id: string | null;
  value: number | null;
  status: string | null;
}
interface StageRow {
  id: string;
  name: string | null;
  position: number | null;
  color: string | null;
}

/**
 * Compute the consolidated multi-unit metrics for an account.
 *
 * @param client  A Supabase client already RLS-scoped to the caller.
 *                For the account totals to include every unit, the
 *                caller must be admin+ (agents/viewers are unit-scoped
 *                by RLS and would only ever see their own unit).
 * @param accountId  The account whose units to aggregate.
 */
export async function getConsolidatedMetrics(
  client: SupabaseClient,
  accountId: string,
): Promise<ConsolidatedMetrics> {
  const [unitsRes, contactsRes, conversationsRes, dealsRes, stagesRes] =
    await Promise.all([
      client
        .from("unidades")
        .select("id, name, slug, active")
        .eq("account_id", accountId)
        .order("created_at", { ascending: true }),
      client.from("contacts").select("unit_id").eq("account_id", accountId),
      client
        .from("conversations")
        .select("unit_id, status")
        .eq("account_id", accountId),
      client
        .from("deals")
        .select("unit_id, stage_id, value, status")
        .eq("account_id", accountId),
      // pipeline_stages carries no account_id (it's scoped via
      // pipelines.account_id + RLS), so we don't filter it here —
      // RLS already restricts it to this account's stages.
      client
        .from("pipeline_stages")
        .select("id, name, position, color")
        .order("position", { ascending: true }),
    ]);

  for (const [label, res] of [
    ["unidades", unitsRes],
    ["contacts", contactsRes],
    ["conversations", conversationsRes],
    ["deals", dealsRes],
    ["pipeline_stages", stagesRes],
  ] as const) {
    if (res.error) {
      throw new Error(
        `getConsolidatedMetrics: failed to load ${label} for account ${accountId}: ${res.error.message}`,
      );
    }
  }

  const unitRows = (unitsRes.data ?? []) as UnitRow[];
  const contactRows = (contactsRes.data ?? []) as ContactRow[];
  const conversationRows = (conversationsRes.data ?? []) as ConversationRow[];
  const dealRows = (dealsRes.data ?? []) as DealRow[];
  const stageRows = (stagesRes.data ?? []) as StageRow[];

  const stages: FunnelStageMeta[] = stageRows.map((s) => ({
    id: s.id,
    name: s.name ?? "—",
    position: s.position ?? 0,
    color: s.color || "#64748b",
  }));

  // Per-unit accumulators, keyed by unit id. Seed one bucket per known
  // unit so a unit with zero activity still shows up as a row of zeros.
  const acc = new Map<string, RawAccumulator>();
  for (const u of unitRows) acc.set(u.id, makeAccumulator());

  // Rows whose unit_id doesn't match a known unit (shouldn't happen —
  // unit_id is NOT NULL + FK — but a mid-delete race could surface one)
  // are dropped from per-unit rollups; they'd have no column to land in.
  const bumpUnit = (unitId: string | null): RawAccumulator | null => {
    if (!unitId) return null;
    return acc.get(unitId) ?? null;
  };

  for (const c of contactRows) {
    const a = bumpUnit(c.unit_id);
    if (a) a.leads += 1;
  }

  for (const conv of conversationRows) {
    const a = bumpUnit(conv.unit_id);
    if (a && conv.status && ACTIVE_CONVERSATION_STATUSES.has(conv.status)) {
      a.openConversations += 1;
    }
  }

  for (const d of dealRows) {
    const a = bumpUnit(d.unit_id);
    if (!a) continue;
    a.deals += 1;
    const value = d.value ?? 0;
    if (d.status === "won") {
      a.wonCount += 1;
      a.wonValue += value;
    }
    if (d.stage_id) {
      const stage = a.stageCounts.get(d.stage_id) ?? { count: 0, total: 0 };
      stage.count += 1;
      stage.total += value;
      a.stageCounts.set(d.stage_id, stage);
    }
  }

  const units: UnitMetrics[] = unitRows.map((u) => {
    const a = acc.get(u.id)!;
    return {
      unitId: u.id,
      unitName: u.name,
      unitSlug: u.slug,
      active: u.active,
      ...finalize(a, stages),
    };
  });

  // Account totals: sum the raw accumulators (not the finalized
  // per-unit numbers) so the conversion rate is computed on the pooled
  // won/leads, not an average of per-unit rates.
  const totalAcc = makeAccumulator();
  for (const u of unitRows) {
    const a = acc.get(u.id)!;
    totalAcc.leads += a.leads;
    totalAcc.openConversations += a.openConversations;
    totalAcc.deals += a.deals;
    totalAcc.wonCount += a.wonCount;
    totalAcc.wonValue += a.wonValue;
    for (const [stageId, sc] of a.stageCounts) {
      const t = totalAcc.stageCounts.get(stageId) ?? { count: 0, total: 0 };
      t.count += sc.count;
      t.total += sc.total;
      totalAcc.stageCounts.set(stageId, t);
    }
  }

  return {
    units,
    totals: finalize(totalAcc, stages),
    stages,
    hasOriginData: false,
  };
}

// ------------------------------------------------------------
// Internal accumulation helpers
// ------------------------------------------------------------

interface RawAccumulator {
  leads: number;
  openConversations: number;
  deals: number;
  wonCount: number;
  wonValue: number;
  stageCounts: Map<string, { count: number; total: number }>;
}

function makeAccumulator(): RawAccumulator {
  return {
    leads: 0,
    openConversations: 0,
    deals: 0,
    wonCount: 0,
    wonValue: 0,
    stageCounts: new Map(),
  };
}

function finalize(a: RawAccumulator, stages: FunnelStageMeta[]): MetricTotals {
  return {
    leads: a.leads,
    openConversations: a.openConversations,
    deals: a.deals,
    wonCount: a.wonCount,
    wonValue: a.wonValue,
    conversionRate: a.leads > 0 ? a.wonCount / a.leads : 0,
    // Emit one funnel entry per known stage, in board order, so every
    // unit's funnel lines up column-for-column in the UI.
    funnel: stages.map((s) => {
      const sc = a.stageCounts.get(s.id) ?? { count: 0, total: 0 };
      return {
        stageId: s.id,
        stageName: s.name,
        dealCount: sc.count,
        totalValue: sc.total,
      };
    }),
  };
}
