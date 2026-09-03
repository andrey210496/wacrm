"use client";

// ============================================================
// Topbar unit ("unidade") selector — the management-side filter admins
// use to narrow the whole dashboard to one unit or view all of them.
// (RLS already pins agents/viewers to their own unit; for them this is
// a read-only label, not a switch.)
// ============================================================

import { useRouter } from "next/navigation";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Unit } from "@/lib/units/context";

import { useUnitScope } from "./unit-scope-provider";

// Sentinel for the "all units" option — base-ui Select needs a
// non-empty string value, so `null` can't be the item value directly.
const ALL_UNITS_VALUE = "__all__";

interface UnitSelectorProps {
  units: Unit[];
  selectedUnitId: string | null;
  canSeeAll: boolean;
}

export function UnitSelector({
  units,
  selectedUnitId,
  canSeeAll,
}: UnitSelectorProps) {
  const router = useRouter();
  const { setSelectedUnitId } = useUnitScope();

  // One unit (or none) in the whole account — nothing to switch
  // between, so keep the shell clean.
  if (units.length <= 1) return null;

  // agent/viewer: pinned to their unit by RLS + `getSelectedUnitId`.
  // Show the unit name as a static label, not a control.
  if (!canSeeAll) {
    const label =
      units.find((u) => u.id === selectedUnitId)?.name ?? units[0]?.name ?? "";
    return (
      <span
        className="hidden max-w-[11rem] truncate text-sm font-medium text-muted-foreground sm:inline"
        title={label}
      >
        {label}
      </span>
    );
  }

  const value = selectedUnitId ?? ALL_UNITS_VALUE;
  const currentLabel =
    units.find((u) => u.id === selectedUnitId)?.name ?? "Todas as unidades";

  const handleChange = (next: string | null) => {
    if (!next) return;
    const unitId = next === ALL_UNITS_VALUE ? null : next;
    setSelectedUnitId(unitId);
    // Keep server components (and the next navigation's SSR scope) in
    // sync with the choice the client state already applied.
    router.refresh();
  };

  return (
    <Select value={value} onValueChange={handleChange}>
      <SelectTrigger
        size="sm"
        aria-label="Unidade"
        className="max-w-[12rem] bg-background"
      >
        <SelectValue>{currentLabel}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL_UNITS_VALUE}>Todas as unidades</SelectItem>
        {units.map((u) => (
          <SelectItem key={u.id} value={u.id}>
            {u.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
