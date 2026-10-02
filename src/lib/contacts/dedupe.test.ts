import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  dedupeByPhone,
  findExistingContact,
  isExactMatch,
  isUniqueViolation,
  normalizeKey,
} from "./dedupe";

describe("normalizeKey", () => {
  it("strips every non-digit", () => {
    expect(normalizeKey("+1 (555) 123-4567")).toBe("15551234567");
    expect(normalizeKey("15551234567")).toBe("15551234567");
  });

  it("collapses different formats of the same number to one key", () => {
    expect(normalizeKey("+44 7911 123456")).toBe(normalizeKey("447911123456"));
  });
});

describe("isExactMatch", () => {
  it("treats different formatting of the same digits as exact", () => {
    expect(isExactMatch({ id: "1", phone: "+1 555-123-4567" }, "15551234567")).toBe(
      true,
    );
  });

  it("is false for a trunk-variant (fuzzy) match", () => {
    // last-8 match but not the same full number
    expect(isExactMatch({ id: "1", phone: "37063949836" }, "370063949836")).toBe(
      false,
    );
  });
});

describe("isUniqueViolation", () => {
  it("detects Postgres 23505", () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
  });
  it("is false for other errors / non-objects", () => {
    expect(isUniqueViolation({ code: "23502" })).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation("boom")).toBe(false);
  });
});

describe("dedupeByPhone", () => {
  it("keeps the first occurrence and counts in-file duplicates", () => {
    const { unique, duplicates } = dedupeByPhone([
      { phone: "+1 555-1111", name: "A" },
      { phone: "15551111", name: "B" }, // same digits as #1
      { phone: "+1 555-2222", name: "C" },
    ]);
    expect(unique.map((r) => r.name)).toEqual(["A", "C"]);
    expect(duplicates).toBe(1);
  });

  it("drops rows with no digits", () => {
    const { unique, duplicates } = dedupeByPhone([
      { phone: "   " },
      { phone: "+1 555-3333" },
    ]);
    expect(unique).toHaveLength(1);
    expect(duplicates).toBe(1);
  });
});

describe("findExistingContact", () => {
  // Minimal SupabaseClient stub: resolves the .from().select().eq().eq().like()
  // chain to a fixed candidate set.
  function stubDb(rows: Array<{ id: string; phone: string }>): SupabaseClient {
    const builder = {
      select: () => builder,
      eq: () => builder,
      like: () => Promise.resolve({ data: rows, error: null }),
    };
    return { from: () => builder } as unknown as SupabaseClient;
  }

  it("returns a trunk-variant match via phonesMatch", async () => {
    const db = stubDb([{ id: "c1", phone: "37063949836" }]);
    const hit = await findExistingContact(db, "acct", "+370 063 949 836", "unitA");
    expect(hit?.id).toBe("c1");
  });

  it("returns null when no candidate matches", async () => {
    const db = stubDb([{ id: "c1", phone: "15559999999" }]);
    const hit = await findExistingContact(db, "acct", "+1 555-123-4567", "unitA");
    expect(hit).toBeNull();
  });

  it("returns null for an empty phone without querying", async () => {
    const db = stubDb([{ id: "c1", phone: "15551234567" }]);
    expect(await findExistingContact(db, "acct", "   ", "unitA")).toBeNull();
  });

  // A richer stub that actually applies `.eq()` filters (col === val)
  // against the candidate rows, so we can prove unit scoping happens in
  // the query, not just incidentally in the JS filter.
  function filteringStub(
    rows: Array<{ id: string; phone: string; unit_id: string; account_id?: string }>,
  ): SupabaseClient {
    const builder: {
      _rows: typeof rows;
      select: () => typeof builder;
      eq: (col: string, val: string) => typeof builder;
      like: () => Promise<{ data: typeof rows; error: null }>;
    } = {
      _rows: rows,
      select: () => builder,
      eq: (col, val) => {
        builder._rows = builder._rows.filter(
          (r) => (r as unknown as Record<string, string>)[col] === val,
        );
        return builder;
      },
      like: () => Promise.resolve({ data: builder._rows, error: null }),
    };
    return { from: () => builder } as unknown as SupabaseClient;
  }

  it("does not match a contact with the same phone in another unit", async () => {
    const db = filteringStub([
      { id: "c1", phone: "5511999", unit_id: "unitB", account_id: "acc1" },
    ]);
    const found = await findExistingContact(db, "acc1", "5511999", "unitA");
    expect(found).toBeNull();
  });

  it("matches a contact with the same phone in the same unit", async () => {
    const db = filteringStub([
      { id: "c1", phone: "5511999", unit_id: "unitA", account_id: "acc1" },
    ]);
    const found = await findExistingContact(db, "acc1", "5511999", "unitA");
    expect(found?.id).toBe("c1");
  });
});
