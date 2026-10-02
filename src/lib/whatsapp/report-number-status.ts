/**
 * Report do status de um número da INSTÂNCIA → central (Gestão USAI), pra o
 * operador ver todos os números da frota. Usa `CONTROL_PLANE_URL` +
 * `x-license-secret` (= LICENSE_CONTROL_SECRET), o mesmo mecanismo do
 * `central-client.ts` — a central identifica a instância pelo segredo.
 *
 * Best-effort: o chamador (rota de conexão) não deve falhar se o report cair —
 * a conexão local já está feita. Devolve ok/erro pra logging.
 */

const TIMEOUT_MS = 10_000

export interface NumberStatusReport {
  unitId: string
  unitName?: string | null
  phoneNumberId: string
  wabaId?: string | null
  status: string
  coex: boolean
  connectedAt?: string
}

export async function reportNumberStatus(
  report: NumberStatusReport,
): Promise<{ ok: boolean; error?: string }> {
  const base = process.env.CONTROL_PLANE_URL?.trim().replace(/\/+$/, '')
  const secret = process.env.LICENSE_CONTROL_SECRET
  if (!base || !secret) {
    // Sem central configurada: não é erro fatal — só não espelha.
    return { ok: false, error: 'CONTROL_PLANE_URL/LICENSE_CONTROL_SECRET ausentes' }
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`${base}/api/instances/whatsapp-status`, {
      method: 'POST',
      cache: 'no-store',
      signal: controller.signal,
      headers: { 'content-type': 'application/json', 'x-license-secret': secret },
      body: JSON.stringify(report),
    })
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'erro' }
  } finally {
    clearTimeout(timer)
  }
}
