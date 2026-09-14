// POST /api/appointments/reminder-status — status dos lembretes de vários
// agendamentos, para o selo no card da agenda. Sessão AGENT+. Escopado à conta.
import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/flows/admin-client";
import { aggregateReminderStatus, type ReminderRow } from "@/lib/scheduling/reminder-status";

export async function POST(request: Request) {
  let ctx;
  try {
    ctx = await requireRole("agent");
  } catch (err) {
    return toErrorResponse(err);
  }
  let body: { ids?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const ids = Array.isArray(body.ids) ? body.ids.map((x) => String(x)).filter(Boolean).slice(0, 500) : [];
  if (ids.length === 0) return NextResponse.json({ ok: true, statuses: {} });

  // Lê via service-role, mas ESCOPADO à conta do usuário (join no appointments).
  const { data } = await supabaseAdmin()
    .from("appointment_reminders_sent")
    .select("appointment_id, status, error, appointments!inner(account_id)")
    .in("appointment_id", ids)
    .eq("appointments.account_id", ctx.accountId);

  const rows = ((data ?? []) as { appointment_id: string; status: string; error: string | null }[]).map(
    (r) => ({ appointment_id: r.appointment_id, status: r.status as ReminderRow["status"], error: r.error }),
  );
  return NextResponse.json({ ok: true, statuses: aggregateReminderStatus(rows) });
}
