# RedeZap — F3: consumidor do WhatsApp Gateway (receptor de relay)

Data: 2026-09-08
Contexto: a Gestão USAI virou o gateway central (webhook único da Meta → central → relay por
`phone_number_id` pro produto dono). Ver `gestao-usai/docs/superpowers/specs/2026-09-07-whatsapp-gateway-*`.
Este é o lado **RedeZap** (wacrm): receber os eventos que a central encaminha.

## Escopo (por que só inbound)

Depois do switch, **inbound** do RedeZap passou a vir **via central** (a Meta não manda mais direto).
**Outbound** do RedeZap **continua direto pra Meta** (ele já tem os tokens em `whatsapp_config`; a Meta
aceita o envio independente de onde está o webhook). Então F3 = **receptor de relay** — o mínimo pra os
números atuais do RedeZap funcionarem ponta a ponta pelo gateway. (Enviar pela central, pra números novos
onboardados pela central sem token local, é um F3b futuro — não bloqueante.)

## O que a central manda (contrato do relay)

`POST {relayUrl}` (a `relayUrl` do RelayTarget RedeZap = a URL pública do RedeZap + `/api/whatsapp/relay`):
- Corpo = **o evento da Meta VERBATIM** (mesmo formato do webhook direto: `{entry:[{changes:[{value:{...}}]}]}`).
- Headers: `x-relay-signature` = HMAC-SHA256(corpo, relaySecret) — o segredo do RelayTarget RedeZap
  (`87049323e6dc7622c6f9d38a11ce660093bb0140924ee087d811849e11f964ab`); `x-hub-signature-256` = a assinatura
  original da Meta (também repassada); `x-connection-id`; `content-type` original.

## Backend (RedeZap / wacrm)

- **Rota** `src/app/api/whatsapp/relay/route.ts` (POST, PÚBLICA — a central chama server-to-server;
  autenticada pela assinatura de relay, não por sessão; adicionar ao proxy/middleware se preciso):
  1. Lê o corpo cru (`await req.text()`).
  2. Verifica `x-relay-signature` = HMAC-SHA256(rawBody, `GATEWAY_RELAY_SECRET`) em **tempo constante**
     (reusar/mirar o padrão de `webhook-signature.ts`). Sem/errada → **401**. Fail-closed.
  3. Parseia (JSON e, por robustez, form-urlencoded `data=`) e chama o **MESMO processamento** do webhook
     atual — reusar a função `processWebhook(body)` de `src/app/api/whatsapp/webhook/route.ts` (extrair pra
     um módulo compartilhado, ex.: `src/lib/whatsapp/process-webhook.ts`, se hoje é privada da rota — sem
     mudar a lógica). Roteia por `phone_number_id` → `whatsapp_config` da unidade, como já faz.
  4. Sempre **200** rápido após auth (erro interno vira log + 200, pra a central não re-tentar em loop).
- **Manter** a rota `/api/whatsapp/webhook` existente (inofensiva; fallback se algum dia voltar o webhook
  direto). Não remover.
- **Env nova:** `GATEWAY_RELAY_SECRET` (o segredo do RelayTarget RedeZap na central). Documentar no
  `.env.local.example`. Opcional: `GATEWAY_URL` (só será usada no F3b de envio).

## Segurança

- Relay autenticado por `GATEWAY_RELAY_SECRET` (HMAC timing-safe, fail-closed). Alternativa aceita: validar
  o `x-hub-signature-256` (a central repassa) com `META_APP_SECRET` — mas o relay-signature é o caminho
  desacoplado preferido. Nunca logar o segredo nem o corpo cru sensível.
- Processamento reusa a lógica existente (idempotência/dedup de mensagem que já existe no wacrm continua valendo).

## Config na central (operacional, no /whatsapp da Gestão USAI)

Depois do deploy do RedeZap: (1) editar o RelayTarget RedeZap → `relayUrl` = a URL pública do RedeZap +
`/api/whatsapp/relay`; (2) cadastrar os **números do RedeZap** como `WhatsAppConnection` (phoneNumberId →
RelayTarget RedeZap). Aí número do RedeZap → RedeZap; todo o resto → metodogestorpro (default).

## Pré-requisito operacional

O RedeZap precisa estar **deployado numa URL pública** (a central relaya pra ele). Se ainda não estiver,
é um passo à parte (deploy do wacrm no EasyPanel) — ou, pra teste, um túnel pro RedeZap local.

## Testes (Vitest, no build)

- Assinatura de relay: válida → processa (mock do `processWebhook`); ausente/errada → 401 (timing-safe).
- Parse: JSON e form `data=`. Corpo malformado → 200 sem quebrar (não re-tenta).
- Reuso: a rota de relay chama o mesmo `processWebhook` do webhook direto (sem duplicar lógica).

## DoD

- Build (`npm run build`) verde; `npm run test` verde; `npm run typecheck`/lint limpos. Não afirmar teste
  ao vivo (precisa do RedeZap deployado + a central relayando). Branch `feature/gateway-f3-relay` a partir
  de `feature/usa-i-multiunidade-sp1`. NÃO dar push. Não tocar na Gestão USAI.

## Fora de escopo

F3b (envio pela central p/ números sem token local), deploy do RedeZap (operacional), multi-WABA.
