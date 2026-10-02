import { describe, it, expect, beforeEach } from "vitest";
import { allow, _resetRateLimit } from "./rate-limit";

describe("rate-limit allow", () => {
  beforeEach(() => _resetRateLimit());

  it("permite até o máximo e bloqueia depois", () => {
    const t = 1_000_000;
    expect(allow("k", 3, 60_000, t)).toBe(true);
    expect(allow("k", 3, 60_000, t + 1)).toBe(true);
    expect(allow("k", 3, 60_000, t + 2)).toBe(true);
    expect(allow("k", 3, 60_000, t + 3)).toBe(false); // 4º dentro da janela
  });

  it("libera após a janela expirar", () => {
    const t = 2_000_000;
    expect(allow("k2", 1, 10_000, t)).toBe(true);
    expect(allow("k2", 1, 10_000, t + 5_000)).toBe(false);
    expect(allow("k2", 1, 10_000, t + 11_000)).toBe(true); // janela passou
  });

  it("chaves independentes", () => {
    const t = 3_000_000;
    expect(allow("a", 1, 10_000, t)).toBe(true);
    expect(allow("b", 1, 10_000, t)).toBe(true);
    expect(allow("a", 1, 10_000, t + 1)).toBe(false);
  });
});
