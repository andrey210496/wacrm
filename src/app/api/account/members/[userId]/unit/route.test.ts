import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
}));

vi.mock("@/lib/auth/account", () => ({
  requireRole: mocks.requireRole,
  toErrorResponse: vi.fn((err: { status?: number; message?: string }) =>
    Response.json(
      { error: err?.message ?? "error" },
      { status: err?.status ?? 500 },
    ),
  ),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(() => ({
    success: true,
    remaining: 10,
    reset: 0,
    limit: 10,
  })),
  rateLimitResponse: vi.fn(() =>
    Response.json({ error: "rate limited" }, { status: 429 }),
  ),
  RATE_LIMITS: { adminAction: { limit: 10, windowMs: 60_000 } },
}));

import { PATCH } from "./route";

// ------------------------------------------------------------
// Sequential-queue Supabase stub — same pattern as the unidades
// route tests. Each `.from(table)` call consumes the next queued
// result.
// ------------------------------------------------------------
interface QueuedResult {
  data?: unknown;
  error?: unknown;
}

interface Call {
  table: string;
  ops: { op: string; args: unknown[] }[];
}

function makeSupabase(queue: QueuedResult[]) {
  let i = 0;
  const calls: Call[] = [];

  function from(table: string) {
    const call: Call = { table, ops: [] };
    calls.push(call);

    const resolveNext = () => {
      const result = queue[Math.min(i, queue.length - 1)] ?? {
        data: null,
        error: null,
      };
      i += 1;
      return result;
    };

    const chain = {
      select: (...args: unknown[]) => {
        call.ops.push({ op: "select", args });
        return chain;
      },
      update: (...args: unknown[]) => {
        call.ops.push({ op: "update", args });
        return chain;
      },
      eq: (...args: unknown[]) => {
        call.ops.push({ op: "eq", args });
        return chain;
      },
      maybeSingle: () => Promise.resolve(resolveNext()),
      then: (
        resolve: (v: QueuedResult) => void,
        reject: (e: unknown) => void,
      ) => Promise.resolve(resolveNext()).then(resolve, reject),
    };
    return chain;
  }

  return { supabase: { from } as unknown, calls };
}

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/account/members/user-2/unit", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const params = { params: Promise.resolve({ userId: "user-2" }) };

const adminCtx = (supabase: unknown) => ({
  supabase,
  accountId: "acct-1",
  userId: "user-1",
  role: "admin",
  account: { id: "acct-1", name: "Acme" },
});

beforeEach(() => {
  mocks.requireRole.mockReset();
});

describe("PATCH /api/account/members/[userId]/unit", () => {
  it("rejects a non-admin caller with 403", async () => {
    mocks.requireRole.mockRejectedValue(
      Object.assign(new Error("Forbidden"), { status: 403 }),
    );

    const response = await PATCH(jsonRequest({ unitId: "u1" }), params);
    expect(response.status).toBe(403);
  });

  it("assigns a unit and updates profiles.unit_id", async () => {
    const updatedMember = {
      user_id: "user-2",
      full_name: "Ana",
      account_role: "agent",
      unit_id: "u1",
    };
    const { supabase, calls } = makeSupabase([
      { data: { id: "u1" }, error: null }, // unit belongs-to-account lookup
      { data: updatedMember, error: null }, // profiles update
    ]);
    mocks.requireRole.mockResolvedValue(adminCtx(supabase));

    const response = await PATCH(jsonRequest({ unitId: "u1" }), params);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.member).toEqual(updatedMember);
    expect(mocks.requireRole).toHaveBeenCalledWith("admin");

    expect(calls[0].table).toBe("unidades");
    expect(calls[1].table).toBe("profiles");
    const updateOp = calls[1].ops.find((o) => o.op === "update");
    expect(updateOp?.args[0]).toEqual({ unit_id: "u1" });
  });

  it("clears the assignment when unitId is null, without a unit lookup", async () => {
    const updatedMember = {
      user_id: "user-2",
      full_name: "Ana",
      account_role: "agent",
      unit_id: null,
    };
    const { supabase, calls } = makeSupabase([
      { data: updatedMember, error: null }, // profiles update only
    ]);
    mocks.requireRole.mockResolvedValue(adminCtx(supabase));

    const response = await PATCH(jsonRequest({ unitId: null }), params);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.member.unit_id).toBeNull();
    expect(calls).toHaveLength(1);
    expect(calls[0].table).toBe("profiles");
  });

  it("rejects a unit id from a different account", async () => {
    const { supabase, calls } = makeSupabase([
      { data: null, error: null }, // unit lookup finds nothing (foreign account)
    ]);
    mocks.requireRole.mockResolvedValue(adminCtx(supabase));

    const response = await PATCH(jsonRequest({ unitId: "foreign-unit" }), params);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/not found/i);
    // Never reaches the profiles update.
    expect(calls.map((c) => c.table)).toEqual(["unidades"]);
  });

  it("returns 404 when the target member isn't in the caller's account", async () => {
    const { supabase } = makeSupabase([
      { data: { id: "u1" }, error: null }, // unit lookup ok
      { data: null, error: null }, // profiles update matches nothing
    ]);
    mocks.requireRole.mockResolvedValue(adminCtx(supabase));

    const response = await PATCH(jsonRequest({ unitId: "u1" }), params);
    expect(response.status).toBe(404);
  });

  it("rejects a missing unitId field", async () => {
    const { supabase, calls } = makeSupabase([]);
    mocks.requireRole.mockResolvedValue(adminCtx(supabase));

    const response = await PATCH(new Request("http://localhost/api/account/members/user-2/unit", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }), params);

    expect(response.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("rejects a non-string, non-null unitId", async () => {
    const { supabase, calls } = makeSupabase([]);
    mocks.requireRole.mockResolvedValue(adminCtx(supabase));

    const response = await PATCH(jsonRequest({ unitId: 42 }), params);
    expect(response.status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});
