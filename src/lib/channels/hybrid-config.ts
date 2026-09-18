/**
 * Config do canal híbrido ("Conexão redezap") por unidade (Frente 2).
 *
 * Lida via service-role (`supabaseAdmin`) porque o envio precisa ler a config
 * independentemente do cliente (dashboard RLS ou API pública), e o contador de
 * interleave é incrementado atomicamente por uma função do Postgres.
 */

import { supabaseAdmin } from "@/lib/flows/admin-client";
import type { BillableMode } from "@/lib/whatsapp/outbound-router";

export type HybridConfig = {
  hybridEnabled: boolean;
  uazapiPct: number;
  billableMode: BillableMode;
};

const MODES: BillableMode[] = ["auto", "always", "template_only"];

const DISABLED: HybridConfig = { hybridEnabled: false, uazapiPct: 0, billableMode: "auto" };

/**
 * Lê a config da unidade. Sem linha = híbrido desligado (default seguro).
 * FAIL-SAFE: qualquer erro de leitura → híbrido desligado (o envio segue no
 * oficial). Uma falha ao ler a config NUNCA pode quebrar o envio.
 */
export async function getHybridConfig(unitId: string): Promise<HybridConfig> {
  try {
    const { data } = await supabaseAdmin()
      .from("channel_hybrid_config")
      .select("hybrid_enabled, uazapi_pct, billable_mode")
      .eq("unit_id", unitId)
      .maybeSingle();
    return {
      hybridEnabled: data?.hybrid_enabled ?? false,
      uazapiPct: typeof data?.uazapi_pct === "number" ? data.uazapi_pct : 0,
      billableMode: MODES.includes(data?.billable_mode) ? data!.billable_mode : "auto",
    };
  } catch {
    return DISABLED;
  }
}

/** Incremento atômico do contador; devolve o valor pré-incremento (0-based). Fail-safe → 0. */
export async function nextInterleaveCounter(unitId: string): Promise<number> {
  try {
    const { data } = await supabaseAdmin().rpc("next_interleave_counter", {
      p_unit: unitId,
    });
    return typeof data === "number" ? data : 0;
  } catch {
    return 0;
  }
}

/** Grava (upsert) a config — NÃO reseta o contador. */
export async function saveHybridConfig(params: {
  unitId: string;
  accountId: string;
  hybridEnabled: boolean;
  uazapiPct: number;
  billableMode: BillableMode;
}): Promise<void> {
  const pct = Math.max(0, Math.min(100, Math.round(params.uazapiPct)));
  const mode: BillableMode = MODES.includes(params.billableMode)
    ? params.billableMode
    : "auto";
  const { error } = await supabaseAdmin()
    .from("channel_hybrid_config")
    .upsert(
      {
        unit_id: params.unitId,
        account_id: params.accountId,
        hybrid_enabled: params.hybridEnabled,
        uazapi_pct: pct,
        billable_mode: mode,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "unit_id" },
    );
  if (error) throw new Error(`Falha ao salvar config híbrida: ${error.message}`);
}
