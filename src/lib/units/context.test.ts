import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getSelectedUnitId, getVisibleUnits, type Unit } from "./context";

// ------------------------------------------------------------
// Chainable Supabase stub, same shape as `default-unit.test.ts`.
// Records the filters/order used so tests can assert the exact
// query shape per role branch, and resolves the terminal call
// (`.order()` acts as terminal for the admin/list branch since the
// route awaits the builder directly; `.maybeSingle()` is terminal
// for the agent/single-unit branch).
// ------------------------------------------------------------
interface Calls {
  table: string;
  eq: [string, unknown][];
  order?: { column: string; ascending?: boolean };
}

function makeDb(result: { data: unknown; error: unknown }): {
  db: SupabaseClient;
  calls: Calls;
} {
  const calls: Calls = { table: "", eq: [] };
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: (col: string, val: unknown) => {
      calls.eq.push([col, val]);
      return builder;
    },
    order: (column: string, opts?: { ascending?: boolean }) => {
      calls.order = { column, ascending: opts?.ascending };
      return builder;
    },
    maybeSingle: () => Promise.resolve(result),
    // The admin/list branch awaits the builder directly (no terminal
    // method call) — make the builder itself thenable so `await`
    // resolves to the scripted result.
    then: (
      resolve: (value: { data: unknown; error: unknown }) => void,
      reject: (reason: unknown) => void,
    ) => Promise.resolve(result).then(resolve, reject),
  };
  const db = {
    from: (t: string) => {
      calls.table = t;
      return builder;
    },
  } as unknown as SupabaseClient;
  return { db, calls };
}

describe("getVisibleUnits", () => {
  it("admin sees every unidade in the account, oldest first", async () => {
    const units: Unit[] = [
      { id: "u1", name: "Matriz", slug: "matriz", active: true },
      { id: "u2", name: "Filial", slug: "filial", active: true },
    ];
    const { db, calls } = makeDb({ data: units, error: null });

    const result = await getVisibleUnits(
      { account_id: "acct-1", account_role: "admin", unit_id: null },
      db,
    );

    expect(result).toEqual(units);
    expect(calls.table).toBe("unidades");
    expect(calls.eq).toEqual([["account_id", "acct-1"]]);
    expect(calls.order).toEqual({ column: "created_at", ascending: true });
  });

  it("owner sees every unidade too (role >= admin)", async () => {
    const units: Unit[] = [
      { id: "u1", name: "Matriz", slug: "matriz", active: true },
    ];
    const { db } = makeDb({ data: units, error: null });

    const result = await getVisibleUnits(
      { account_id: "acct-1", account_role: "owner", unit_id: null },
      db,
    );

    expect(result).toEqual(units);
  });

  it("agent sees only their assigned unit", async () => {
    const unit: Unit = { id: "u2", name: "Filial", slug: "filial", active: true };
    const { db, calls } = makeDb({ data: unit, error: null });

    const result = await getVisibleUnits(
      { account_id: "acct-1", account_role: "agent", unit_id: "u2" },
      db,
    );

    expect(result).toEqual([unit]);
    expect(calls.table).toBe("unidades");
    expect(calls.eq).toEqual([
      ["id", "u2"],
      ["account_id", "acct-1"],
    ]);
  });

  it("viewer sees only their assigned unit", async () => {
    const unit: Unit = { id: "u2", name: "Filial", slug: "filial", active: true };
    const { db } = makeDb({ data: unit, error: null });

    const result = await getVisibleUnits(
      { account_id: "acct-1", account_role: "viewer", unit_id: "u2" },
      db,
    );

    expect(result).toEqual([unit]);
  });

  it("returns [] for an unassigned agent without querying the db", async () => {
    const { db, calls } = makeDb({ data: null, error: null });

    const result = await getVisibleUnits(
      { account_id: "acct-1", account_role: "agent", unit_id: null },
      db,
    );

    expect(result).toEqual([]);
    expect(calls.table).toBe(""); // never called .from()
  });

  it("returns [] when the assigned unit no longer resolves (deleted/foreign)", async () => {
    const { db } = makeDb({ data: null, error: null });

    const result = await getVisibleUnits(
      { account_id: "acct-1", account_role: "agent", unit_id: "gone" },
      db,
    );

    expect(result).toEqual([]);
  });

  it("throws when the admin list query errors", async () => {
    const { db } = makeDb({ data: null, error: { message: "boom" } });
    await expect(
      getVisibleUnits(
        { account_id: "acct-1", account_role: "admin", unit_id: null },
        db,
      ),
    ).rejects.toThrow(/boom/);
  });

  it("throws when the agent single-unit query errors", async () => {
    const { db } = makeDb({ data: null, error: { message: "boom" } });
    await expect(
      getVisibleUnits(
        { account_id: "acct-1", account_role: "agent", unit_id: "u2" },
        db,
      ),
    ).rejects.toThrow(/boom/);
  });
});

describe("getSelectedUnitId", () => {
  const visibleUnits: Unit[] = [
    { id: "u1", name: "Matriz", slug: "matriz", active: true },
    { id: "u2", name: "Filial", slug: "filial", active: true },
  ];

  it("admin: honors the cookie when it names a visible unit", () => {
    const id = getSelectedUnitId(
      { account_id: "acct-1", account_role: "admin", unit_id: null },
      "u2",
      visibleUnits,
    );
    expect(id).toBe("u2");
  });

  it("admin: falls back to null (all units) when there is no cookie", () => {
    const id = getSelectedUnitId(
      { account_id: "acct-1", account_role: "admin", unit_id: null },
      null,
      visibleUnits,
    );
    expect(id).toBeNull();
  });

  it("admin: falls back to null when the cookie names a unit that isn't visible", () => {
    const id = getSelectedUnitId(
      { account_id: "acct-1", account_role: "admin", unit_id: null },
      "deleted-unit",
      visibleUnits,
    );
    expect(id).toBeNull();
  });

  it("owner: same cookie-honoring behavior as admin", () => {
    const id = getSelectedUnitId(
      { account_id: "acct-1", account_role: "owner", unit_id: null },
      "u1",
      visibleUnits,
    );
    expect(id).toBe("u1");
  });

  it("agent: forced to their assigned unit, cookie ignored", () => {
    const id = getSelectedUnitId(
      { account_id: "acct-1", account_role: "agent", unit_id: "u2" },
      "u1", // stray cookie pointing at a different unit
      visibleUnits,
    );
    expect(id).toBe("u2");
  });

  it("viewer: forced to their assigned unit, cookie ignored", () => {
    const id = getSelectedUnitId(
      { account_id: "acct-1", account_role: "viewer", unit_id: "u2" },
      "u1",
      visibleUnits,
    );
    expect(id).toBe("u2");
  });

  it("agent: unassigned resolves to null", () => {
    const id = getSelectedUnitId(
      { account_id: "acct-1", account_role: "agent", unit_id: null },
      "u1",
      visibleUnits,
    );
    expect(id).toBeNull();
  });
});
