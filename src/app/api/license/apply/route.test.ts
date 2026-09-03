import { beforeEach, describe, expect, it, vi } from "vitest";

const upsertMock = vi.fn(async (): Promise<{ error: { message: string } | null }> => ({
  error: null,
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: (table: string) => {
      if (table === "license_state") {
        return { upsert: upsertMock };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  }),
}));

beforeEach(() => {
  process.env.LICENSE_CONTROL_SECRET = "shhh";
  upsertMock.mockClear();
});

describe("POST /api/license/apply", () => {
  it("rejects without the shared secret", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://x/api/license/apply", {
        method: "POST",
        body: JSON.stringify({ status: "suspended" }),
      }),
    );
    expect(res.status).toBe(401);
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("rejects a wrong secret", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://x/api/license/apply", {
        method: "POST",
        headers: { "x-license-secret": "nope" },
        body: JSON.stringify({ status: "suspended" }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("rejects when LICENSE_CONTROL_SECRET is unset", async () => {
    delete process.env.LICENSE_CONTROL_SECRET;
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://x/api/license/apply", {
        method: "POST",
        headers: { "x-license-secret": "shhh" },
        body: JSON.stringify({ status: "suspended" }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("rejects an invalid status", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://x/api/license/apply", {
        method: "POST",
        headers: { "x-license-secret": "shhh" },
        body: JSON.stringify({ status: "bogus" }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("upserts license_state and returns 200 with the correct secret", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://x/api/license/apply", {
        method: "POST",
        headers: { "x-license-secret": "shhh" },
        body: JSON.stringify({ status: "suspended", reason: "past due" }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, status: "suspended" });
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: true, status: "suspended", reason: "past due" }),
    );
  });

  it("returns 500 when the upsert fails", async () => {
    upsertMock.mockResolvedValueOnce({ error: { message: "db down" } });
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://x/api/license/apply", {
        method: "POST",
        headers: { "x-license-secret": "shhh" },
        body: JSON.stringify({ status: "active" }),
      }),
    );
    expect(res.status).toBe(500);
  });
});
