import { beforeEach, describe, expect, it, vi } from "vitest";

// isSuspended() only needs a Supabase client object to hand to
// getLicenseStatus() — the client's shape doesn't matter since
// getLicenseStatus itself is mocked below, so a stub is fine here.
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({}),
}));

const { getLicenseStatus } = vi.hoisted(() => ({
  getLicenseStatus: vi.fn(),
}));
vi.mock("@/lib/license/state", () => ({ getLicenseStatus }));

const { isSuspended } = await import("./guard");

describe("isSuspended", () => {
  beforeEach(() => {
    getLicenseStatus.mockReset();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
  });

  it("returns true when the license is suspended", async () => {
    getLicenseStatus.mockResolvedValue("suspended");
    expect(await isSuspended()).toBe(true);
  });

  it("returns false when the license is active", async () => {
    getLicenseStatus.mockResolvedValue("active");
    expect(await isSuspended()).toBe(false);
  });

  it("fails open (false) when the underlying read throws", async () => {
    // getLicenseStatus itself is fail-open and never rejects in
    // practice, but isSuspended has its own try/catch as a second
    // layer: a control-plane / DB outage must never lock a paying
    // client out of their own dashboard.
    getLicenseStatus.mockRejectedValue(new Error("db down"));
    expect(await isSuspended()).toBe(false);
  });
});
