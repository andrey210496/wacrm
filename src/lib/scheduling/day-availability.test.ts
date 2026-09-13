import { describe, it, expect } from "vitest";
import { weekdayOf, buildWorkRanges, freeSlotsForDay } from "./day-availability";

// 2026-01-05 é uma SEGUNDA-feira (weekday 1).
const MON = "2026-01-05";
const BRT = -180; // UTC-3

describe("weekdayOf", () => {
  it("2026-01-05 → segunda (1)", () => {
    expect(weekdayOf(MON)).toBe(1);
  });
  it("2026-01-04 → domingo (0)", () => {
    expect(weekdayOf("2026-01-04")).toBe(0);
  });
});

describe("buildWorkRanges", () => {
  it("09:00–12:00 local BRT vira 12:00–15:00 UTC", () => {
    const r = buildWorkRanges(MON, [{ weekday: 1, startTime: "09:00", endTime: "12:00" }], BRT);
    expect(r).toHaveLength(1);
    expect(r[0].start.toISOString()).toBe("2026-01-05T12:00:00.000Z");
    expect(r[0].end.toISOString()).toBe("2026-01-05T15:00:00.000Z");
  });
  it("ignora faixas de outro dia da semana", () => {
    const r = buildWorkRanges(MON, [{ weekday: 2, startTime: "09:00", endTime: "12:00" }], BRT);
    expect(r).toHaveLength(0);
  });
  it("offset 0 (UTC) mantém a hora", () => {
    const r = buildWorkRanges(MON, [{ weekday: 1, startTime: "09:00", endTime: "10:00" }], 0);
    expect(r[0].start.toISOString()).toBe("2026-01-05T09:00:00.000Z");
  });
});

describe("freeSlotsForDay", () => {
  it("9–12 BRT, serviço 60min, sem nada → 3 slots (12,13,14 UTC)", () => {
    const s = freeSlotsForDay({
      dateStr: MON,
      tzOffsetMinutes: BRT,
      weekdayHours: [{ weekday: 1, startTime: "09:00", endTime: "12:00" }],
      timeOff: [],
      appointments: [],
      durationMin: 60,
    });
    expect(s.map((x) => x.start.toISOString())).toEqual([
      "2026-01-05T12:00:00.000Z",
      "2026-01-05T13:00:00.000Z",
      "2026-01-05T14:00:00.000Z",
    ]);
  });

  it("agendamento 10–11 local (13–14 UTC) remove o slot do meio", () => {
    const s = freeSlotsForDay({
      dateStr: MON,
      tzOffsetMinutes: BRT,
      weekdayHours: [{ weekday: 1, startTime: "09:00", endTime: "12:00" }],
      timeOff: [],
      appointments: [
        { start: new Date("2026-01-05T13:00:00.000Z"), end: new Date("2026-01-05T14:00:00.000Z") },
      ],
      durationMin: 60,
    });
    expect(s.map((x) => x.start.toISOString())).toEqual([
      "2026-01-05T12:00:00.000Z",
      "2026-01-05T14:00:00.000Z",
    ]);
  });

  it("folga cobre a tarde → some o último slot", () => {
    const s = freeSlotsForDay({
      dateStr: MON,
      tzOffsetMinutes: BRT,
      weekdayHours: [{ weekday: 1, startTime: "09:00", endTime: "12:00" }],
      timeOff: [{ start: new Date("2026-01-05T14:00:00.000Z"), end: new Date("2026-01-05T15:00:00.000Z") }],
      appointments: [],
      durationMin: 60,
    });
    expect(s.map((x) => x.start.toISOString())).toEqual([
      "2026-01-05T12:00:00.000Z",
      "2026-01-05T13:00:00.000Z",
    ]);
  });

  it("dia sem expediente → 0", () => {
    const s = freeSlotsForDay({
      dateStr: MON,
      tzOffsetMinutes: BRT,
      weekdayHours: [{ weekday: 3, startTime: "09:00", endTime: "12:00" }],
      timeOff: [],
      appointments: [],
      durationMin: 60,
    });
    expect(s).toHaveLength(0);
  });
});
