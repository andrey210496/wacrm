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

import { DELETE, PATCH } from "./route";

// ------------------------------------------------------------
// Sequential-queue Supabase stub — see route.test.ts (sibling file)
// for the same pattern. Each `.from(table)` call consumes the next
// queued result. `count` is threaded through for the head-count
// query the DELETE guard uses.
// ------------------------------------------------------------
interface QueuedResult {
  data?: unknown;
  error?: unknown;
  count?: number;
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
      delete: (...args: unknown[]) => {
        call.ops.push({ op: "delete", args });
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

function jsonRequest(method: "PATCH" | "DELETE", body?: unknown) {
  return new Request("http://localhost/api/unidades/u1", {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const params = { params: Promise.resolve({ id: "u1" }) };

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

describe("PATCH /api/unidades/[id]", () => {
  it("rejects a non-admin caller with 403", async () => {
    mocks.requireRole.mockRejectedValue(
      Object.assign(new Error("Forbidden"), { status: 403 }),
    );

    const response = await PATCH(
      jsonRequest("PATCH", { name: "Nova Unidade" }),
      params,
    );
    expect(response.status).toBe(403);
  });

  it("renames a unit and re-derives its slug", async () => {
    const updated = {
      id: "u1",
      name: "Nova Unidade",
      slug: "nova-unidade",
      active: true,
      created_at: "2026-01-01T00:00:00.000Z",
    };
    const { supabase, calls } = makeSupabase([{ data: updated, error: null }]);
    mocks.requireRole.mockResolvedValue(adminCtx(supabase));

    const response = await PATCH(
      jsonRequest("PATCH", { name: "Nova Unidade" }),
      params,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.unit).toEqual(updated);

    const updateOp = calls[0].ops.find((o) => o.op === "update");
    expect(updateOp?.args[0]).toEqual({
      name: "Nova Unidade",
      slug: "nova-unidade",
    });
  });

  it("toggles active without touching the name", async () => {
    const updated = {
      id: "u1",
      name: "Matriz",
      slug: "matriz",
      active: false,
      created_at: "2026-01-01T00:00:00.000Z",
    };
    const { supabase, calls } = makeSupabase([{ data: updated, error: null }]);
    mocks.requireRole.mockResolvedValue(adminCtx(supabase));

    const response = await PATCH(
      jsonRequest("PATCH", { active: false }),
      params,
    );
    expect(response.status).toBe(200);

    const updateOp = calls[0].ops.find((o) => o.op === "update");
    expect(updateOp?.args[0]).toEqual({ active: false });
  });

  it("returns 404 when the unit doesn't belong to the caller's account", async () => {
    const { supabase } = makeSupabase([{ data: null, error: null }]);
    mocks.requireRole.mockResolvedValue(adminCtx(supabase));

    const response = await PATCH(
      jsonRequest("PATCH", { name: "Nova Unidade" }),
      params,
    );
    expect(response.status).toBe(404);
  });

  it("returns 409 when the rename collides with an existing slug", async () => {
    const { supabase } = makeSupabase([
      { data: null, error: { code: "23505", message: "duplicate key" } },
    ]);
    mocks.requireRole.mockResolvedValue(adminCtx(supabase));

    const response = await PATCH(
      jsonRequest("PATCH", { name: "Matriz" }),
      params,
    );
    expect(response.status).toBe(409);
  });

  it("rejects a body with neither name nor active", async () => {
    const { supabase, calls } = makeSupabase([]);
    mocks.requireRole.mockResolvedValue(adminCtx(supabase));

    const response = await PATCH(jsonRequest("PATCH", {}), params);
    expect(response.status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});

describe("DELETE /api/unidades/[id]", () => {
  it("rejects a non-admin caller with 403", async () => {
    mocks.requireRole.mockRejectedValue(
      Object.assign(new Error("Forbidden"), { status: 403 }),
    );

    const response = await DELETE(jsonRequest("DELETE"), params);
    expect(response.status).toBe(403);
  });

  it("returns 404 when the unit doesn't belong to the caller's account", async () => {
    const { supabase } = makeSupabase([{ data: null, error: null }]);
    mocks.requireRole.mockResolvedValue(adminCtx(supabase));

    const response = await DELETE(jsonRequest("DELETE"), params);
    expect(response.status).toBe(404);
  });

  it("refuses to delete the account's only unit", async () => {
    const { supabase, calls } = makeSupabase([
      { data: { id: "u1" }, error: null }, // ownership lookup
      { data: null, error: null, count: 1 }, // count query
    ]);
    mocks.requireRole.mockResolvedValue(adminCtx(supabase));

    const response = await DELETE(jsonRequest("DELETE"), params);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toMatch(/only unit/i);
    // Guard 1 short-circuits before the whatsapp_config check.
    expect(calls.map((c) => c.table)).toEqual(["unidades", "unidades"]);
  });

  it("refuses to delete a unit with a connected WhatsApp number", async () => {
    const { supabase } = makeSupabase([
      { data: { id: "u1" }, error: null }, // ownership lookup
      { data: null, error: null, count: 3 }, // count query (not the only unit)
      { data: { id: "wc1" }, error: null }, // whatsapp_config lookup
    ]);
    mocks.requireRole.mockResolvedValue(adminCtx(supabase));

    const response = await DELETE(jsonRequest("DELETE"), params);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toMatch(/connected whatsapp/i);
  });

  it("deletes a unit that is empty and not the account's only unit", async () => {
    const { supabase, calls } = makeSupabase([
      { data: { id: "u1" }, error: null }, // ownership lookup
      { data: null, error: null, count: 2 }, // count query
      { data: null, error: null }, // whatsapp_config lookup — none connected
      { data: null, error: null }, // delete
    ]);
    mocks.requireRole.mockResolvedValue(adminCtx(supabase));

    const response = await DELETE(jsonRequest("DELETE"), params);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(calls[3].ops.some((o) => o.op === "delete")).toBe(true);
  });
});
