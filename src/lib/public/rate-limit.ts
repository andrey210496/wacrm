/**
 * Rate-limit simples em memória (janela deslizante). Por-container (reseta no
 * deploy) — suficiente como 1ª barreira anti-abuso do autoagendamento público,
 * junto do honeypot, validação e da trava de overbooking do banco.
 *
 * Puro/testável: o estado vive num Map do módulo; `allow` recebe `now` (ms).
 */

const buckets = new Map<string, number[]>();

/** Permite a ação? Registra o hit se permitido. Janela deslizante. */
export function allow(key: string, max: number, windowMs: number, now: number = Date.now()): boolean {
  const cutoff = now - windowMs;
  const hits = (buckets.get(key) ?? []).filter((t) => t > cutoff);
  if (hits.length >= max) {
    buckets.set(key, hits); // mantém a janela podada
    return false;
  }
  hits.push(now);
  buckets.set(key, hits);
  return true;
}

/** Só para testes: limpa o estado. */
export function _resetRateLimit(): void {
  buckets.clear();
}
