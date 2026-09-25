import { beforeEach, describe, expect, it } from "vitest";
import { __setCacheForTest, getLicenseStatus } from "./state";

describe("getLicenseStatus (fail-open)", () => {
  beforeEach(() => {
    __setCacheForTest(null);
  });

  it("returns 'active' when the store throws and there is no cache yet", async () => {
    const client = {
      from: () => ({
        select: () => ({
          maybeSingle: () => Promise.reject(new Error("connection refused")),
        }),
      }),
    };
    expect(await getLicenseStatus(client)).toBe("active");
  });

  it("returns the stored status on a healthy read", async () => {
    const client = {
      from: () => ({
        select: () => ({
          maybeSingle: () =>
            Promise.resolve({ data: { status: "suspended" }, error: null }),
        }),
      }),
    };
    expect(await getLicenseStatus(client)).toBe("suspended");
  });

  it("keeps serving the last good cached status when the store later throws", async () => {
    const healthyClient = {
      from: () => ({
        select: () => ({
          maybeSingle: () =>
            Promise.resolve({ data: { status: "suspended" }, error: null }),
        }),
      }),
    };
    expect(await getLicenseStatus(healthyClient)).toBe("suspended");

    const brokenClient = {
      from: () => ({
        select: () => ({
          maybeSingle: () => Promise.reject(new Error("timeout")),
        }),
      }),
    };
    // Fail-open: still 'suspended' (last good), NOT 'active'.
    expect(await getLicenseStatus(brokenClient)).toBe("suspended");
  });

  it("treats a Supabase-style error result the same as a thrown error", async () => {
    const client = {
      from: () => ({
        select: () => ({
          maybeSingle: () =>
            Promise.resolve({ data: null, error: { message: "db down" } }),
        }),
      }),
    };
    expect(await getLicenseStatus(client)).toBe("active");
  });

  it("defaults to 'active' when the row is missing (data null, no error)", async () => {
    const client = {
      from: () => ({
        select: () => ({
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
        }),
      }),
    };
    expect(await getLicenseStatus(client)).toBe("active");
  });
});
