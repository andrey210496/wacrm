"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, Download } from "lucide-react";
import { useTranslations } from "next-intl";

import { useAuth } from "@/hooks/use-auth";
import { useUnitScope } from "@/components/units/unit-scope-provider";
import { formatCurrency } from "@/lib/currency";
import { cn } from "@/lib/utils";
import type { ConsolidatedMetrics, UnitMetrics } from "@/lib/units/metrics";

interface UnitTableProps {
  metrics: ConsolidatedMetrics;
}

/**
 * Per-unit breakdown table with two management affordances:
 *  - CSV export (client-side blob download) of exactly what's on screen.
 *  - Drill-down: clicking a unit row pins that unit (writes the same
 *    `unidade` cookie the topbar selector uses, via the shared scope
 *    provider) and jumps to the inbox scoped to it.
 */
export function UnitTable({ metrics }: UnitTableProps) {
  const t = useTranslations("Dashboard.consolidado");
  const { defaultCurrency } = useAuth();
  const { setSelectedUnitId } = useUnitScope();
  const router = useRouter();

  const drillIntoUnit = useCallback(
    (unitId: string) => {
      // Pin the unit account-wide (cookie + reactive scope), then land
      // on the inbox already filtered to it — the natural "show me this
      // unit's work" next step from a management overview.
      setSelectedUnitId(unitId);
      router.push("/inbox");
    },
    [router, setSelectedUnitId],
  );

  const exportCsv = useCallback(() => {
    const csv = buildCsv(metrics.units, {
      unit: t("colUnit"),
      leads: t("colLeads"),
      open: t("colOpen"),
      deals: t("colDeals"),
      won: t("colWonCount"),
      wonValue: t("colWonValue"),
      conversion: t("colConversion"),
    });
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `consolidado-unidades-${new Date()
      .toISOString()
      .slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [metrics.units, t]);

  return (
    <section className="rounded-xl border border-border bg-card">
      <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            {t("tableTitle")}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t("tableDescription")}
          </p>
        </div>
        <button
          type="button"
          onClick={exportCsv}
          disabled={metrics.units.length === 0}
          className={cn(
            "inline-flex shrink-0 items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-medium transition-colors",
            "text-muted-foreground hover:bg-muted hover:text-foreground",
            "disabled:pointer-events-none disabled:opacity-50",
          )}
        >
          <Download className="h-4 w-4" />
          {t("exportCsv")}
        </button>
      </header>

      {/* Own horizontal scroll container so the page body never scrolls
          sideways on narrow screens. */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="px-5 py-3 font-medium">{t("colUnit")}</th>
              <th className="px-5 py-3 text-right font-medium">
                {t("colLeads")}
              </th>
              <th className="px-5 py-3 text-right font-medium">
                {t("colOpen")}
              </th>
              <th className="px-5 py-3 text-right font-medium">
                {t("colDeals")}
              </th>
              <th className="px-5 py-3 text-right font-medium">
                {t("colWonValue")}
              </th>
              <th className="px-5 py-3 text-right font-medium">
                {t("colConversion")}
              </th>
              <th className="px-5 py-3" aria-hidden />
            </tr>
          </thead>
          <tbody>
            {metrics.units.map((u) => (
              <tr
                key={u.unitId}
                onClick={() => drillIntoUnit(u.unitId)}
                className="group cursor-pointer border-b border-border/60 transition-colors last:border-0 hover:bg-muted/50"
              >
                <td className="px-5 py-3">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-foreground">
                      {u.unitName}
                    </span>
                    {!u.active && (
                      <span className="rounded-full border border-border bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                        {t("inactive")}
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-5 py-3 text-right tabular-nums text-foreground">
                  {u.leads.toLocaleString()}
                </td>
                <td className="px-5 py-3 text-right tabular-nums text-foreground">
                  {u.openConversations.toLocaleString()}
                </td>
                <td className="px-5 py-3 text-right tabular-nums text-foreground">
                  {u.deals.toLocaleString()}
                </td>
                <td className="px-5 py-3 text-right tabular-nums text-foreground">
                  {formatCurrency(u.wonValue, defaultCurrency)}
                </td>
                <td className="px-5 py-3 text-right tabular-nums text-foreground">
                  {formatPercent(u.conversionRate)}
                </td>
                <td className="px-3 py-3 text-right">
                  <ChevronRight className="ml-auto h-4 w-4 text-muted-foreground/50 transition-colors group-hover:text-foreground" />
                </td>
              </tr>
            ))}
          </tbody>
          {metrics.units.length > 0 && (
            <tfoot>
              <tr className="border-t border-border bg-muted/30 text-sm font-semibold">
                <td className="px-5 py-3 text-foreground">{t("totalRow")}</td>
                <td className="px-5 py-3 text-right tabular-nums text-foreground">
                  {metrics.totals.leads.toLocaleString()}
                </td>
                <td className="px-5 py-3 text-right tabular-nums text-foreground">
                  {metrics.totals.openConversations.toLocaleString()}
                </td>
                <td className="px-5 py-3 text-right tabular-nums text-foreground">
                  {metrics.totals.deals.toLocaleString()}
                </td>
                <td className="px-5 py-3 text-right tabular-nums text-foreground">
                  {formatCurrency(metrics.totals.wonValue, defaultCurrency)}
                </td>
                <td className="px-5 py-3 text-right tabular-nums text-foreground">
                  {formatPercent(metrics.totals.conversionRate)}
                </td>
                <td className="px-3 py-3" aria-hidden />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </section>
  );
}

function formatPercent(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
}

interface CsvHeaders {
  unit: string;
  leads: string;
  open: string;
  deals: string;
  won: string;
  wonValue: string;
  conversion: string;
}

// Build an RFC-4180-ish CSV. Every field is quoted and inner quotes are
// doubled, so unit names with commas/quotes survive the round trip.
function buildCsv(units: UnitMetrics[], headers: CsvHeaders): string {
  const escape = (v: string | number): string =>
    `"${String(v).replace(/"/g, '""')}"`;
  const headerRow = [
    headers.unit,
    headers.leads,
    headers.open,
    headers.deals,
    headers.won,
    headers.wonValue,
    headers.conversion,
  ]
    .map(escape)
    .join(",");
  const rows = units.map((u) =>
    [
      u.unitName,
      u.leads,
      u.openConversations,
      u.deals,
      u.wonCount,
      // Raw numeric value (no currency symbol) so the CSV stays
      // machine-readable for spreadsheets.
      u.wonValue,
      (u.conversionRate * 100).toFixed(1),
    ]
      .map(escape)
      .join(","),
  );
  return [headerRow, ...rows].join("\r\n");
}
