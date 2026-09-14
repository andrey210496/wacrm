import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const mocks = vi.hoisted(() => ({
  getCurrentAccount: vi.fn(),
  cookieValue: undefined as string | undefined,
}));

vi.mock("@/lib/auth/account", () => ({
  getCurrentAccount: mocks.getCurrentAccount,
}));

vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) =>
        name === "unidade" && mocks.cookieValue !== undefined
          ? { value: mocks.cookieValue }
          : undefined,
    }),
}));

import { getActiveUnitFilter } from "./active-unit";

// ------------------------------------------------------------
// Supabase stub dispatching by table:
//   profiles  -> .select().eq().maybeSingle()   (unit_id lookup)
//   unidades  -> admin: .select().eq().order()  (awaited directly)
//                agent: .select().eq().eq().maybeSingle()
// ------------------------------------------------------------
function makeSupabase(opts: {
  unitId: string | null;
  unidades: unknown; // array (admin) or single row / null (agent)
}): SupabaseClient {
  const build = (table: string) => {
    const result =
      table === "profiles"
        ? { data: { unit_id: opts.unitId }, error: null }
        : { data: opts.unidades, error: null };
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      order: () => builder,
      maybeSingle: () => Promise.resolve(result),
      then: (
        resolve: (v: { data: unknown; error: unknown }) => void,
        reject: (r: unknown) => void,
      ) => Promise.resolve(result).then(resolve, reject),
    };
    return builder;
  };
  return { from: (t: string) => build(t) } as unknown as SupabaseClient;
}

const units = [
  { id: "u1", name: "Matriz", slug: "matriz", active: true },
  { id: "u2", name: "Filial", slug: "filial", active: true },
];

beforeEach(() => {
  mocks.cookieValue = undefined;
});

describe("getActiveUnitFilter", () => {
  it("admin with a cookie pointing at a visible unit selects it", async () => {
    mocks.cookieValue = "u2";
    mocks.getCurrentAccount.mockResolvedValue({
      supabase: makeSupabase({ unitId: null, unidades: units }),
      userId: "user-1",
      accountId: "acct-1",
      role: "admin",
      account: { id: "acct-1", name: "Acme" },
    });

    const result = await getActiveUnitFilter();

    expect(result.canSeeAll).toBe(true);
    expect(result.visibleUnits).toEqual(units);
    expect(result.selectedUnitId).toBe("u2");
  });

  it("admin without a cookie falls back to all units (null)", async () => {
    mocks.getCurrentAccount.mockResolvedValue({
      supabase: makeSupabase({ unitId: null, unidades: units }),
      userId: "user-1",
      accountId: "acct-1",
      role: "owner",
      account: { id: "acct-1", name: "Acme" },
    });

    const result = await getActiveUnitFilter();

    expect(result.canSeeAll).toBe(true);
    expect(result.selectedUnitId).toBeNull();
  });

  it("admin whose cookie names an invisible unit falls back to null", async () => {
    mocks.cookieValue = "deleted-unit";
    mocks.getCurrentAccount.mockResolvedValue({
      supabase: makeSupabase({ unitId: null, unidades: units }),
      userId: "user-1",
      accountId: "acct-1",
      role: "admin",
      account: { id: "acct-1", name: "Acme" },
    });

    const result = await getActiveUnitFilter();

    expect(result.selectedUnitId).toBeNull();
  });

  it("agent is pinned to their assigned unit and cookie is ignored", async () => {
    mocks.cookieValue = "u1"; // stray cookie pointing elsewhere
    mocks.getCurrentAccount.mockResolvedValue({
      supabase: makeSupabase({ unitId: "u2", unidades: units[1] }),
      userId: "user-2",
      accountId: "acct-1",
      role: "agent",
      account: { id: "acct-1", name: "Acme" },
    });

    const result = await getActiveUnitFilter();

    expect(result.canSeeAll).toBe(false);
    expect(result.visibleUnits).toEqual([units[1]]);
    expect(result.selectedUnitId).toBe("u2");
  });

  it("unassigned agent sees no units and no selection", async () => {
    mocks.getCurrentAccount.mockResolvedValue({
      supabase: makeSupabase({ unitId: null, unidades: null }),
      userId: "user-3",
      accountId: "acct-1",
      role: "viewer",
      account: { id: "acct-1", name: "Acme" },
    });

    const result = await getActiveUnitFilter();

    expect(result.canSeeAll).toBe(false);
    expect(result.visibleUnits).toEqual([]);
    expect(result.selectedUnitId).toBeNull();
  });
});
