/**
 * Resolve a disponibilidade de um recurso num DIA de calendário (Fase A).
 * Combina o horário de trabalho (por dia da semana, em hora LOCAL) com o fuso
 * da conta, e produz os slots livres descontando folgas e agendamentos.
 *
 * Puro/testável: recebe as linhas já carregadas e um offset de fuso em minutos
 * (ex.: BRT = -180). Não faz I/O. Usa o motor `generateSlots`.
 */

import { generateSlots, type TimeRange } from "./availability";

export type WeekdayHours = {
  weekday: number; // 0=domingo … 6=sábado (dia local)
  startTime: string; // "HH:MM" ou "HH:MM:SS"
  endTime: string;
};

function parseYMD(dateStr: string): { y: number; m: number; d: number } {
  const [y, m, d] = dateStr.split("-").map((x) => parseInt(x, 10));
  return { y, m, d };
}

function parseHMS(t: string): { h: number; mi: number } {
  const [h, mi] = t.split(":").map((x) => parseInt(x, 10));
  return { h, mi: mi || 0 };
}

/** Instante UTC (ms) de uma hora LOCAL numa data, dado o offset do fuso (min). */
function localToUtcMs(
  y: number,
  m: number,
  d: number,
  h: number,
  mi: number,
  tzOffsetMinutes: number,
): number {
  // local = UTC + offset  →  UTC = local - offset
  return Date.UTC(y, m - 1, d, h, mi) - tzOffsetMinutes * 60_000;
}

/** Dia da semana (0-6) da data de calendário — independente de fuso. */
export function weekdayOf(dateStr: string): number {
  const { y, m, d } = parseYMD(dateStr);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Constrói as faixas de trabalho (UTC) de um recurso para a data. */
export function buildWorkRanges(
  dateStr: string,
  weekdayHours: WeekdayHours[],
  tzOffsetMinutes: number,
): TimeRange[] {
  const { y, m, d } = parseYMD(dateStr);
  const wd = weekdayOf(dateStr);
  return weekdayHours
    .filter((wh) => wh.weekday === wd)
    .map((wh) => {
      const s = parseHMS(wh.startTime);
      const e = parseHMS(wh.endTime);
      return {
        start: new Date(localToUtcMs(y, m, d, s.h, s.mi, tzOffsetMinutes)),
        end: new Date(localToUtcMs(y, m, d, e.h, e.mi, tzOffsetMinutes)),
      };
    })
    .sort((a, b) => a.start.getTime() - b.start.getTime());
}

/** Slots livres do recurso na data: horário de trabalho − folgas − agendamentos. */
export function freeSlotsForDay(params: {
  dateStr: string;
  tzOffsetMinutes: number;
  weekdayHours: WeekdayHours[];
  timeOff: TimeRange[];
  appointments: TimeRange[];
  durationMin: number;
  stepMin?: number;
}): TimeRange[] {
  const workRanges = buildWorkRanges(params.dateStr, params.weekdayHours, params.tzOffsetMinutes);
  return generateSlots({
    workRanges,
    busy: [...params.timeOff, ...params.appointments],
    durationMin: params.durationMin,
    stepMin: params.stepMin,
  });
}
