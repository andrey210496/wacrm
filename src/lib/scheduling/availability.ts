/**
 * Motor de disponibilidade da agenda (Frente 5 — Fase A). PURO e testável:
 * opera só com intervalos de tempo (Date), sem I/O. Gera os horários livres de
 * um recurso num dia, a partir do horário de trabalho menos folgas e
 * agendamentos, pela duração do serviço; e detecta conflito (overbooking).
 *
 * Convenção de intervalos: semiaberto [start, end). Dois intervalos colidem se
 * `aStart < bEnd && bStart < aEnd` (encostar não colide: 10–11 e 11–12 ok).
 */

export type TimeRange = { start: Date; end: Date };

/** Colisão de intervalos semiabertos [start,end). */
export function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();
}

/** Há conflito do intervalo [start,end) com algum intervalo ocupado? */
export function hasConflict(start: Date, end: Date, busy: TimeRange[]): boolean {
  return busy.some((b) => overlaps(start, end, b.start, b.end));
}

/**
 * Gera os slots livres de um dia. `workRanges` = faixas de trabalho já
 * resolvidas para o dia (Date). `busy` = folgas + agendamentos ativos que tocam
 * o dia. Um slot cabe se o bloco de `durationMin` fica INTEIRO dentro de uma
 * faixa de trabalho e não colide com nenhum `busy`. Passo = `stepMin` (default
 * = duração).
 */
export function generateSlots(params: {
  workRanges: TimeRange[];
  busy: TimeRange[];
  durationMin: number;
  stepMin?: number;
}): TimeRange[] {
  const { workRanges, busy, durationMin } = params;
  if (durationMin <= 0) return [];
  const durMs = durationMin * 60_000;
  const stepMs = Math.max(1, params.stepMin ?? durationMin) * 60_000;

  const slots: TimeRange[] = [];
  for (const w of workRanges) {
    const wStart = w.start.getTime();
    const wEnd = w.end.getTime();
    for (let t = wStart; t + durMs <= wEnd; t += stepMs) {
      const s = new Date(t);
      const e = new Date(t + durMs);
      if (!hasConflict(s, e, busy)) slots.push({ start: s, end: e });
    }
  }
  return slots;
}
