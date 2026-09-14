/**
 * Parsers PUROS dos webhooks de Coexistence (Fase 2). Recebem o `value` do
 * change e devolvem uma forma normalizada — sem I/O, testáveis. Os handlers no
 * process-webhook fazem a persistência reusando os helpers existentes.
 *
 * Formatos confirmados na doc oficial da Meta (2026-09-14): smb_message_echoes,
 * history, smb_app_state_sync. Nada de campo Meta memorizado — reconferir na doc.
 */

// Tipos de conteúdo aceitos pela tabela messages (CHECK). Fora daí → 'text'.
const ALLOWED_CONTENT_TYPES = new Set([
  "text", "image", "document", "audio", "video", "location", "template", "interactive",
]);

type CoexMsg = {
  from?: string;
  to?: string;
  id?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  image?: { caption?: string };
  video?: { caption?: string };
  document?: { caption?: string; filename?: string };
  history_context?: { status?: string };
  [k: string]: unknown;
};

/** content_type normalizado (mapeia sticker→image; desconhecido→text). */
export function coexContentType(type: string | undefined): string {
  if (!type) return "text";
  if (ALLOWED_CONTENT_TYPES.has(type)) return type;
  if (type === "sticker") return "image";
  return "text";
}

/** Texto/legenda/rótulo pra exibição, por tipo. Null quando não há texto. */
export function extractCoexContent(msg: CoexMsg): string | null {
  switch (msg.type) {
    case "text":
      return msg.text?.body ?? null;
    case "image":
      return msg.image?.caption ?? "[image]";
    case "video":
      return msg.video?.caption ?? "[video]";
    case "document":
      return msg.document?.caption ?? msg.document?.filename ?? "[document]";
    default:
      // Tipo sem texto (áudio, sticker, localização, etc.) → marcador legível.
      return msg.type && msg.type !== "text" ? `[${msg.type}]` : null;
  }
}

/** READ/DELIVERED/SENT... → status interno (messages.status). */
export function mapHistoryStatus(status: string | undefined): string {
  switch ((status ?? "").toUpperCase()) {
    case "READ":
      return "read";
    case "DELIVERED":
      return "delivered";
    case "SENT":
      return "sent";
    default:
      return "delivered";
  }
}

export type NormalizedEcho = {
  metaId: string;
  contactPhone: string;
  timestamp: number | null;
  contentType: string;
  contentText: string | null;
};

/** smb_message_echoes → mensagens ENVIADAS pelo negócio (outbound, via app). */
export function parseMessageEchoes(value: unknown): NormalizedEcho[] {
  const v = value as { message_echoes?: CoexMsg[] } | null;
  const out: NormalizedEcho[] = [];
  for (const m of v?.message_echoes ?? []) {
    if (!m.id || !m.to) continue;
    out.push({
      metaId: m.id,
      contactPhone: m.to,
      timestamp: m.timestamp ? Number(m.timestamp) : null,
      contentType: coexContentType(m.type),
      contentText: extractCoexContent(m),
    });
  }
  return out;
}

export type NormalizedHistoryMsg = {
  metaId: string;
  contactPhone: string;
  direction: "in" | "out";
  timestamp: number | null;
  contentType: string;
  contentText: string | null;
  status: string;
};

/**
 * history → mensagens antigas de todos os threads. Direção pelo `from`:
 * == businessPhone → 'out' (negócio); senão 'in' (cliente). O contato é o
 * `thread.id` (telefone do cliente).
 */
export function parseHistory(value: unknown, businessPhone: string): NormalizedHistoryMsg[] {
  const v = value as
    | { history?: Array<{ threads?: Array<{ id?: string; messages?: CoexMsg[] }> }> }
    | null;
  const out: NormalizedHistoryMsg[] = [];
  const biz = normalizePhone(businessPhone);
  for (const chunk of v?.history ?? []) {
    for (const thread of chunk.threads ?? []) {
      const contactPhone = thread.id;
      if (!contactPhone) continue;
      for (const m of thread.messages ?? []) {
        if (!m.id) continue;
        const direction: "in" | "out" = normalizePhone(m.from) === biz ? "out" : "in";
        out.push({
          metaId: m.id,
          contactPhone,
          direction,
          timestamp: m.timestamp ? Number(m.timestamp) : null,
          contentType: coexContentType(m.type),
          contentText: extractCoexContent(m),
          status: mapHistoryStatus(m.history_context?.status),
        });
      }
    }
  }
  return out;
}

export type NormalizedContact = { phone: string; name: string | null };

/** smb_app_state_sync → contatos a criar (só action 'add'; 'remove' é ignorado). */
export function parseAppStateSync(value: unknown): NormalizedContact[] {
  const v = value as
    | { state_sync?: Array<{ type?: string; action?: string; contact?: { full_name?: string; first_name?: string; phone_number?: string } }> }
    | null;
  const out: NormalizedContact[] = [];
  for (const s of v?.state_sync ?? []) {
    if (s.type !== "contact" || s.action !== "add") continue;
    const phone = s.contact?.phone_number;
    if (!phone) continue;
    out.push({ phone, name: s.contact?.full_name || s.contact?.first_name || null });
  }
  return out;
}

/** Só dígitos, pra comparar telefones que podem vir com/sem '+' ou máscara. */
function normalizePhone(p: string | undefined): string {
  return (p ?? "").replace(/\D/g, "");
}
