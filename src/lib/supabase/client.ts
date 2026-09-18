import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'

// Singleton instance — one client shared across the whole browser session.
// Creating multiple clients causes auth-lock contention ("Lock was released
// because another request stole it") and intermittent fetch failures.
let browserClient: SupabaseClient | undefined

type InjectedEnv = { SUPABASE_URL?: string; SUPABASE_ANON_KEY?: string }

/**
 * Resolve a config do Supabase pro browser, preferindo os valores injetados em
 * RUNTIME (`window.__ENV__`, posto pelo layout raiz a partir do env do
 * container) sobre o fallback de BUILD (`NEXT_PUBLIC_*`). É isso que faz UMA
 * imagem baked servir cada instância SILO com o seu próprio Supabase — os
 * valores vêm do runtime, não são assados no build. Ver `src/lib/public-env.ts`.
 *
 * Puro e exportado pra ser testável (o resto do módulo depende de `window` e do
 * SDK do Supabase, difíceis de testar em ambiente node).
 */
export function resolvePublicSupabaseEnv(
  injected: InjectedEnv | undefined,
  buildTime: { url?: string; anonKey?: string },
): { url: string; anonKey: string } {
  const url = injected?.SUPABASE_URL || buildTime.url
  const anonKey = injected?.SUPABASE_ANON_KEY || buildTime.anonKey
  if (!url || !anonKey) {
    throw new Error(
      'Config pública do Supabase ausente: nem window.__ENV__ nem ' +
        'NEXT_PUBLIC_SUPABASE_URL/NEXT_PUBLIC_SUPABASE_ANON_KEY estão definidos.',
    )
  }
  return { url, anonKey }
}

export function createClient() {
  if (browserClient) return browserClient

  const injected =
    typeof window !== 'undefined'
      ? (window as unknown as { __ENV__?: InjectedEnv }).__ENV__
      : undefined

  const { url, anonKey } = resolvePublicSupabaseEnv(injected, {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  })

  browserClient = createBrowserClient(url, anonKey)

  return browserClient
}
