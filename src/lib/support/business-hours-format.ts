/**
 * Formata o horário comercial (vindo da central) em linhas legíveis em PT,
 * agrupando dias consecutivos com o mesmo horário (ex.: "Seg a Sex: 08:00–18:00").
 * Ordem "segunda-primeiro"; weekday 0=Domingo … 6=Sábado. Puro/testável.
 */
export interface BusinessDayLite {
  weekday: number;
  open: string;
  close: string;
  closed: boolean;
}

const ORDER = [1, 2, 3, 4, 5, 6, 0]; // Seg → Dom
const SHORT: Record<number, string> = {
  0: "Dom", 1: "Seg", 2: "Ter", 3: "Qua", 4: "Qui", 5: "Sex", 6: "Sáb",
};

function label(d: BusinessDayLite): string {
  return d.closed ? "fechado" : `${d.open}–${d.close}`;
}

export function formatBusinessHoursPt(days: BusinessDayLite[]): string[] {
  const byDay = new Map(days.map((d) => [d.weekday, d]));
  const seq = ORDER.map((w) => byDay.get(w)).filter(
    (d): d is BusinessDayLite => Boolean(d),
  );
  const lines: string[] = [];
  let i = 0;
  while (i < seq.length) {
    let j = i;
    while (j + 1 < seq.length && label(seq[j + 1]) === label(seq[i])) j++;
    const range =
      i === j
        ? SHORT[seq[i].weekday]
        : `${SHORT[seq[i].weekday]} a ${SHORT[seq[j].weekday]}`;
    lines.push(`${range}: ${label(seq[i])}`);
    i = j + 1;
  }
  return lines;
}
