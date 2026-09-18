import { describe, it, expect } from "vitest";
import { combineResourceSlots } from "./combine-slots";

function r(hh: number): { start: Date; end: Date } {
  return { start: new Date(Date.UTC(2026, 0, 5, hh, 0)), end: new Date(Date.UTC(2026, 0, 5, hh + 1, 0)) };
}

describe("combineResourceSlots", () => {
  it("atribui o 1º recurso livre por horário e ordena", () => {
    const out = combineResourceSlots([
      { resourceId: "R1", slots: [r(9), r(11)] },
      { resourceId: "R2", slots: [r(10), r(11)] },
    ]);
    expect(out.map((s) => `${s.start.getUTCHours()}:${s.resourceId}`)).toEqual([
      "9:R1",
      "10:R2",
      "11:R1", // 11h existe nos dois → fica com o primeiro (R1)
    ]);
  });

  it("vazio → vazio", () => {
    expect(combineResourceSlots([])).toEqual([]);
    expect(combineResourceSlots([{ resourceId: "R1", slots: [] }])).toEqual([]);
  });
});
