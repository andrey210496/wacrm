/**
 * Embedded Signup (Coexistence) — lado servidor da INSTÂNCIA.
 *
 * O popup do Embedded Signup entrega ao navegador um `code` de uso único. A
 * instância troca esse code pelo access token do negócio AQUI, no servidor, pra
 * o **App Secret nunca chegar ao cliente**. O token é gravado criptografado pelo
 * chamador. NUNCA loga o code, o App Secret nem o token.
 */

const META_API_VERSION = 'v21.0'
const TIMEOUT_MS = 15_000

export interface ExchangeCodeForTokenArgs {
  /** Code OAuth de uso único vindo do `authResponse.code` do `FB.login`. */
  code: string
}

/**
 * Troca o `code` do Embedded Signup por um access token de negócio via
 *   GET /{version}/oauth/access_token?client_id&client_secret&code
 * Lança com a mensagem crua da Meta em qualquer não-2xx, e quando faltam
 * META_APP_ID / META_APP_SECRET no servidor. Não ecoa valores sensíveis.
 */
export async function exchangeCodeForToken(
  args: ExchangeCodeForTokenArgs,
): Promise<string> {
  const { code } = args
  const appId = process.env.META_APP_ID?.trim()
  const appSecret = process.env.META_APP_SECRET?.trim()
  if (!appId || !appSecret) {
    throw new Error(
      'Conexão com o Facebook não configurada no servidor (META_APP_ID e/ou META_APP_SECRET ausentes).',
    )
  }
  const graphVersion = process.env.META_GRAPH_VERSION?.trim() || META_API_VERSION

  const params = new URLSearchParams({ client_id: appId, client_secret: appSecret, code })

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  let response: Response
  try {
    response = await fetch(
      `https://graph.facebook.com/${graphVersion}/oauth/access_token?${params.toString()}`,
      { cache: 'no-store', signal: controller.signal },
    )
  } finally {
    clearTimeout(timer)
  }

  if (!response.ok) {
    let message = `Meta API error: ${response.status}`
    try {
      const data = (await response.json()) as { error?: { message?: string } }
      if (data.error?.message) message = data.error.message
    } catch {
      // corpo não-JSON — mantém o fallback
    }
    throw new Error(message)
  }

  const data = (await response.json()) as { access_token?: string }
  if (!data.access_token) {
    throw new Error('A Meta não retornou um access token para o code fornecido.')
  }
  return data.access_token
}
