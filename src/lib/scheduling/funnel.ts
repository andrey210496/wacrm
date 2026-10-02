/**
 * Funil (Fase B): seleção PURA de qual deal mover + a aplicação (I/O) do
 * movimento. Na config, cada status de agendamento mapeia (opcionalmente) para
 * uma etapa do pipeline; ao mudar o status a gente move o deal do contato.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { SchedulingConfig } from "@/lib/scheduling/config";

export type DealLite = { id: string; status: string | null; created_at: string };

/**
 * Dado os deals de um contato num pipeline, escolhe qual mover: o ATIVO mais
 * recente. Sem deal ativo → null (v1 não cria deal).
 */
export function pickDealToMove(deals: DealLite[]): string | null {
  const active = deals
    .filter((d) => (d.status ?? "active") === "active")
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  return active[0]?.id ?? null;
}

/** Mapeia um status de agendamento para a coluna de config do stage. */
export function stageKeyForStatus(
  status: string,
): "stage_scheduled" | "stage_confirmed" | "stage_completed" | "stage_no_show" | null {
  switch (status) {
    case "scheduled":
      return "stage_scheduled";
    case "confirmed":
      return "stage_confirmed";
    case "completed":
      return "stage_completed";
    case "no_show":
      return "stage_no_show";
    default:
      return null; // canceled não move
  }
}

/**
 * Move o deal do contato para a etapa mapeada ao status, se houver config +
 * etapa + deal ativo. Best-effort: nunca lança (não pode quebrar o webhook nem
 * a mudança de status). Recebe o db (service-role ou sessão) e a config.
 */
export async function applyFunnelMove(
  db: SupabaseClient,
  cfg: SchedulingConfig | null,
  contactId: string,
  status: string,
): Promise<void> {
  try {
    if (!cfg?.funnel_pipeline_id) return;
    const key = stageKeyForStatus(status);
    if (!key) return;
    const stageId = cfg[key];
    if (!stageId) return;
    const { data } = await db
      .from("deals")
      .select("id, status, created_at")
      .eq("contact_id", contactId)
      .eq("pipeline_id", cfg.funnel_pipeline_id);
    const dealId = pickDealToMove((data ?? []) as DealLite[]);
    if (!dealId) return;
    await db
      .from("deals")
      .update({ stage_id: stageId, updated_at: new Date().toISOString() })
      .eq("id", dealId);
  } catch (e) {
    console.warn("[funnel] move falhou (best-effort):", e instanceof Error ? e.message : e);
  }
}
