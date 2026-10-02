/**
 * Leitura robusta de respostas de rotas internas (fetch → JSON).
 *
 * PROBLEMA que isto resolve: quando um reverse proxy (EasyPanel/Traefik) devolve
 * uma página de erro (502/504 em `text/html`) porque o app demorou ou reiniciou,
 * um `await res.json()` cru ESTOURA — e o cliente acaba mostrando um genérico
 * "erro de rede", escondendo o status real. Aqui a gente lê o corpo UMA vez como
 * texto, tenta parsear JSON, e monta uma mensagem legível que preserva o status
 * HTTP e distingue "servidor instável/demorou" (5xx/HTML) de erro de aplicação.
 *
 * Puro em relação a I/O de rede: recebe uma `Response` já resolvida. Nunca lança.
 */

export type ParsedApiResponse<T = Record<string, unknown>> = {
  /** true só quando o status é 2xx E o corpo é JSON. */
  ok: boolean;
  /** status HTTP (0 se indisponível). */
  status: number;
  /** corpo JSON quando parseável; senão null. */
  data: T | null;
  /** mensagem pronta pra exibir quando `ok` é false; string vazia quando ok. */
  error: string;
  /** true quando o corpo NÃO era JSON (tipicamente HTML de proxy). */
  nonJson: boolean;
};

function looksLikeHtml(text: string): boolean {
  const t = text.trimStart().slice(0, 200).toLowerCase();
  return t.startsWith("<!doctype") || t.startsWith("<html") || t.includes("<head") || t.includes("<body");
}

/**
 * Constrói a mensagem de erro a partir das partes já extraídas. Separada pra ser
 * trivialmente testável sem uma `Response`.
 */
export function buildApiErrorMessage(params: {
  status: number;
  jsonError?: string | null;
  nonJson: boolean;
}): string {
  const { status, jsonError, nonJson } = params;
  // 1) Erro de aplicação (JSON `{error}`): é a mensagem mais precisa.
  if (jsonError && jsonError.trim()) return jsonError.trim();

  // 2) Sem JSON e status de gateway → servidor demorou/instável. Acionável:
  //    a maioria das operações lentas é idempotente e a 2ª tentativa completa.
  if (status === 502 || status === 503 || status === 504) {
    return `O servidor demorou a responder (HTTP ${status}). Tente novamente — a operação costuma completar na 2ª tentativa.`;
  }
  if (status === 401 || status === 403) {
    return "Sem permissão para esta ação (sessão expirada?).";
  }
  if (status === 0) {
    return "Falha de rede — não foi possível alcançar o servidor.";
  }
  if (nonJson) {
    return `Resposta inesperada do servidor (HTTP ${status}).`;
  }
  return `Falha (HTTP ${status}).`;
}

/** Lê uma `Response` de forma tolerante. Nunca lança. */
export async function parseApiResponse<T = Record<string, unknown>>(
  res: Response,
): Promise<ParsedApiResponse<T>> {
  const status = res.status;
  let text = "";
  try {
    text = await res.text();
  } catch {
    text = "";
  }

  let data: T | null = null;
  let nonJson = false;
  if (text) {
    try {
      data = JSON.parse(text) as T;
    } catch {
      nonJson = true;
      data = null;
    }
  } else {
    nonJson = true;
  }

  if (res.ok && data !== null) {
    return { ok: true, status, data, error: "", nonJson: false };
  }

  const jsonError =
    data && typeof (data as Record<string, unknown>).error === "string"
      ? ((data as Record<string, unknown>).error as string)
      : null;

  return {
    ok: false,
    status,
    data,
    nonJson: nonJson || looksLikeHtml(text),
    error: buildApiErrorMessage({ status, jsonError, nonJson: nonJson || looksLikeHtml(text) }),
  };
}
