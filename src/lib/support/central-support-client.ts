/**
 * RedeZap (instância) → central: API de suporte. Server-only.
 * Autentica pela licença (x-license-secret). O segredo NUNCA vai ao navegador.
 */
const TIMEOUT_MS = 20_000;

function centralBase(): string {
  const url = process.env.CONTROL_PLANE_URL?.trim();
  if (!url) throw new Error("CONTROL_PLANE_URL não configurada na instância.");
  return url.replace(/\/+$/, "");
}
function secret(): string {
  const s = process.env.LICENSE_CONTROL_SECRET;
  if (!s) throw new Error("LICENSE_CONTROL_SECRET não configurada na instância.");
  return s;
}
function withTimeout(): { signal: AbortSignal; done: () => void } {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), TIMEOUT_MS);
  return { signal: c.signal, done: () => clearTimeout(t) };
}

export interface SupportTicketListItem {
  id: string; protocolo: string | null; title: string; status: string;
  priorityName: string | null; slaDueAt: string | null; createdAt: string; messageCount: number;
}
export interface SupportTicketDetail {
  id: string; protocolo: string | null; title: string; body: string | null; status: string;
  priorityName: string | null; slaDueAt: string | null; createdAt: string; openedByExternalName: string | null;
  attachments: { id: string; fileName: string }[];
  messages: { id: string; body: string; authorLabel: string | null; fromTeam: boolean; createdAt: string; attachments: { id: string; fileName: string }[] }[];
}

async function jsonOrThrow(res: Response, ctx: string): Promise<Record<string, unknown>> {
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : `Central: ${ctx} (HTTP ${res.status}).`);
  return body;
}

export async function supportListTickets(): Promise<SupportTicketListItem[]> {
  const { signal, done } = withTimeout();
  try {
    const res = await fetch(`${centralBase()}/api/support/relay/tickets`, {
      method: "GET", cache: "no-store", signal, headers: { "x-license-secret": secret() },
    });
    const body = await jsonOrThrow(res, "listar chamados");
    return (body.tickets as SupportTicketListItem[]) ?? [];
  } finally { done(); }
}

export async function supportGetTicket(id: string): Promise<SupportTicketDetail | null> {
  const { signal, done } = withTimeout();
  try {
    const res = await fetch(`${centralBase()}/api/support/relay/tickets/${encodeURIComponent(id)}`, {
      method: "GET", cache: "no-store", signal, headers: { "x-license-secret": secret() },
    });
    if (res.status === 404) return null;
    const body = await jsonOrThrow(res, "abrir chamado");
    return (body.ticket as SupportTicketDetail) ?? null;
  } finally { done(); }
}

/** Cria chamado. `form` contém title/body?/typeId?/files[]?; authorName é injetado aqui. */
export async function supportCreateTicket(form: FormData, authorName: string): Promise<{ id: string; protocolo: string | null }> {
  form.set("authorName", authorName);
  const { signal, done } = withTimeout();
  try {
    const res = await fetch(`${centralBase()}/api/support/relay/tickets`, {
      method: "POST", cache: "no-store", signal, headers: { "x-license-secret": secret() }, body: form,
    });
    const body = await jsonOrThrow(res, "abrir chamado");
    return { id: String(body.id), protocolo: (body.protocolo as string) ?? null };
  } finally { done(); }
}

export async function supportReply(ticketId: string, form: FormData, authorName: string): Promise<void> {
  form.set("authorName", authorName);
  const { signal, done } = withTimeout();
  try {
    const res = await fetch(`${centralBase()}/api/support/relay/tickets/${encodeURIComponent(ticketId)}/reply`, {
      method: "POST", cache: "no-store", signal, headers: { "x-license-secret": secret() }, body: form,
    });
    await jsonOrThrow(res, "responder chamado");
  } finally { done(); }
}

/** Baixa um anexo da central. Devolve o Response cru para a rota-proxy repassar. */
export async function supportDownloadAttachment(id: string): Promise<Response> {
  return fetch(`${centralBase()}/api/support/relay/attachments/${encodeURIComponent(id)}`, {
    method: "GET", cache: "no-store", headers: { "x-license-secret": secret() },
  });
}

export interface SupportConfigDto {
  slaClientText: string | null;
  timezone: string;
  businessHours: { weekday: number; open: string; close: string; closed: boolean }[];
}

/** Config pública do suporte (horário + texto de SLA) para exibir ao cliente.
 *  Best-effort: qualquer falha → null (o bloco informativo é decorativo e não
 *  pode derrubar a página de suporte). */
export async function supportGetConfig(): Promise<SupportConfigDto | null> {
  const { signal, done } = withTimeout();
  try {
    const res = await fetch(`${centralBase()}/api/support/relay/config`, {
      method: "GET", cache: "no-store", signal, headers: { "x-license-secret": secret() },
    });
    if (!res.ok) return null;
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return {
      slaClientText: (body.slaClientText as string | null) ?? null,
      timezone: (body.timezone as string) ?? "America/Sao_Paulo",
      businessHours: Array.isArray(body.businessHours)
        ? (body.businessHours as SupportConfigDto["businessHours"])
        : [],
    };
  } catch {
    return null;
  } finally {
    done();
  }
}
