import { describe, it, expect } from "vitest";
import { aggregateReminderStatus } from "./reminder-status";

describe("aggregateReminderStatus", () => {
  it("failed ganha de sent no mesmo agendamento", () => {
    const out = aggregateReminderStatus([
      { appointment_id: "a", status: "sent" },
      { appointment_id: "a", status: "failed", error: "telefone inválido" },
    ]);
    expect(out["a"]).toEqual({ state: "failed", error: "telefone inválido" });
  });

  it("só enviados → sent", () => {
    const out = aggregateReminderStatus([
      { appointment_id: "b", status: "sent" },
      { appointment_id: "b", status: "sent" },
    ]);
    expect(out["b"].state).toBe("sent");
  });

  it("agendamentos distintos independentes", () => {
    const out = aggregateReminderStatus([
      { appointment_id: "a", status: "failed", error: "x" },
      { appointment_id: "b", status: "sent" },
      { appointment_id: "c", status: "pending" },
    ]);
    expect(out["a"].state).toBe("failed");
    expect(out["b"].state).toBe("sent");
    expect(out["c"].state).toBe("pending");
  });

  it("vazio → objeto vazio", () => {
    expect(aggregateReminderStatus([])).toEqual({});
  });
});
