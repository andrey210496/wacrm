"use client";

import { useMemo } from "react";
import {
  Building2,
  DollarSign,
  GitBranch,
  MessageSquare,
  TrendingUp,
  Users,
} from "lucide-react";
import { useTranslations } from "next-intl";

import { useAuth } from "@/hooks/use-auth";
import { formatCurrency } from "@/lib/currency";
import type { ConsolidatedMetrics } from "@/lib/units/metrics";
import { MetricCard } from "@/components/dashboard/metric-card";
import { EmptyState } from "@/components/dashboard/empty-state";
import { BarChart } from "@/components/tremor/bar-chart";
import type { AvailableChartColorsKeys } from "@/components/tremor/chart-colors";
import { UnitTable } from "./unit-table";

interface ConsolidatedViewProps {
  metrics: ConsolidatedMetrics;
  accountName: string;
}

// Distinct colours for the 3-series unit comparison. The funnel uses
// the chart's default rotating palette so any number of stages colours
// cleanly.
const COMPARE_COLORS: AvailableChartColorsKeys[] = ["blue", "violet", "emerald"];
const WON_VALUE_COLORS: AvailableChartColorsKeys[] = ["emerald"];

export function ConsolidatedView({
  metrics,
  accountName,
}: ConsolidatedViewProps) {
  const t = useTranslations("Dashboard.consolidado");
  const { defaultCurrency } = useAuth();

  const catLeads = t("colLeads");
  const catDeals = t("colDeals");
  const catWon = t("colWonCount");
  const catWonValue = t("colWonValue");

  // One row per unit: counts that share a scale (leads / deals / won)
  // grouped so units compare side by side.
  const comparisonData = useMemo(
    () =>
      metrics.units.map((u) => ({
        unit: u.unitName,
        [catLeads]: u.leads,
        [catDeals]: u.deals,
        [catWon]: u.wonCount,
      })),
    [metrics.units, catLeads, catDeals, catWon],
  );

  // Won value lives on its own (currency scale) chart so it isn't
  // dwarfed by / dwarfing the count bars.
  const wonValueData = useMemo(
    () =>
      metrics.units.map((u) => ({
        unit: u.unitName,
        [catWonValue]: u.wonValue,
      })),
    [metrics.units, catWonValue],
  );

  // Funnel composition per unit: stacked deal counts by stage. Stage
  // names are the series; each unit is one stacked bar.
  const funnelCategories = useMemo(
    () => dedupe(metrics.stages.map((s) => s.name)),
    [metrics.stages],
  );
  const funnelData = useMemo(
    () =>
      metrics.units.map((u) => {
        const row: Record<string, string | number> = { unit: u.unitName };
        for (const f of u.funnel) row[f.stageName] = f.dealCount;
        return row;
      }),
    [metrics.units],
  );

  // Give each unit a fixed horizontal slice so many units scroll inside
  // the chart card instead of squishing (or bleeding onto the page).
  const chartMinWidth = Math.max(metrics.units.length * 88, 360);

  const numberFmt = (v: number) => v.toLocaleString();
  const currencyFmt = (v: number) => formatCurrency(v, defaultCurrency);

  const hasUnits = metrics.units.length > 0;
  const hasStages = funnelCategories.length > 0;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="font-heading text-2xl font-bold tracking-tight text-foreground">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("description", { account: accountName })}
        </p>
      </div>

      {/* KPI row — account-wide totals */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <MetricCard
          title={t("kpiLeads")}
          value={metrics.totals.leads.toLocaleString()}
          icon={Users}
          subtitle={t("acrossUnits", { count: metrics.units.length })}
        />
        <MetricCard
          title={t("kpiOpenConversations")}
          value={metrics.totals.openConversations.toLocaleString()}
          icon={MessageSquare}
        />
        <MetricCard
          title={t("kpiDeals")}
          value={metrics.totals.deals.toLocaleString()}
          icon={GitBranch}
        />
        <MetricCard
          title={t("kpiWonValue")}
          value={formatCurrency(metrics.totals.wonValue, defaultCurrency)}
          icon={DollarSign}
          subtitle={t("wonDeals", { count: metrics.totals.wonCount })}
        />
        <MetricCard
          title={t("kpiConversion")}
          value={`${(metrics.totals.conversionRate * 100).toFixed(1)}%`}
          icon={TrendingUp}
          subtitle={t("wonPerLeads")}
        />
      </div>

      {!hasUnits ? (
        <div className="rounded-xl border border-border bg-card p-8">
          <EmptyState
            icon={Building2}
            title={t("emptyTitle")}
            hint={t("emptyHint")}
          />
        </div>
      ) : (
        <>
          {/* Unit comparison + won value */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ChartCard title={t("compareTitle")} subtitle={t("compareDescription")}>
              <div className="overflow-x-auto">
                <div style={{ minWidth: chartMinWidth }}>
                  <BarChart
                    data={comparisonData}
                    index="unit"
                    categories={[catLeads, catDeals, catWon]}
                    colors={COMPARE_COLORS}
                    valueFormatter={numberFmt}
                    yAxisWidth={44}
                    className="h-72"
                  />
                </div>
              </div>
            </ChartCard>

            <ChartCard
              title={t("wonValueTitle")}
              subtitle={t("wonValueDescription")}
            >
              <div className="overflow-x-auto">
                <div style={{ minWidth: chartMinWidth }}>
                  <BarChart
                    data={wonValueData}
                    index="unit"
                    categories={[catWonValue]}
                    colors={WON_VALUE_COLORS}
                    valueFormatter={currencyFmt}
                    showLegend={false}
                    yAxisWidth={64}
                    className="h-72"
                  />
                </div>
              </div>
            </ChartCard>
          </div>

          {/* Funnel by unit */}
          {hasStages && (
            <ChartCard
              title={t("funnelTitle")}
              subtitle={t("funnelDescription")}
            >
              <div className="overflow-x-auto">
                <div style={{ minWidth: chartMinWidth }}>
                  <BarChart
                    data={funnelData}
                    index="unit"
                    categories={funnelCategories}
                    type="stacked"
                    valueFormatter={numberFmt}
                    yAxisWidth={44}
                    className="h-80"
                  />
                </div>
              </div>
            </ChartCard>
          )}

          {/* Per-unit table with drill-down + CSV */}
          <UnitTable metrics={metrics} />
        </>
      )}
    </div>
  );
}

// Card chrome shared by the three charts — matches the dashboard's
// panel styling (bordered card, header with title + subtitle).
function ChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex h-full flex-col rounded-xl border border-border bg-card">
      <header className="border-b border-border px-5 py-4">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
      </header>
      <div className="flex-1 p-5">{children}</div>
    </section>
  );
}

// Tremor's BarChart keys series by category NAME, so duplicate stage
// names would collide into one bar. Suffix repeats to keep them
// distinct in the (rare) case an account has two same-named stages.
function dedupe(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((name) => {
    const n = seen.get(name) ?? 0;
    seen.set(name, n + 1);
    return n === 0 ? name : `${name} (${n + 1})`;
  });
}
