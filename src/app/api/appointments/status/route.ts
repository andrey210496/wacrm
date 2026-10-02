// POST /api/appointments/status — muda o status de um agendamento e move o funil.
// Sessão AGENT+. O funil é movido server-side (config via service-role) para
// ficar consistente com a confirmação automática do inbound.
import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/flows/admin-client";
import { getSchedulingConfig } from "@/lib/scheduling/config";
import { applyFunnelMove } from "@/lib/scheduling/funnel";

const STATUSES = ["scheduled", "confirmed", "completed", "canceled", "no_show"] as const;

export async function POST(request: Request) {
  try {
    await requireRole("agent");
  } catch (err) {
    return toErrorResponse(err);
  }
  let body: { id?: unknown; status?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const id = String(body.id ?? "").trim();
  const status = String(body.status ?? "");
  if (!id || !(STATUSES as readonly string[]).includes(status)) {
    return NextResponse.json({ error: "id e status válidos são obrigatórios" }, { status: 400 });
  }

  const db = await createClient();
  const { data: row, error } = await db
    .from("appointments")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("unit_id, contact_id")
    .single();

  if (error || !row) {
    return NextResponse.json({ error: error?.message ?? "não encontrado" }, { status: 404 });
  }

  // Move o funil (best-effort) — mesma lógica da confirmação automática.
  const cfg = await getSchedulingConfig(row.unit_id);
  await applyFunnelMove(supabaseAdmin(), cfg, row.contact_id, status);

  return NextResponse.json({ ok: true });
}
