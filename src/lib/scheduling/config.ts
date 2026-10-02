/**
 * Config de agendamento por unidade (Fase B): lembretes + confirmação + funil.
 * Lida via service-role (o worker e o hook do webhook precisam ler sem sessão).
 */

import { supabaseAdmin } from "@/lib/flows/admin-client";

export type SchedulingConfig = {
  unit_id: string;
  account_id: string;
  reminders_enabled: boolean;
  reminder_offsets_min: number[];
  reminder_channel: "auto" | "official" | "uazapi";
  reminder_text: string;
  reminders: { offset_min: number; text: string; enabled: boolean }[] | null;
  confirm_enabled: boolean;
  confirm_keywords: string[];
  funnel_pipeline_id: string | null;
  stage_scheduled: string | null;
  stage_confirmed: string | null;
  stage_completed: string | null;
  stage_no_show: string | null;
  // Fase C — autoagendamento público
  public_booking_enabled: boolean;
  public_slug: string | null;
  public_lead_time_min: number;
  public_window_days: number;
};

/** Lê a config da unidade (null se não existe). Fail-safe → null. */
export async function getSchedulingConfig(unitId: string): Promise<SchedulingConfig | null> {
  try {
    const { data } = await supabaseAdmin()
      .from("scheduling_config")
      .select("*")
      .eq("unit_id", unitId)
      .maybeSingle();
    return (data as SchedulingConfig) ?? null;
  } catch {
    return null;
  }
}

/** Upsert da config (rota admin). */
export async function saveSchedulingConfig(cfg: Partial<SchedulingConfig> & { unit_id: string; account_id: string }): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("scheduling_config")
    .upsert({ ...cfg, updated_at: new Date().toISOString() }, { onConflict: "unit_id" });
  if (error) throw new Error(`Falha ao salvar config de agendamento: ${error.message}`);
}
