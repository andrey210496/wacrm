import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentAccount: vi.fn(),
  requireRole: vi.fn(),
}));

vi.mock("@/lib/auth/account", () => ({
  getCurrentAccount: mocks.getCurrentAccount,
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

import { GET, POST } from "./route";

// ------------------------------------------------------------
// Sequential-queue Supabase stub. Each `.from(table)` call consumes
// the next queued result, regardless of which terminal method
// (`.single()`, `.maybeSingle()`, or a bare `await` on the builder
// itself) the route uses to resolve it.
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
      insert: (...args: unknown[]) => {
        call.ops.push({ op: "insert", args });
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
      order: (...args: unknown[]) => {
        call.ops.push({ op: "order", args });
        return chain;
      },
      single: () => Promise.resolve(resolveNext()),
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
  return new Request("http://localhost/api/unidades", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const adminCtx = (supabase: unknown) => ({
  supabase,
  accountId: "acct-1",
  userId: "user-1",
  role: "admin",
  account: { id: "acct-1", name: "Acme" },
});

beforeEach(() => {
  mocks.getCurrentAccount.mockReset();
  mocks.requireRole.mockReset();
});

describe("GET /api/unidades", () => {
  it("lists the caller's account units", async () => {
    const units = [
      { id: "u1", name: "Matriz", slug: "matriz", active: true },
      { id: "u2", name: "Filial", slug: "filial", active: true },
    ];
    const { supabase, calls } = makeSupabase([{ data: units, error: null }]);
    mocks.getCurrentAccount.mockResolvedValue(adminCtx(supabase));

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.units).toEqual(units);
    expect(calls[0].table).toBe("unidades");
  });

  it("propagates an unauthorized caller as an error response", async () => {
    mocks.getCurrentAccount.mockRejectedValue(
      Object.assign(new Error("Unauthorized"), { status: 401 }),
    );

    const response = await GET();
    expect(response.status).toBe(401);
  });
});

describe("POST /api/unidades", () => {
  it("rejects a non-admin caller with 403", async () => {
    mocks.requireRole.mockRejectedValue(
      Object.assign(
        new Error("This action requires the 'admin' role or higher"),
        { status: 403 },
      ),
    );

    const response = await POST(jsonRequest({ name: "Unidade Centro" }));
    expect(response.status).toBe(403);
  });

  it("creates a unit with a derived slug", async () => {
    const created = {
      id: "u3",
      name: "Unidade Centro",
      slug: "unidade-centro",
      active: true,
      created_at: "2026-01-01T00:00:00.000Z",
    };
    const { supabase, calls } = makeSupabase([{ data: created, error: null }]);
    mocks.requireRole.mockResolvedValue(adminCtx(supabase));

    const response = await POST(jsonRequest({ name: "  Unidade Centro  " }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.unit).toEqual(created);
    expect(mocks.requireRole).toHaveBeenCalledWith("admin");

    const insertOp = calls[0].ops.find((o) => o.op === "insert");
    expect(insertOp?.args[0]).toEqual({
      account_id: "acct-1",
      name: "Unidade Centro",
      slug: "unidade-centro",
    });
  });

  it("returns 409 on a duplicate slug within the account", async () => {
    const { supabase } = makeSupabase([
      {
        data: null,
        error: { code: "23505", message: "duplicate key value" },
      },
    ]);
    mocks.requireRole.mockResolvedValue(adminCtx(supabase));

    const response = await POST(jsonRequest({ name: "Matriz" }));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toMatch(/already exists/i);
  });

  it("rejects an empty name before touching the db", async () => {
    const { supabase, calls } = makeSupabase([]);
    mocks.requireRole.mockResolvedValue(adminCtx(supabase));

    const response = await POST(jsonRequest({ name: "   " }));
    expect(response.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("rejects a name that slugifies to nothing", async () => {
    const { supabase, calls } = makeSupabase([]);
    mocks.requireRole.mockResolvedValue(adminCtx(supabase));

    const response = await POST(jsonRequest({ name: "***" }));
    expect(response.status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});
