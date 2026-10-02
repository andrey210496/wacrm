/**
 * Agrega o status dos lembretes por agendamento (Fase B.1), para mostrar um
 * selo no card da agenda. Um agendamento pode ter vários lembretes (ex.: 24h e
 * 3h). A regra de exibição: falha "ganha" de enviado, que ganha de nada — assim
 * o atendente vê primeiro o que precisa de ação. Puro/testável.
 */

export type ReminderRow = {
  appointment_id: string;
  status: "sent" | "failed" | "pending";
  error?: string | null;
};

export type ReminderStatus = {
  state: "sent" | "failed" | "pending";
  error?: string | null;
};

/** Estado por agendamento: failed > pending > sent. */
export function aggregateReminderStatus(rows: ReminderRow[]): Record<string, ReminderStatus> {
  const rank: Record<ReminderRow["status"], number> = { failed: 3, pending: 2, sent: 1 };
  const out: Record<string, ReminderStatus> = {};
  for (const r of rows) {
    const cur = out[r.appointment_id];
    if (!cur || rank[r.status] > rank[cur.state]) {
      out[r.appointment_id] = { state: r.status, error: r.status === "failed" ? r.error ?? null : cur?.error ?? null };
    }
  }
  return out;
}
