import { describe, it, expect } from "vitest";
import { resolveAssignee, assigneeInitials } from "./assignee";

const profiles = [
  { user_id: "u1", full_name: "Karina Martins", avatar_url: "http://x/k.png" },
  { user_id: "u2", full_name: "João", avatar_url: null },
  { user_id: "u3", full_name: "  ", avatar_url: undefined },
];

describe("resolveAssignee", () => {
  it("não atribuído quando assignedAgentId é nulo/vazio", () => {
    expect(resolveAssignee(profiles, null)).toEqual({
      assigned: false,
      name: null,
      initials: null,
      avatarUrl: null,
    });
    expect(resolveAssignee(profiles, undefined).assigned).toBe(false);
    expect(resolveAssignee(profiles, "").assigned).toBe(false);
  });

  it("resolve nome, iniciais e avatar do responsável encontrado", () => {
    expect(resolveAssignee(profiles, "u1")).toEqual({
      assigned: true,
      name: "Karina Martins",
      initials: "KM",
      avatarUrl: "http://x/k.png",
    });
  });

  it("nome único → 1 inicial; avatar nulo preservado", () => {
    expect(resolveAssignee(profiles, "u2")).toEqual({
      assigned: true,
      name: "João",
      initials: "J",
      avatarUrl: null,
    });
  });

  it("atribuído mas fora do conjunto visível → assigned:true sem nome", () => {
    expect(resolveAssignee(profiles, "desconhecido")).toEqual({
      assigned: true,
      name: null,
      initials: null,
      avatarUrl: null,
    });
  });

  it("nome só com espaços conta como sem nome (assigned, name null)", () => {
    expect(resolveAssignee(profiles, "u3")).toEqual({
      assigned: true,
      name: null,
      initials: null,
      avatarUrl: null,
    });
  });
});

describe("assigneeInitials", () => {
  it("primeiro + último de nomes com 2+ partes", () => {
    expect(assigneeInitials("Karina Martins")).toBe("KM");
    expect(assigneeInitials("Ana Paula de Souza")).toBe("AS");
  });
  it("uma parte → uma inicial", () => {
    expect(assigneeInitials("João")).toBe("J");
  });
  it("vazio/espaços → ?", () => {
    expect(assigneeInitials("   ")).toBe("?");
    expect(assigneeInitials("")).toBe("?");
  });
  it("sempre maiúsculas", () => {
    expect(assigneeInitials("maria clara")).toBe("MC");
  });
});
