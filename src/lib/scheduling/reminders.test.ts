import { describe, it, expect } from "vitest";
import { renderReminder, dueOffsets, isConfirmIntent } from "./reminders";
import { pickDealToMove, stageKeyForStatus } from "./funnel";

describe("renderReminder", () => {
  it("troca placeholders (case-insensitive) e vazio p/ ausente", () => {
    const out = renderReminder("Olá {Cliente}, {servico} dia {data} às {hora}. {faltando}", {
      cliente: "Ana",
      servico: "Corte",
      data: "05/01",
      hora: "14:00",
    });
    expect(out).toBe("Olá Ana, Corte dia 05/01 às 14:00. ");
  });
});

describe("dueOffsets", () => {
  const start = new Date("2026-01-05T15:00:00.000Z");
  it("dispara o offset quando now cruza o gatilho (dentro da graça)", () => {
    // 180min antes = 12:00; now 12:10 → dentro da graça de 30min.
    const now = new Date("2026-01-05T12:10:00.000Z");
    expect(dueOffsets({ now, apptStart: start, offsets: [1440, 180], sentOffsets: [] })).toEqual([180]);
  });
  it("não dispara offset já enviado", () => {
    const now = new Date("2026-01-05T12:10:00.000Z");
    expect(dueOffsets({ now, apptStart: start, offsets: [180], sentOffsets: [180] })).toEqual([]);
  });
  it("fora da graça (atrasado) → não dispara", () => {
    const now = new Date("2026-01-05T13:00:00.000Z"); // 1h após o gatilho de 12:00
    expect(dueOffsets({ now, apptStart: start, offsets: [180], sentOffsets: [] })).toEqual([]);
  });
  it("antes do gatilho → não dispara", () => {
    const now = new Date("2026-01-05T11:00:00.000Z");
    expect(dueOffsets({ now, apptStart: start, offsets: [180], sentOffsets: [] })).toEqual([]);
  });
  it("depois do início → nada", () => {
    const now = new Date("2026-01-05T15:30:00.000Z");
    expect(dueOffsets({ now, apptStart: start, offsets: [180], sentOffsets: [] })).toEqual([]);
  });
});

describe("isConfirmIntent", () => {
  const kw = ["sim", "confirmar", "confirmado", "ok", "1"];
  it("casa exato ignorando acento/caixa/pontuação", () => {
    expect(isConfirmIntent("SIM", kw)).toBe(true);
    expect(isConfirmIntent("Confirmar!", kw)).toBe(true);
    expect(isConfirmIntent("confirmádo", kw)).toBe(true);
    expect(isConfirmIntent("1", kw)).toBe(true);
  });
  it("não casa negação nem frase", () => {
    expect(isConfirmIntent("não vou confirmar", kw)).toBe(false);
    expect(isConfirmIntent("assim", kw)).toBe(false);
    expect(isConfirmIntent("", kw)).toBe(false);
  });
});

describe("pickDealToMove", () => {
  it("escolhe o ativo mais recente", () => {
    const id = pickDealToMove([
      { id: "a", status: "active", created_at: "2026-01-01" },
      { id: "b", status: "active", created_at: "2026-01-03" },
      { id: "c", status: "won", created_at: "2026-01-05" },
    ]);
    expect(id).toBe("b");
  });
  it("sem ativo → null", () => {
    expect(pickDealToMove([{ id: "c", status: "lost", created_at: "2026-01-05" }])).toBeNull();
    expect(pickDealToMove([])).toBeNull();
  });
});

describe("stageKeyForStatus", () => {
  it("mapeia status→coluna; canceled→null", () => {
    expect(stageKeyForStatus("confirmed")).toBe("stage_confirmed");
    expect(stageKeyForStatus("no_show")).toBe("stage_no_show");
    expect(stageKeyForStatus("canceled")).toBeNull();
  });
});
