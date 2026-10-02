import { describe, it, expect } from "vitest";
import { formatBusinessHoursPt } from "./business-hours-format";

const DEFAULT = [
  { weekday: 0, open: "00:00", close: "00:00", closed: true },
  { weekday: 1, open: "08:00", close: "18:00", closed: false },
  { weekday: 2, open: "08:00", close: "18:00", closed: false },
  { weekday: 3, open: "08:00", close: "18:00", closed: false },
  { weekday: 4, open: "08:00", close: "18:00", closed: false },
  { weekday: 5, open: "08:00", close: "18:00", closed: false },
  { weekday: 6, open: "08:00", close: "11:00", closed: false },
];

describe("formatBusinessHoursPt", () => {
  it("agrupa dias consecutivos iguais (Seg a Sex) em ordem Seg-primeiro", () => {
    expect(formatBusinessHoursPt(DEFAULT)).toEqual([
      "Seg a Sex: 08:00–18:00",
      "Sáb: 08:00–11:00",
      "Dom: fechado",
    ]);
  });

  it("dia único não vira intervalo", () => {
    const days = [
      { weekday: 0, open: "00:00", close: "00:00", closed: true },
      { weekday: 1, open: "09:00", close: "17:00", closed: false },
      { weekday: 2, open: "00:00", close: "00:00", closed: true },
      { weekday: 3, open: "00:00", close: "00:00", closed: true },
      { weekday: 4, open: "00:00", close: "00:00", closed: true },
      { weekday: 5, open: "00:00", close: "00:00", closed: true },
      { weekday: 6, open: "00:00", close: "00:00", closed: true },
    ];
    expect(formatBusinessHoursPt(days)).toEqual([
      "Seg: 09:00–17:00",
      "Ter a Dom: fechado",
    ]);
  });

  it("lista vazia → []", () => {
    expect(formatBusinessHoursPt([])).toEqual([]);
  });
});
