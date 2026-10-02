import { describe, it, expect } from "vitest";
import { parseApiResponse, buildApiErrorMessage } from "./api-response";

/** Cria uma Response falsa com corpo texto e status. */
function res(body: string, status = 200, contentType = "application/json"): Response {
  return new Response(body, { status, headers: { "content-type": contentType } });
}

describe("buildApiErrorMessage", () => {
  it("prioriza o erro de aplicação (JSON error)", () => {
    expect(buildApiErrorMessage({ status: 502, jsonError: "limite atingido", nonJson: false })).toBe(
      "limite atingido",
    );
  });

  it("502/503/504 sem JSON → mensagem acionável de 'tente de novo'", () => {
    for (const s of [502, 503, 504]) {
      const m = buildApiErrorMessage({ status: s, jsonError: null, nonJson: true });
      expect(m).toContain(`HTTP ${s}`);
      expect(m.toLowerCase()).toContain("tente novamente");
    }
  });

  it("401/403 → mensagem de permissão", () => {
    expect(buildApiErrorMessage({ status: 403, jsonError: null, nonJson: false })).toContain("permissão");
  });

  it("status 0 → falha de rede", () => {
    expect(buildApiErrorMessage({ status: 0, jsonError: null, nonJson: true }).toLowerCase()).toContain("rede");
  });
});

describe("parseApiResponse", () => {
  it("200 + JSON → ok com data", async () => {
    const p = await parseApiResponse(res(JSON.stringify({ ok: true, status: "connecting" })));
    expect(p.ok).toBe(true);
    expect(p.data).toMatchObject({ status: "connecting" });
    expect(p.error).toBe("");
  });

  it("502 + HTML (proxy) → não-ok, nonJson, mensagem acionável (não estoura)", async () => {
    const html = "<!DOCTYPE html><html><head><title>502</title></head><body>Bad Gateway</body></html>";
    const p = await parseApiResponse(res(html, 502, "text/html"));
    expect(p.ok).toBe(false);
    expect(p.nonJson).toBe(true);
    expect(p.status).toBe(502);
    expect(p.error.toLowerCase()).toContain("tente novamente");
  });

  it("400 + JSON {error} → usa a mensagem da aplicação", async () => {
    const p = await parseApiResponse(res(JSON.stringify({ error: "unitId é obrigatório" }), 400));
    expect(p.ok).toBe(false);
    expect(p.error).toBe("unitId é obrigatório");
  });

  it("200 + corpo vazio → tratado como não-ok (nonJson), sem estourar", async () => {
    const p = await parseApiResponse(res("", 200));
    expect(p.ok).toBe(false);
    expect(p.nonJson).toBe(true);
  });

  it("200 + JSON inválido → nonJson, não-ok", async () => {
    const p = await parseApiResponse(res("{quebrado", 200));
    expect(p.ok).toBe(false);
    expect(p.nonJson).toBe(true);
  });
});
