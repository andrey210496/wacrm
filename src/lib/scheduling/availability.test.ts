import { describe, it, expect } from "vitest";
import { overlaps, hasConflict, generateSlots, type TimeRange } from "./availability";

// Helper: Date de um dia fixo (2026-01-05) no horário HH:MM em UTC.
function at(h: number, m = 0): Date {
  return new Date(Date.UTC(2026, 0, 5, h, m, 0));
}
function range(h1: number, m1: number, h2: number, m2: number): TimeRange {
  return { start: at(h1, m1), end: at(h2, m2) };
}

describe("overlaps", () => {
  it("sobreposição parcial → true", () => {
    expect(overlaps(at(10), at(11), at(10, 30), at(11, 30))).toBe(true);
  });
  it("encostar (10-11 e 11-12) → false", () => {
    expect(overlaps(at(10), at(11), at(11), at(12))).toBe(false);
  });
  it("contido → true", () => {
    expect(overlaps(at(9), at(12), at(10), at(11))).toBe(true);
  });
  it("disjunto → false", () => {
    expect(overlaps(at(9), at(10), at(11), at(12))).toBe(false);
  });
});

describe("hasConflict", () => {
  it("detecta colisão com algum ocupado", () => {
    const busy = [range(10, 0, 11, 0)];
    expect(hasConflict(at(10, 30), at(11, 30), busy)).toBe(true);
    expect(hasConflict(at(11, 0), at(12, 0), busy)).toBe(false);
  });
});

describe("generateSlots", () => {
  it("9–12, dur 60, sem ocupados → 3 slots (9,10,11)", () => {
    const s = generateSlots({ workRanges: [range(9, 0, 12, 0)], busy: [], durationMin: 60 });
    expect(s.map((x) => x.start.getUTCHours())).toEqual([9, 10, 11]);
  });

  it("remove slot que colide com agendamento (10–11)", () => {
    const s = generateSlots({ workRanges: [range(9, 0, 12, 0)], busy: [range(10, 0, 11, 0)], durationMin: 60 });
    expect(s.map((x) => x.start.getUTCHours())).toEqual([9, 11]);
  });

  it("passo 30 com dur 60 e busy 10–11 → sobram 9:00 e 11:00", () => {
    const s = generateSlots({ workRanges: [range(9, 0, 12, 0)], busy: [range(10, 0, 11, 0)], durationMin: 60, stepMin: 30 });
    const labels = s.map((x) => `${x.start.getUTCHours()}:${String(x.start.getUTCMinutes()).padStart(2, "0")}`);
    expect(labels).toEqual(["9:00", "11:00"]);
  });

  it("duração maior que a janela → 0 slots", () => {
    const s = generateSlots({ workRanges: [range(9, 0, 9, 30)], busy: [], durationMin: 60 });
    expect(s).toHaveLength(0);
  });

  it("várias faixas (9–12 e 14–16), dur 60 → 5 slots", () => {
    const s = generateSlots({ workRanges: [range(9, 0, 12, 0), range(14, 0, 16, 0)], busy: [], durationMin: 60 });
    expect(s.map((x) => x.start.getUTCHours())).toEqual([9, 10, 11, 14, 15]);
  });

  it("folga no meio conta como ocupado", () => {
    const s = generateSlots({
      workRanges: [range(9, 0, 12, 0)],
      busy: [range(10, 0, 10, 30)], // folga curta bloqueia o slot das 10
      durationMin: 60,
    });
    expect(s.map((x) => x.start.getUTCHours())).toEqual([9, 11]);
  });

  it("dia sem expediente → 0 slots", () => {
    expect(generateSlots({ workRanges: [], busy: [], durationMin: 60 })).toHaveLength(0);
  });

  it("duração inválida → 0 slots", () => {
    expect(generateSlots({ workRanges: [range(9, 0, 12, 0)], busy: [], durationMin: 0 })).toHaveLength(0);
  });
});
