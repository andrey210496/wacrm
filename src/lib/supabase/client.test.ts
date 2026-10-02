import { describe, it, expect } from "vitest";
import { resolvePublicSupabaseEnv } from "./client";

describe("resolvePublicSupabaseEnv", () => {
  it("prefere os valores injetados em runtime sobre os de build", () => {
    const r = resolvePublicSupabaseEnv(
      {
        SUPABASE_URL: "https://runtime.supabase.co",
        SUPABASE_ANON_KEY: "runtime-anon",
      },
      { url: "https://build.supabase.co", anonKey: "build-anon" },
    );
    expect(r).toEqual({
      url: "https://runtime.supabase.co",
      anonKey: "runtime-anon",
    });
  });

  it("cai no fallback de build quando não há nada injetado", () => {
    const r = resolvePublicSupabaseEnv(undefined, {
      url: "https://build.supabase.co",
      anonKey: "build-anon",
    });
    expect(r).toEqual({
      url: "https://build.supabase.co",
      anonKey: "build-anon",
    });
  });

  it("faz fallback campo a campo quando o injetado é parcial/vazio", () => {
    const r = resolvePublicSupabaseEnv(
      { SUPABASE_URL: "", SUPABASE_ANON_KEY: "runtime-anon" },
      { url: "https://build.supabase.co", anonKey: "build-anon" },
    );
    expect(r).toEqual({
      url: "https://build.supabase.co",
      anonKey: "runtime-anon",
    });
  });

  it("lança erro quando as duas fontes estão vazias (fail-closed)", () => {
    expect(() => resolvePublicSupabaseEnv(undefined, {})).toThrow(
      /Config pública do Supabase ausente/,
    );
    expect(() =>
      resolvePublicSupabaseEnv(
        { SUPABASE_URL: "", SUPABASE_ANON_KEY: "" },
        { url: "", anonKey: "" },
      ),
    ).toThrow();
  });
});
