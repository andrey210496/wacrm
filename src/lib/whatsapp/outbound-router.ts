/**
 * Roteador de saída (Frente 2 — "Conexão redezap", híbrido por custo).
 *
 * Decide, de forma PURA e testável, se uma mensagem de saída vai pelo canal
 * OFICIAL (Meta Cloud API) ou pela UAZAPI (não-oficial, R$0 Meta). A regra:
 * uma % das mensagens COBRÁVEIS e ELEGÍVEIS vai pra uazapi, intercalada a cada
 * 100. Entrada nunca passa aqui (inbound é sempre oficial). O envio real e o
 * fail-safe (uazapi caiu → oficial) ficam no executor (send-message).
 *
 * "Cobrável" é heurística de ENVIO (a Meta só confirma depois, no webhook de
 * status). É date-aware, ancorada na doc oficial: a partir de 01/10/2026 as
 * mensagens não-template (service) passam a ser cobradas por mensagem.
 */

export type BillableMode = "auto" | "always" | "template_only";
export type Channel = "official" | "uazapi";
export type ChannelOverride = "auto" | "official" | "uazapi";

/** 2026-10-01 UTC: doc oficial da Meta — service messages passam a ser cobráveis. */
const SERVICE_BILLABLE_FROM = Date.UTC(2026, 9, 1); // mês 0-based: 9 = outubro

/**
 * Janela FEP ("Free Entry Point"): doc oficial da Meta — quando a conversa vem
 * de um anúncio Click-to-WhatsApp (ou CTA de Página) e a empresa responde, abre
 * uma janela de PONTO DE ENTRADA GRATUITO que fica aberta por ATÉ 7 DIAS. Dentro
 * dela a Meta NÃO cobra marketing/utilidade/autenticação/serviço. Como só temos
 * o instante do referral de entrada (`referral_at`), aproximamos a janela por
 * 7 dias a partir dele — heurística de ROTEAMENTO apenas (a cobrança real segue
 * o flag `pricing.billable` do webhook). Erro conservador: no máximo deixamos de
 * economizar com a uazapi; nunca gera cobrança indevida.
 */
const FEP_WINDOW_MS = 7 * 24 * 3600 * 1000;

/** Tipos que a uazapi consegue enviar. Template vira texto renderizado; interativo NÃO. */
const UAZAPI_ELIGIBLE = new Set([
  "text",
  "image",
  "video",
  "document",
  "audio",
  "template",
]);

export function isUazapiEligibleType(messageType: string): boolean {
  return UAZAPI_ELIGIBLE.has(messageType);
}

/**
 * Prevê se a mensagem seria COBRÁVEL no oficial, no momento do envio.
 * `template` é sempre tratado como cobrável (heurística segura — o único
 * falso-positivo é utility dentro da janela antes de 01/10, tolerável para
 * roteamento). Não-template é grátis até 30/09/2026 e cobrável a partir de
 * 01/10/2026 (doc oficial).
 */
export function isBillableAtSend(p: {
  messageType: string;
  windowOpen: boolean;
  now: Date;
  mode: BillableMode;
}): boolean {
  if (p.mode === "always") return true;
  if (p.mode === "template_only") return p.messageType === "template";
  // auto (fiel à doc oficial da Meta):
  if (p.messageType === "template") return true;
  return p.now.getTime() >= SERVICE_BILLABLE_FROM;
}

/**
 * A conversa está numa janela FEP aberta? (lead de anúncio dentro de 7 dias do
 * referral de entrada). Guarda contra relógio torto: diferença negativa = fechada.
 */
export function isFepOpen(p: { referralAt: Date | null; now: Date }): boolean {
  if (!p.referralAt) return false;
  const delta = p.now.getTime() - p.referralAt.getTime();
  return delta >= 0 && delta < FEP_WINDOW_MS;
}

/**
 * Distribuição INTERCALADA (Bresenham): exatamente `pct` acertos a cada 100,
 * espalhados (não um bloco). Determinística no contador.
 */
export function shouldUseUazapi(counter: number, pct: number): boolean {
  if (pct <= 0) return false;
  if (pct >= 100) return true;
  return (
    Math.floor(((counter + 1) * pct) / 100) - Math.floor((counter * pct) / 100) ===
    1
  );
}

/**
 * Decisão final de canal (pura). `consumeCounter` indica que a decisão dependeu
 * do contador de interleave — só nesse caso o executor deve incrementá-lo, para
 * a distribuição ficar sobre a população cobrável+elegível.
 */
export function chooseChannel(p: {
  hybridEnabled: boolean;
  uazapiPct: number;
  billableMode: BillableMode;
  messageType: string;
  windowOpen: boolean;
  now: Date;
  hasPhone: boolean;
  counter: number;
  override: ChannelOverride;
  /** Lead de anúncio dentro da janela FEP (até 7 dias) → grátis no oficial. */
  fepOpen: boolean;
}): { channel: Channel; consumeCounter: boolean } {
  // Override manual/automação vence tudo.
  if (p.override === "official") return { channel: "official", consumeCounter: false };
  if (p.override === "uazapi") {
    const ok = isUazapiEligibleType(p.messageType) && p.hasPhone;
    return { channel: ok ? "uazapi" : "official", consumeCounter: false };
  }

  if (!p.hybridEnabled) return { channel: "official", consumeCounter: false };
  if (!isUazapiEligibleType(p.messageType)) return { channel: "official", consumeCounter: false };
  // uazapi (WhatsApp Web) precisa de número — contato só-BSUID vai no oficial.
  if (!p.hasPhone) return { channel: "official", consumeCounter: false };
  // Janela FEP aberta → TODA categoria é grátis no oficial; sem economia e com
  // risco no canal não-oficial, fica oficial (não consome o contador de interleave).
  if (p.fepOpen) return { channel: "official", consumeCounter: false };
  if (
    !isBillableAtSend({
      messageType: p.messageType,
      windowOpen: p.windowOpen,
      now: p.now,
      mode: p.billableMode,
    })
  ) {
    // Grátis no oficial → não há economia e o canal não-oficial tem risco: fica oficial.
    return { channel: "official", consumeCounter: false };
  }

  const channel: Channel = shouldUseUazapi(p.counter, p.uazapiPct)
    ? "uazapi"
    : "official";
  return { channel, consumeCounter: true };
}
