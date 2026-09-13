/**
 * Lógica pura dos lembretes de agendamento (Fase B). Sem I/O — só cálculo.
 */

/** Remove acentos e baixa a caixa. */
function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Renderiza o texto do lembrete trocando placeholders `{chave}` pelos valores.
 * Placeholders sem valor viram string vazia. Case-insensitive nas chaves.
 */
export function renderReminder(
  text: string,
  vars: Record<string, string | null | undefined>,
): string {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(vars)) lower[k.toLowerCase()] = v ?? "";
  return text.replace(/\{(\w+)\}/g, (_, key: string) => lower[key.toLowerCase()] ?? "");
}

/**
 * Quais offsets (minutos antes) estão VENCIDOS e ainda não enviados, para um
 * agendamento que começa em `apptStart`. Um offset O dispara quando `now` cruza
 * (start − O), dentro de uma janela de graça (`graceMin`, default 30) — assim
 * não reenvia um lembrete "antigo" para um agendamento criado tarde, e o cron
 * pode rodar a cada ~15min sem furar. Nunca dispara depois do início.
 */
export function dueOffsets(params: {
  now: Date;
  apptStart: Date;
  offsets: number[];
  sentOffsets: number[];
  graceMin?: number;
}): number[] {
  const nowMs = params.now.getTime();
  const startMs = params.apptStart.getTime();
  const graceMs = (params.graceMin ?? 30) * 60_000;
  if (nowMs >= startMs) return [];
  const sent = new Set(params.sentOffsets);
  return params.offsets
    .filter((o) => {
      if (sent.has(o)) return false;
      const trigger = startMs - o * 60_000;
      return nowMs >= trigger && nowMs <= trigger + graceMs;
    })
    .sort((a, b) => b - a);
}

/**
 * O texto do inbound é uma intenção de CONFIRMAR? Casa exato (após normalizar
 * acento/caixa/pontuação nas bordas) com uma das palavras-chave — evita falso
 * positivo tipo "não vou confirmar".
 */
export function isConfirmIntent(text: string, keywords: string[]): boolean {
  const norm = normalize(text).replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
  if (!norm) return false;
  return keywords.some((k) => normalize(k) === norm);
}
