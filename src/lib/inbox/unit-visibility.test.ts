import { describe, it, expect } from "vitest";
import { conversationVisibleInScope } from "./unit-visibility";

describe("conversationVisibleInScope", () => {
  it("sem unidade selecionada (todas) → sempre visível", () => {
    expect(conversationVisibleInScope("u1", null)).toBe(true);
    expect(conversationVisibleInScope(null, null)).toBe(true);
    expect(conversationVisibleInScope(undefined, null)).toBe(true);
  });

  it("unidade selecionada e igual → visível", () => {
    expect(conversationVisibleInScope("u1", "u1")).toBe(true);
  });

  it("unidade selecionada e diferente → NÃO visível", () => {
    expect(conversationVisibleInScope("u2", "u1")).toBe(false);
  });

  it("unidade selecionada mas conversa sem unidade → NÃO visível (fail-closed)", () => {
    expect(conversationVisibleInScope(null, "u1")).toBe(false);
    expect(conversationVisibleInScope(undefined, "u1")).toBe(false);
  });
});
