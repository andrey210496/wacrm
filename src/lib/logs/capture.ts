/**
 * Observabilidade (instância) — reporta erros/bugs para a central (Gestão USAI),
 * que os agrega na tela de Logs. Usa CONTROL_PLANE_URL + x-license-secret (mesmo
 * mecanismo do report de status). A central carimba o `system`/`instanceId` pelo
 * segredo — aqui só mandamos feature/mensagem/nível/tipo/context.
 *
 * REGRAS: nunca lança (um erro no logger não pode derrubar o fluxo), fire-and-
 * forget (o `next start` da instância é um processo longo, então a promise
 * completa mesmo sem await), timeout curto, e NUNCA envia segredos no context.
 */

const TIMEOUT_MS = 5_000;

export interface CaptureInput {
  feature: string;
  message: string;
  level?: "error" | "warn";
  errorType?: string | null;
  /** Dados extras (ids, trecho de payload). SEM SEGREDOS (token/pin/secret). */
  context?: Record<string, unknown> | null;
}

/** Reporta um erro para a central. Best-effort; engole qualquer falha. */
export async function captureError(input: CaptureInput): Promise<void> {
  const base = process.env.CONTROL_PLANE_URL?.trim().replace(/\/+$/, "");
  const secret = process.env.LICENSE_CONTROL_SECRET;
  if (!base || !secret) return; // sem central configurada → não reporta (silencioso)

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    await fetch(`${base}/api/logs/ingest`, {
      method: "POST",
      cache: "no-store",
      signal: controller.signal,
      headers: { "content-type": "application/json", "x-license-secret": secret },
      body: JSON.stringify({
        feature: input.feature,
        message: input.message,
        level: input.level ?? "error",
        errorType: input.errorType ?? null,
        context: input.context ?? null,
      }),
    });
  } catch {
    // Logger nunca derruba o chamador nem faz barulho — o console.error local
    // do próprio catch já registra a causa.
  } finally {
    clearTimeout(timer);
  }
}
