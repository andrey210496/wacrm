/**
 * Meta WhatsApp Cloud API — PERFIL do negócio (Frente 3).
 *
 * Segue a convenção do `meta-api.ts` (um objeto de opções por função, erro da
 * Meta cru via `throwMetaError`). Endpoints/versão/campos CENTRALIZADOS aqui;
 * qualquer divergência aparece como o erro cru da Meta na UI, e a correção é num
 * ponto só.
 *
 * Regra Meta = validar na fonte. Onde a doc não pôde ser confirmada na hora do
 * build, está marcado `// CONFIRMAR NA META`.
 */

import { uploadResumableMedia } from './meta-api'

const META_API_VERSION = 'v21.0'
const META_API_BASE = `https://graph.facebook.com/${META_API_VERSION}`

// Campos lidos do perfil. Centralizados. // CONFIRMAR NA META os nomes exatos.
const PROFILE_FIELDS =
  'about,address,description,email,profile_picture_url,vertical,websites'

interface MetaErrorResponse {
  error?: { message?: string; code?: number; type?: string }
}

async function throwMetaError(response: Response, fallback: string): Promise<never> {
  let message = fallback
  try {
    const data = (await response.json()) as MetaErrorResponse
    if (data.error?.message) message = data.error.message
  } catch {
    // corpo não-JSON — mantém o fallback
  }
  throw new Error(message)
}

export interface BusinessProfile {
  about?: string
  address?: string
  description?: string
  email?: string
  profile_picture_url?: string
  vertical?: string
  websites?: string[]
}

// ============================================================
// Leitura
// ============================================================

export interface GetBusinessProfileArgs {
  phoneNumberId: string
  accessToken: string
}

/**
 * Lê o perfil de negócio da unidade. A Cloud API devolve
 * `{ data: [ { ...perfil } ] }` — desembrulha pro primeiro item.
 */
export async function getBusinessProfile(
  args: GetBusinessProfileArgs,
): Promise<BusinessProfile> {
  const { phoneNumberId, accessToken } = args
  const url = `${META_API_BASE}/${phoneNumberId}/whatsapp_business_profile?fields=${PROFILE_FIELDS}`
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  const data = (await response.json()) as { data?: BusinessProfile[] }
  return (data.data && data.data[0]) || {}
}

// ============================================================
// Atualização de campos
// ============================================================

export interface UpdateBusinessProfileArgs {
  phoneNumberId: string
  accessToken: string
  /** Só os campos enviados são alterados. `profile_picture_handle` vem do upload. */
  fields: Partial<BusinessProfile> & { profile_picture_handle?: string }
}

/**
 * Atualiza campos do perfil. `messaging_product: "whatsapp"` é obrigatório no
 * corpo. `websites` é array; string vazia num campo o LIMPA (comportamento da
 * Meta). // CONFIRMAR NA META.
 */
export async function updateBusinessProfile(
  args: UpdateBusinessProfileArgs,
): Promise<void> {
  const { phoneNumberId, accessToken, fields } = args
  const url = `${META_API_BASE}/${phoneNumberId}/whatsapp_business_profile`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ messaging_product: 'whatsapp', ...fields }),
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
}

// ============================================================
// Foto do perfil (Resumable Upload → handle)
// ============================================================

export interface UploadProfilePhotoArgs {
  /** Meta App id (env META_APP_ID) — resumable upload é app-scoped. */
  appId: string
  accessToken: string
  fileName: string
  mimeType: string
  bytes: Uint8Array
}

/**
 * Sobe a foto pelo Resumable Upload API (reaproveita `uploadResumableMedia` do
 * meta-api.ts) e devolve o `handle` pra usar como `profile_picture_handle` no
 * `updateBusinessProfile`. // CONFIRMAR NA META que o perfil aceita
 * profile_picture_handle (fluxo idêntico ao header de template).
 */
export async function uploadProfilePhoto(
  args: UploadProfilePhotoArgs,
): Promise<{ handle: string }> {
  return uploadResumableMedia(args)
}

// ============================================================
// Username (Username API — POST/GET/DELETE /<phone_number_id>/username)
// ============================================================

export interface SetUsernameArgs {
  phoneNumberId: string
  accessToken: string
  username: string
  /** `none` (default) ou `force_transfer` pra puxar um username já reservado. */
  transferAction?: 'none' | 'force_transfer'
}

/**
 * Define/reserva o username do número (Username API). Endpoint confirmado na doc
 * oficial da Meta (Business-scoped user IDs / Username API, verificado 2026-09-13):
 *   POST /<PHONE_NUMBER_ID>/username  body { username, transfer_action? }
 * O erro cru da Meta sobe pra UI.
 */
export async function setUsername(args: SetUsernameArgs): Promise<void> {
  const { phoneNumberId, accessToken, username, transferAction } = args
  const url = `${META_API_BASE}/${phoneNumberId}/username`
  const body: Record<string, unknown> = { username }
  if (transferAction) body.transfer_action = transferAction
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
}

export type UsernameStatus = {
  username?: string
  /** `approved` (visível) | `reserved` (reservado, ainda não visível). */
  status?: string
}

/**
 * Lê o username atual do número + status. Endpoint oficial:
 *   GET /<PHONE_NUMBER_ID>/username → { username?, status? }
 * Sem username definido, a Meta omite o campo → devolvemos {}.
 */
export async function getUsername(
  phoneNumberId: string,
  accessToken: string,
): Promise<UsernameStatus> {
  const url = `${META_API_BASE}/${phoneNumberId}/username`
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  const data = (await response.json()) as UsernameStatus
  return { username: data.username, status: data.status }
}
