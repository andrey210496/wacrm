import { describe, it, expect } from "vitest";
import { validateProfileFields, validateUsername } from "./profile-validate";

describe("validateProfileFields", () => {
  it("aceita campos válidos", () => {
    expect(validateProfileFields({ about: "Estúdio de pilates", email: "a@b.com", vertical: "HEALTH", websites: ["https://x.com"] })).toEqual({ ok: true });
  });
  it("about longo demais", () => {
    expect(validateProfileFields({ about: "x".repeat(140) }).ok).toBe(false);
  });
  it("email inválido", () => {
    expect(validateProfileFields({ email: "sem-arroba" }).ok).toBe(false);
  });
  it("site sem http", () => {
    expect(validateProfileFields({ websites: ["www.x.com"] }).ok).toBe(false);
  });
  it("mais de 2 sites", () => {
    expect(validateProfileFields({ websites: ["https://a.com", "https://b.com", "https://c.com"] }).ok).toBe(false);
  });
  it("categoria fora do enum", () => {
    expect(validateProfileFields({ vertical: "PILATES" }).ok).toBe(false);
  });
  it("email vazio é ok (limpa o campo)", () => {
    expect(validateProfileFields({ email: "" })).toEqual({ ok: true });
  });
});

describe("validateUsername", () => {
  it("válido", () => {
    expect(validateUsername("pure.pilates_01")).toEqual({ ok: true });
  });
  it("rejeita maiúscula/acento/espaço", () => {
    expect(validateUsername("PurePilates").ok).toBe(false);
    expect(validateUsername("puré").ok).toBe(false);
    expect(validateUsername("pure pilates").ok).toBe(false);
  });
  it("rejeita curto/longo", () => {
    expect(validateUsername("ab").ok).toBe(false);
    expect(validateUsername("a".repeat(31)).ok).toBe(false);
  });
});
