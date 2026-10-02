"use client";

// ============================================================
// Client-side source of truth for the active unit ("unidade").
//
// The dashboard's list pages fetch their own data in the browser
// (client components, not server loaders), so `router.refresh()` alone
// can't re-scope them. This provider holds the selected unit as
// reactive state: the selector updates it (persisting to the cookie so
// the choice survives reloads / SSR), and list pages read it and
// re-query when it changes.
//
// The server (`getActiveUnitFilter`) resolves the initial value from
// the cookie + role rules and hands it in as `initial`, so the first
// paint is already correctly scoped.
// ============================================================

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";

import type { Unit } from "@/lib/units/context";
import { writeUnitCookie } from "@/lib/units/cookie";

export interface UnitScopeValue {
  /** Active unit id, or `null` for "all units" (admin+ only). */
  selectedUnitId: string | null;
  /** Units the caller may see — drives the selector options. */
  visibleUnits: Unit[];
  /** True for admin+ (offered the "all units" option). */
  canSeeAll: boolean;
  /** Persist + broadcast a new selection (`null` = all units). */
  setSelectedUnitId: (unitId: string | null) => void;
}

// Fallback for consumers rendered outside a provider (shouldn't happen
// in the dashboard, but keeps them from crashing). The setter still
// writes the cookie so a standalone selector degrades gracefully.
const DEFAULT_SCOPE: UnitScopeValue = {
  selectedUnitId: null,
  visibleUnits: [],
  canSeeAll: false,
  setSelectedUnitId: (unitId) => writeUnitCookie(unitId),
};

const UnitScopeContext = createContext<UnitScopeValue | null>(null);

export interface UnitScopeInitial {
  selectedUnitId: string | null;
  visibleUnits: Unit[];
  canSeeAll: boolean;
}

export function UnitScopeProvider({
  initial,
  children,
}: {
  initial: UnitScopeInitial;
  children: ReactNode;
}) {
  const [selectedUnitId, setSelected] = useState<string | null>(
    initial.selectedUnitId,
  );

  const setSelectedUnitId = useCallback((unitId: string | null) => {
    writeUnitCookie(unitId);
    setSelected(unitId);
  }, []);

  // `visibleUnits` / `canSeeAll` are read straight from `initial` (not
  // state) so a server re-render — e.g. after an admin adds a unit and
  // the layout re-resolves — flows through without stale caching.
  return (
    <UnitScopeContext.Provider
      value={{
        selectedUnitId,
        visibleUnits: initial.visibleUnits,
        canSeeAll: initial.canSeeAll,
        setSelectedUnitId,
      }}
    >
      {children}
    </UnitScopeContext.Provider>
  );
}

/** Read the active-unit scope. Returns a safe default outside a provider. */
export function useUnitScope(): UnitScopeValue {
  return useContext(UnitScopeContext) ?? DEFAULT_SCOPE;
}
