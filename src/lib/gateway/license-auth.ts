import { timingSafeEqual } from "crypto";

/**
 * Autentica uma chamada server-to-server vinda da central (control plane) pelo
 * segredo de licença compartilhado (`LICENSE_CONTROL_SECRET`) — o mesmo que
 * `/api/license/apply` usa. Centralizado aqui para os endpoints do gateway
 * (`/api/gateway/*`), que a central chama para listar unidades e provisionar o
 * `whatsapp_config` no fluxo de Embedded Signup.
 *
 * Timing-safe e **fail-closed**: sem segredo no ambiente, header ausente, ou
 * valor divergente → `false`. Comparação em tempo constante para não vazar o
 * segredo por timing.
 */
export function isAuthorizedControlPlane(providedSecret: string | null): boolean {
  const expected = process.env.LICENSE_CONTROL_SECRET;
  if (!expected || !providedSecret) return false;

  const a = Buffer.from(providedSecret);
  const b = Buffer.from(expected);
  // timingSafeEqual exige buffers do mesmo tamanho; tamanhos diferentes já
  // significam segredo errado — retorna sem vazar timing do conteúdo.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
