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

export type ReminderItem = { offset_min: number; text: string };

/**
 * Lista EFETIVA de lembretes a disparar (Fase B.2 — mensagem por lembrete).
 * Prioriza `reminders` (cada item com antecedência + texto + on/off). Se não
 * houver, cai no modelo antigo: `reminder_offsets_min` + o `reminder_text` único
 * (mesmo texto pra todas as antecedências). Ignora itens sem texto/antecedência
 * ou desligados. Puro.
 */
export function effectiveReminders(cfg: {
  reminders?: { offset_min?: unknown; text?: unknown; enabled?: unknown }[] | null;
  reminder_offsets_min?: number[] | null;
  reminder_text?: string | null;
}): ReminderItem[] {
  const list = cfg.reminders;
  if (Array.isArray(list) && list.length > 0) {
    return list
      .filter(
        (r) =>
          r &&
          r.enabled !== false &&
          typeof r.offset_min === "number" &&
          (r.offset_min as number) > 0 &&
          typeof r.text === "string" &&
          (r.text as string).trim() !== "",
      )
      .map((r) => ({ offset_min: r.offset_min as number, text: (r.text as string).trim() }));
  }
  // Fallback: modelo antigo (offsets + texto único).
  const text = (cfg.reminder_text ?? "").trim();
  if (!text) return [];
  return (cfg.reminder_offsets_min ?? [])
    .filter((o) => o > 0)
    .map((o) => ({ offset_min: o, text }));
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
