# Conexão Coexistence self-service (instância) + espelho na central

Data: 2026-09-14
Status: FASE 1 CONSTRUÍDA — wacrm tsc0/build/testes; central tsc0/build/295 testes. Falta deploy. Repos: `wacrm` (instância) + `gestao-usai` (central).
Decisões: **instância faz a troca nativa** (tem META_APP_SECRET) · **status espelhado na central** (instância reporta pra cima).

## Objetivo
Deixar o **próprio cliente** conectar o número do WhatsApp **em modo Coexistence**
(o número continua no app WhatsApp Business E fica na Cloud API) direto na sua
instância (Config → WhatsApp), self-service, acompanhando o status ali — e o
operador ver todos os números da frota num painel da central. Hoje o Embedded
Signup só existe na central (operador). O token manual continua como fallback.

## Fonte / regra Meta (verificado 2026-09-14, doc oficial)
Coex NÃO é o fluxo de número novo. Confirmado na doc:
- **Pular `/register`+PIN** — o número já está registrado (ativo no app).
- Disparar **2 syncs em ≤24h**: `POST /{phone_number_id}/smb_app_data` com
  `sync_type: "smb_app_state_sync"` (contatos) e `"history"` (histórico).
- Webhook precisa dos campos `history`, `smb_app_state_sync`, `smb_message_echoes`
  (mensagens enviadas pelo app viram "echoes") — ligados no App Dashboard.
- Throughput fixo 20 mps; histórico até 180 dias.
Nada de preço/campo Meta memorizado; erro cru da Meta sobe pra UI.

## Arquitetura

### Instância (wacrm) — o cliente conecta sozinho
- `src/lib/whatsapp/embedded-signup.ts` (novo): `exchangeCodeForToken({ code })`
  → `POST graph/oauth/access_token` com `META_APP_ID` + `META_APP_SECRET`
  (já no env). Puro-ish, testável (mock fetch). App Secret nunca vai ao cliente.
- `src/lib/whatsapp/meta-api.ts`: `syncSmbAppData({ phoneNumberId, accessToken, syncType })`
  (os 2 disparos coex). `subscribeWabaToApp` já existe.
- `POST /api/whatsapp/coex/connect` (SESSÃO, admin do cliente; middleware já
  exige sessão em /api/whatsapp/*): body `{ code, phone_number_id, waba_id, unitId }`.
  Fluxo: valida dono da unidade + `phone_number_id` único (reusa lógica do
  config) → `exchangeCodeForToken` → `subscribeWabaToApp` → **pula register** →
  dispara os 2 syncs (best-effort, não bloqueia) → salva `whatsapp_config`
  (status `connected`, `registered_at=now`, `connection_type='coex'`) → reporta
  pra central (best-effort). Devolve status pra UI.
- `src/lib/whatsapp/report-number-status.ts` (novo): usa `CONTROL_PLANE_URL` +
  `x-license-secret` (mesmo mecanismo do `central-client.ts`) pra `POST
  /api/instances/whatsapp-status` na central.
- UI: botão **"Conectar com o Facebook (mantém seu WhatsApp Business)"** por
  unidade no painel Config → WhatsApp, ao lado do token manual (fallback).
  Carrega o FB SDK com `config_id` coex (env `META_CONFIG_ID`), escuta o
  `WA_EMBEDDED_SIGNUP` (valida origem), posta o code na rota acima. Status já
  aparece na tela (conectado/pendente/registrado por unidade).
- Migration: coluna `connection_type` em `whatsapp_config` (`'manual' | 'coex'`,
  default 'manual'), aditiva.

### Central (gestao-usai) — espelho pro operador
- Migration aditiva: model `InstanceNumber` (por instância×unidade×número):
  `instanceId, unitId, unitName?, phoneNumberId (@unique), wabaId?, status,
  coex (bool), connectedAt, updatedAt`. Índices por instanceId.
- `POST /api/instances/whatsapp-status` (auth `x-license-secret` via
  `authInstanceByLicense`, excluída no proxy): upsert do `InstanceNumber` por
  `phoneNumberId`. Best-effort do lado da instância — falha não quebra a conexão.
- Painel "Números da frota" (item na Sidebar, perto de Instâncias): tabela
  instância→número com status + coex + quando conectou. Robusto (padrão admin).

## Segurança
- App Secret e token só no server da instância; token criptografado (AES-256-GCM).
- Rota de conexão: sessão de admin do cliente + trava de `phone_number_id` único.
- Report instância→central: `x-license-secret` (identifica a instância), sem PII em URL.

## Testes (TDD)
- Instância: `exchangeCodeForToken` (monta a query certa, erro cru), `syncSmbAppData`
  (payload por sync_type), `report-number-status` (headers/rota). Rota coex/connect
  coberta pelo build + smoke manual.
- Central: `authInstanceByLicense` já testado; teste do upsert do InstanceNumber
  (idempotente por phoneNumberId) e do 401 sem segredo.
- tsc 0 + build verde nos dois repos.

## Fases
- **Fase 1 (esta):** conectar (coex) + salvar + status na instância + espelho na
  central + disparar os 2 syncs (fica na janela de 24h). O número já envia/recebe.
- **Fase 2 (follow-up):** processar os webhooks `history` / `smb_app_state_sync` /
  `smb_message_echoes` no `process-webhook` — puxa histórico + contatos pro CRM e
  reflete no inbox as mensagens enviadas pelo app (echoes). É o "histórico
  sincronizado" completo.

## Pré-requisitos na Meta (fora do código, operador)
- Adicionar o **domínio de cada instância** nos *Allowed Domains* do FB Login do app.
- Campos de webhook coex ligados no App Dashboard (coex já configurado no app).
- Env novo: instância `META_CONFIG_ID` (config de login coex) e `CONTROL_PLANE_URL`
  (se ainda não tiver); central sem env novo.

## Não-objetivos v1
- Ingestão do histórico/echoes no CRM (Fase 2).
- Desconectar/offboard coex pela UI (fica pro fallback/manual por ora).
