/**
 * Confirmação de agendamento por resposta do cliente (Fase B). Chamado do
 * processamento de inbound (oficial e uazapi) para QUALQUER mensagem de texto.
 * Se a config permite e o texto casa uma palavra-chave, confirma o agendamento
 * mais próximo (próximas 48h) e move o funil. Best-effort: nunca lança.
 */

import { supabaseAdmin } from "@/lib/flows/admin-client";
import { getSchedulingConfig } from "@/lib/scheduling/config";
import { isConfirmIntent } from "@/lib/scheduling/reminders";
import { applyFunnelMove } from "@/lib/scheduling/funnel";

export async function maybeConfirmAppointment(params: {
  unitId: string | null | undefined;
  contactId: string | null | undefined;
  text: string | null | undefined;
}): Promise<void> {
  try {
    if (!params.unitId || !params.contactId || !params.text?.trim()) return;
    const cfg = await getSchedulingConfig(params.unitId);
    if (!cfg?.confirm_enabled) return;
    if (!isConfirmIntent(params.text, cfg.confirm_keywords)) return;

    const admin = supabaseAdmin();
    const now = new Date();
    const in48h = new Date(now.getTime() + 48 * 3600 * 1000);
    const { data: appts } = await admin
      .from("appointments")
      .select("id")
      .eq("unit_id", params.unitId)
      .eq("contact_id", params.contactId)
      .eq("status", "scheduled")
      .gte("starts_at", now.toISOString())
      .lte("starts_at", in48h.toISOString())
      .order("starts_at", { ascending: true })
      .limit(1);
    const appt = (appts ?? [])[0] as { id: string } | undefined;
    if (!appt) return;

    await admin
      .from("appointments")
      .update({ status: "confirmed", updated_at: now.toISOString() })
      .eq("id", appt.id);
    await applyFunnelMove(admin, cfg, params.contactId, "confirmed");
    console.info(`[confirm-inbound] agendamento ${appt.id} confirmado pelo cliente`);
  } catch (e) {
    console.warn("[confirm-inbound] falhou (best-effort):", e instanceof Error ? e.message : e);
  }
}
