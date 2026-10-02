# RedeZap — WhatsApp Embedded Signup (onboarding 1-clique)

Data: 2026-09-07
Contexto: o dono é **Tech Provider** com app Meta **aprovado**. Hoje a conexão é manual
(colar Phone Number ID + Access Token). Adicionar o **Embedded Signup**: o cliente clica,
loga no Facebook dele, escolhe/cria a WABA + número, e o RedeZap conecta sozinho.

Muita coisa JÁ existe em `src/lib/whatsapp/meta-api.ts`: `subscribeWabaToApp(wabaId, token)`,
`registerPhoneNumber(phoneNumberId, token, pin?)` (trata "already registered"),
`getSubscribedApps`, `verifyPhoneNumber`. Graph `v21.0`. Falta: troca do `code`→token, a
rota de orquestração e o front (SDK do Facebook + botão). Multiunidade: cada unidade conecta
seu número.

## Fluxo (Tech Provider, response_type=code)

**Frontend** (client component; novo `EmbeddedSignupButton` usado na tela de WhatsApp por unidade):
1. Carrega o SDK: `https://connect.facebook.net/en_US/sdk.js`; `FB.init({ appId: NEXT_PUBLIC_META_APP_ID, version: NEXT_PUBLIC_META_GRAPH_VERSION, xfbml:false, cookie:true })`.
2. `window.addEventListener('message', ...)` capturando os eventos `WA_EMBEDDED_SIGNUP`:
   `event: 'FINISH'` → `data.phone_number_id`, `data.waba_id`; tratar `CANCEL`/`ERROR` (feedback).
   Validar `origin` = `https://www.facebook.com`.
3. No clique do botão: `FB.login(cb, { config_id: NEXT_PUBLIC_META_CONFIG_ID, response_type:'code', override_default_response_type:true, extras:{ setup:{}, sessionInfoVersion:'3' } })`.
   O callback recebe `response.authResponse.code` (code de uso único).
4. Junta `code` (do callback) + `phone_number_id`/`waba_id` (do evento message) + `unitId` →
   `POST /api/whatsapp/embedded-signup`. Mostra loading; em sucesso, recarrega a config da unidade.

**Backend** `src/app/api/whatsapp/embedded-signup/route.ts` (POST, sessão obrigatória):
1. Body: `{ code, phone_number_id, waba_id, unitId }`. Validar presença.
2. **Troca code→token** (server-side, App Secret NUNCA vai pro client):
   `GET https://graph.facebook.com/v21.0/oauth/access_token?client_id={META_APP_ID}&client_secret={META_APP_SECRET}&code={code}` → `access_token` do negócio do cliente.
3. `subscribeWabaToApp(waba_id, token)` — assina o app na WABA do cliente (eventos passam a vir).
4. `registerPhoneNumber(phone_number_id, token)` — registra o número na Cloud API (Embedded
   Signup normalmente já define o PIN; tratar "already registered" como OK).
5. Grava/atualiza `whatsapp_config` da unidade: `access_token` **criptografado** (`encrypt`),
   `phone_number_id`, `waba_id`, `verify_token` = o token de webhook app-level
   (`WHATSAPP_WEBHOOK_VERIFY_TOKEN`), `unit_id`, `registered_at = now`. Respeitar a regra
   existente de `UNIQUE(phone_number_id)` (se outra unidade já reivindicou o número → erro claro).
6. Nunca logar token/secret/code. Retornar `{ ok, phone_number_id }`.

**Webhook (GET verify)** `src/app/api/whatsapp/webhook/route.ts`: com Embedded Signup o webhook
é **app-level** (uma URL + um verify token no painel do app). Ajustar o GET-verify para aceitar
TAMBÉM o `WHATSAPP_WEBHOOK_VERIFY_TOKEN` do env (além dos `whatsapp_config.verify_token` por
config que já checa). Assinatura (POST) continua via `META_APP_SECRET` (inalterada).

## Config / envs (novas)

Servidor: `META_CONFIG_ID` (a "configuration" do Embedded Signup),
`WHATSAPP_WEBHOOK_VERIFY_TOKEN` (verify token app-level do webhook).
Cliente: `NEXT_PUBLIC_META_APP_ID` (= META_APP_ID), `NEXT_PUBLIC_META_CONFIG_ID` (= META_CONFIG_ID),
`NEXT_PUBLIC_META_GRAPH_VERSION` (= `v21.0`). Atualizar `.env.local.example` documentando todas.
Se `NEXT_PUBLIC_META_CONFIG_ID` estiver ausente, o botão aparece **desabilitado** com dica
("configure o Embedded Signup"), sem quebrar a tela.

## UI

Na tela de WhatsApp (`src/components/settings/whatsapp-config.tsx`), por unidade, adicionar um
bloco no topo **"Conectar com o Facebook"** com o `EmbeddedSignupButton` (botão azul do FB) e uma
linha "recomendado". O formulário manual atual vira uma seção **"Configuração manual (avançado)"**
recolhível — mantido como fallback. Reusar toasts/estados existentes; textos PT-BR (adicionar as
chaves em `messages/pt.json`, `en.json`, `ko.json`).

## Segurança

- Troca de `code` por token **só no servidor**; App Secret nunca exposto ao cliente.
- Access token do cliente **criptografado** em repouso (`encrypt`), nunca reexibido/logado.
- Validar `origin` das mensagens do SDK. `code` é de uso único.
- Sessão obrigatória na rota; respeitar a posse de `phone_number_id` (multiunidade).

## Testes / DoD

- Vitest: a troca code→token (fetch mockado: sucesso, erro do Graph), o parse do payload do
  Embedded Signup, e o handler da rota (mockar subscribe/register/DB) — sucesso e caminhos de
  erro (Graph falha → 4xx claro; número já de outra unidade → conflito). Reusar o estilo dos
  testes existentes em `src/app/api/whatsapp/*`.
- `npm run build` verde; `npm run typecheck` limpo; `npm run lint` limpo. Não afirmar teste ao
  vivo do popup (precisa do login real do Facebook + config_id do dono).
- Branch `feature/embedded-signup` a partir de `feature/usa-i-multiunidade-sp1`. Commits
  temáticos. NÃO dar push (eu reviso). Não tocar em outros projetos.

## Fora de escopo

Multi-WABA por unidade, gestão de templates via signup, e o fluxo de "coexistence" (número que
fica no app E na API). Aqui: onboarding 1-clique que conecta número→unidade e assina a WABA.
