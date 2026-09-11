/**
 * Cliente RedeZap (instância) → Gestão USAI (central) para o canal uazapi.
 *
 * O RedeZap NUNCA fala direto com a uazapi (os tokens vivem só na central).
 * Roda no servidor da instância (tem `CONTROL_PLANE_URL` + `LICENSE_CONTROL_SECRET`)
 * e é chamado pelas rotas-proxy `/api/whatsapp/uazapi/*`, que por sua vez são
 * chamadas pelo painel (com sessão de admin). Autentica na central pelo segredo
 * de licença — que identifica esta instância.
 */

const TIMEOUT_MS = 25_000; // conectar/QR pode demorar

function centralBase(): string | null {
  const url = process.env.CONTROL_PLANE_URL?.trim();
  return url ? url.replace(/\/+$/, "") : null;
}

async function centralFetch(
  path: string,
  init: RequestInit,
): Promise<Response> {
  const base = centralBase();
  const secret = process.env.LICENSE_CONTROL_SECRET;
  if (!base) throw new Error("CONTROL_PLANE_URL não configurada na instância.");
  if (!secret) throw new Error("LICENSE_CONTROL_SECRET não configurada na instância.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(`${base}${path}`, {
      ...init,
      cache: "no-store",
      signal: controller.signal,
      headers: { ...(init.headers ?? {}), "x-license-secret": secret },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function readJson(res: Response, ctx: string): Promise<Record<string, unknown>> {
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err = typeof body.error === "string" ? body.error : `HTTP ${res.status}`;
    throw new Error(`Central: ${ctx} falhou (${err}).`);
  }
  return body;
}

/** Conecta/reconecta o canal uazapi da unidade — devolve QR + status. */
export async function connectUazapi(
  unitLabel: string,
): Promise<{ qrcode?: string; status?: string }> {
  const res = await centralFetch("/api/instances/uazapi/connect", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ unitLabel }),
  });
  const body = await readJson(res, "conectar");
  return {
    qrcode: typeof body.qrcode === "string" ? body.qrcode : undefined,
    status: typeof body.status === "string" ? body.status : undefined,
  };
}

/** Status do canal uazapi da unidade. */
export async function statusUazapi(
  unitLabel: string,
): Promise<{ status: string; connected: boolean }> {
  const res = await centralFetch(
    `/api/instances/uazapi/status?unitLabel=${encodeURIComponent(unitLabel)}`,
    { method: "GET" },
  );
  const body = await readJson(res, "status");
  return {
    status: typeof body.status === "string" ? body.status : "unknown",
    connected: body.connected === true,
  };
}

/** Desconecta (logout) ou reinicia (reconexão) o canal. */
export async function controlUazapi(
  unitLabel: string,
  action: "disconnect" | "reset",
): Promise<{ ok: boolean }> {
  const res = await centralFetch("/api/instances/uazapi/control", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ unitLabel, action }),
  });
  const body = await readJson(res, "controle");
  return { ok: body.ok === true };
}
