/**
 * Config pública (segura pro navegador) lida do env de RUNTIME do servidor e
 * injetada na página como `window.__ENV__` pelo layout raiz.
 *
 * Por que existe: o RedeZap deploya SILO — uma imagem, muitos clientes, cada um
 * com o seu próprio projeto Supabase. As variáveis `NEXT_PUBLIC_*` do Next são
 * "assadas" no BUILD, então uma imagem baked serviria um único Supabase. Lendo
 * esses valores no servidor em tempo de request (onde `process.env` tem os
 * valores do container, não os do build) e injetando no HTML, a MESMA imagem
 * atende Pure Pilates, X Calotas etc. — cada instância com o Supabase dela.
 *
 * Só valores PÚBLICOS entram aqui (URL + anon key, ambos já expostos ao browser
 * de qualquer forma). Segredos de servidor (service_role, ENCRYPTION_KEY, …)
 * NUNCA são injetados — ficam só no `process.env` do servidor.
 *
 * Consumido no browser por `src/lib/supabase/client.ts`.
 */
export type PublicEnv = {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
};

export function readPublicEnv(): PublicEnv {
  return {
    SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  };
}
