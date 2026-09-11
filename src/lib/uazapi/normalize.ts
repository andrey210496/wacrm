/**
 * Normaliza o payload de webhook da uazapi (canal não-oficial) para uma forma
 * neutra que o processamento de inbound consome.
 *
 * A uazapi manda um objeto de mensagem (schema `Message`): `sender` (JID/número),
 * `sender_pn` (telefone E.164), `senderName`, `fromMe`, `messageType`, `text`,
 * `content`, `fileURL`, `messageid`, `messageTimestamp`. O envelope exato do
 * webhook varia (pode vir a Message direta, ou `{ message: {...} }`, ou
 * `{ event, data }`) — o parser é TOLERANTE e extrai de onde estiver.
 *
 * Puro/testável. O envelope real será confirmado ao vivo quando conectarmos uma
 * instância (o webhook aponta pra cá).
 */

export type NormalizedUazapiMessage = {
  /** Telefone (só dígitos) do remetente, se der pra extrair. */
  fromPhone: string | null;
  /** Nome do perfil, se veio. */
  fromName: string;
  /** true = mensagem que NÓS enviamos (echo) — inbound processa só as de entrada. */
  fromMe: boolean;
  /** tipo normalizado. */
  type: "text" | "image" | "video" | "audio" | "document" | "unknown";
  /** texto/legenda. */
  text: string;
  /** URL da mídia (quando houver). */
  mediaUrl: string | null;
  /** id da mensagem na uazapi (dedup). */
  messageId: string | null;
  /** epoch em segundos, se veio. */
  timestamp: number | null;
};

function digits(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const d = s.replace(/\D/g, "");
  return d.length >= 8 ? d : null;
}

function mapType(t: unknown): NormalizedUazapiMessage["type"] {
  const s = String(t ?? "").toLowerCase();
  if (s.includes("image")) return "image";
  if (s.includes("video")) return "video";
  if (s.includes("audio") || s.includes("ptt")) return "audio";
  if (s.includes("document")) return "document";
  if (s.includes("text") || s.includes("conversation") || s.includes("extended")) return "text";
  return "unknown";
}

/** Extrai o objeto de mensagem de um envelope tolerante. */
function pickMessage(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  // Formas comuns: a Message direta; ou { message }, { data }, { data: { message } }.
  const cand =
    (p.message as Record<string, unknown>) ??
    (p.data && typeof p.data === "object"
      ? ((p.data as Record<string, unknown>).message as Record<string, unknown>) ??
        (p.data as Record<string, unknown>)
      : undefined) ??
    p;
  return cand && typeof cand === "object" ? cand : null;
}

export function normalizeUazapiInbound(
  payload: unknown,
): NormalizedUazapiMessage | null {
  const m = pickMessage(payload);
  if (!m) return null;

  const fromMe = m.fromMe === true;

  // Telefone: prioriza sender_pn (E.164); senão o sender (pode ser JID
  // "5511...@s.whatsapp.net").
  const fromPhone = digits(m.sender_pn) ?? digits(m.sender);

  const type = mapType(m.messageType);
  const text =
    typeof m.text === "string"
      ? m.text
      : typeof m.content === "string"
        ? m.content
        : "";
  const mediaUrl = typeof m.fileURL === "string" && m.fileURL ? m.fileURL : null;

  const messageId =
    (typeof m.messageid === "string" && m.messageid) ||
    (typeof m.id === "string" && m.id) ||
    null;

  const tsRaw = m.messageTimestamp;
  const timestamp =
    typeof tsRaw === "number"
      ? tsRaw
      : typeof tsRaw === "string" && /^\d+$/.test(tsRaw)
        ? parseInt(tsRaw, 10)
        : null;

  const fromName =
    (typeof m.senderName === "string" && m.senderName) || "";

  return { fromPhone, fromName, fromMe, type, text, mediaUrl, messageId, timestamp };
}
