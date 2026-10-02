// ============================================================
// Marketing Messages API (MM Lite) — núcleo puro.
//
// Decide o roteamento de envio de templates de MARKETING para o endpoint
// dedicado /marketing_messages e consulta o status de onboarding do WABA.
// A versão da Graph usada AQUI é dedicada (env META_MM_API_VERSION), isolada
// do v21.0 usado no resto dos envios — blast radius mínimo.
// ============================================================

/** Versão da Graph só para chamadas MM Lite. Definida no deploy via env
 *  (constraint: >= v24.0, onde marketing_messages_onboarding_status existe). */
export function mmApiVersion(): string {
  return process.env.META_MM_API_VERSION || 'v24.0';
}

/** true quando o template é da categoria marketing (case-insensitive). Row
 *  ausente => false (cai no /messages clássico). */
export function isMarketingTemplate(
  template?: { category?: string | null } | null,
): boolean {
  return (template?.category ?? '').toLowerCase() === 'marketing';
}

/** URL do endpoint dedicado de marketing para um phone_number_id. */
export function marketingSendUrl(phoneNumberId: string): string {
  return `https://graph.facebook.com/${mmApiVersion()}/${phoneNumberId}/marketing_messages`;
}

export type MmOnboardingStatus = 'ONBOARDED' | 'ELIGIBLE' | 'UNKNOWN';

/** Consulta o status de onboarding MM Lite do WABA. Best-effort: qualquer
 *  falha vira UNKNOWN, nunca lança. */
export async function getMarketingOnboardingStatus(
  wabaId: string,
  accessToken: string,
): Promise<{ status: MmOnboardingStatus; raw: string | null }> {
  try {
    const url = `https://graph.facebook.com/${mmApiVersion()}/${wabaId}?fields=marketing_messages_onboarding_status`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return { status: 'UNKNOWN', raw: null };
    const data = (await res.json()) as {
      marketing_messages_onboarding_status?: string | null;
    };
    const raw = data?.marketing_messages_onboarding_status ?? null;
    const status: MmOnboardingStatus =
      raw === 'ONBOARDED' ? 'ONBOARDED' : raw === 'ELIGIBLE' ? 'ELIGIBLE' : 'UNKNOWN';
    return { status, raw };
  } catch {
    return { status: 'UNKNOWN', raw: null };
  }
}
