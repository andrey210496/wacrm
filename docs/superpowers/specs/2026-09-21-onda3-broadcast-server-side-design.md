# Onda 3 — Envio de broadcast server-side (fila durável)

**Data:** 2026-09-21
**Repo:** wacrm (instância RedeZap) · branch `feature/usa-i-multiunidade-sp1`
**Stack:** Next.js 16 (App Router, `src/middleware.ts`), TypeScript, Supabase, Vitest. Envio via Meta (`sendTemplateMessage`).

## Contexto

Hoje o **envio inicial** de uma campanha roda **no navegador** do usuário (`src/hooks/use-broadcast-sending.ts`, hook client): resolve audiência (o tipo "todos" carrega a base **inteira** de contatos no browser), insere destinatários e roda o laço de envio à Meta (10/lote, 1s de pausa → ~100 lotes/vários minutos para 1.000 destinatários). **Se o tab fecha, a campanha trava** com destinatários `pending` e a BM fica "pendente".

Já existe um **motor de entrega server-side completo e testado** (`src/lib/whatsapp/broadcast-core.ts` `deliverBroadcast`/`finalizeBroadcastStatus` + `broadcast-resume.ts` com `claimBroadcastDelivery` [lock atômico via `delivery_locked_at`, stale 30 min], `planBroadcastResume`, `RESUME_MAX_PER_REQUEST=1000`), usado hoje só no **Resume/Retry** (`POST /api/whatsapp/broadcast/[id]/resume`, `requireRole('agent')`, `after()`, `maxDuration=300`). O próprio código anota que o envio inicial **não** foi movido pro servidor de propósito — é o que esta frente faz.

## Decisões (aprovadas com o usuário)

- **Tudo no servidor:** um endpoint novo (autenticado por sessão) resolve a **audiência** + **mapeamento de variáveis** + cria o broadcast + destinatários e dispara o envio. Isso também elimina o "carregar todos os contatos no browser".
- **Cron de drenagem (fila durável):** cria todos os destinatários (`pending`) e um cron drena em passes de ≤1000 até acabar — sem teto de tamanho, e **auto-recupera** qualquer campanha travada (tab fechado, crash). Mata de vez o "pendente na BM".
- **Reuso máximo:** o motor de entrega (`deliverBroadcast`), o claim-lock e o planejador **não mudam** — são reusados pelo "chute" inicial e pelo cron.

## Escopo

**Dentro:** endpoint de disparo server-side (resolve audiência/variáveis/CSV, cria, chuta a 1ª leva); cron de drenagem; helper de passe compartilhado; wizard fino (POST + redirect); polling leve na tela de detalhe.

**Fora:** mudar o formato de envio à Meta (MM Lite é frente própria — o roteamento por categoria em `sendTemplateMessage` já existe e continua valendo); rearquitetar automations/flows; agendamento de campanha (envio futuro).

---

## Arquitetura

Três peças, reusando o engine testado:

### 1. Endpoint de disparo (novo) — `POST /api/whatsapp/broadcasts/dispatch`
- Auth por sessão: `requireRole('agent')` (`@/lib/auth/account`). `maxDuration = 60`.
- Body (o wizard manda a CONFIG, não os contatos resolvidos): `{ name, template: { name, language, header_type }, variables: Record<string, VariableMapping>, audience: AudienceConfig (incl. csvContacts parseados), headerMediaUrl?, selectedUnitId? }`.
- Fluxo:
  1. Resolve a **unidade** (`resolveOperatorUnitId(supabase, accountId, userId, selectedUnitId)`).
  2. Resolve a **audiência** server-side (`resolveAudienceServer`): all/tags/custom_field/csv + excludeTagIds. CSV: `upsertCsvContacts` (cria contatos faltantes). Leituras via client de sessão (RLS por conta = tenant-safe).
  3. Resolve **variáveis por contato** (`resolveVariables` + `fetchCustomValueIndex`) → `template_params` congelados por destinatário.
  4. **Cria** o broadcast + linhas de `broadcast_recipients` (`pending`) — `createBroadcastQueued` (insere TODOS, em blocos de 200; failsafe: erro de bloco marca o broadcast `failed` e aborta). SEM o teto de 1000 do `createBroadcast` da API v1 (que é pra uma leva só).
  5. **Chuta a 1ª leva** em `after(runDrainPass(admin, broadcastId))` (não bloqueia o 202).
  6. Responde **202** `{ broadcast_id, total_recipients, rejected }`.

### 2. Cron de drenagem (novo) — `GET/POST /api/whatsapp/broadcasts/drain`
- Auth secret timing-safe: header `x-cron-secret` = `BROADCAST_DRAIN_SECRET` **ou** `x-license-secret` = `LICENSE_CONTROL_SECRET` (mesmo padrão do `reminders/run`, pra a central poder orquestrar a frota depois). `maxDuration = 300`.
- Fluxo: busca broadcasts com `status='sending'` + destinatários `pending` + sem lock ativo (ou lock stale); para cada, roda `runDrainPass` (≤1000 por passe), com **orçamento de tempo** (para de pegar novos ao esgotar; o próximo tick continua). Quando os `pending` de um broadcast zeram, `finalizeBroadcastStatus` fecha como `sent`/`failed`.
- **Auto-recuperação:** um broadcast cujo chute nunca completou (tab fechado antes/durante) tem `pending` + sem lock → o cron pega e termina. Fim do "pendente na BM".

### 3. Passe compartilhado — `runDrainPass(admin, broadcastId)`
- Reusa o engine: `claimBroadcastDelivery` (lock atômico — se outro passe roda, este pula) → `planBroadcastResume(scope:'pending')` → `deliverBroadcast` → `finalizeBroadcastStatus` → `releaseBroadcastDelivery` (finally). Best-effort, nunca lança pra fora.
- Usado pelo **chute** (dispatch) e pelo **cron**. O claim-lock garante **zero envio duplicado** entre os dois.

### 4. Wizard (alterado) — `src/hooks/use-broadcast-sending.ts`
- Vira fino: monta o payload da config e faz **1 POST** ao `/dispatch`; recebe 202 + `broadcast_id`; redireciona pra `/broadcasts/[id]`. **Deleta** o `resolveAudience` client (carga de todos os contatos), o `upsertCsvContacts`, o `fetchCustomValueIndex`, o laço de envio e a inserção de destinatários (tudo migra pro servidor). Barra de progresso 30→100 vira "Disparando…" indeterminado → redirect.
- `broadcasts/new/page.tsx` + `step4-schedule-send.tsx`: ao concluir, redireciona pra `/broadcasts/[id]`.

### 5. Tela de detalhe — `broadcasts/[id]/page.tsx`
- Hoje carrega 1× (`fetchData` no mount). Adicionar **polling leve** (ex.: a cada 4s) enquanto `status==='sending'`, pra mostrar o progresso ao vivo. Os botões **Resume/Retry** existentes ficam como rede de segurança (o cron já drena sozinho).

---

## Componentes (arquivos)

**Novos:**
- `src/lib/whatsapp/broadcast-audience.ts` — porta do hook client pro servidor: `resolveAudienceServer(supabase, accountId, audience)`, `resolveVariables` (já pura — mover/reexportar), `fetchCustomValueIndex`, `upsertCsvContacts`. Recebe o supabase de sessão.
- `src/lib/whatsapp/broadcast-queue.ts` — `createBroadcastQueued(db, accountId, auditUserId, { name, unitId, template, recipients })` (insere parent + destinatários pending em blocos, failsafe→failed; SEM teto de 1000) e `runDrainPass(admin, broadcastId)`.
- `src/app/api/whatsapp/broadcasts/dispatch/route.ts` — endpoint de disparo (sessão).
- `src/app/api/whatsapp/broadcasts/drain/route.ts` — cron de drenagem (secret).

**Alterados:**
- `src/hooks/use-broadcast-sending.ts` — fino (POST + redirect); grande parte deletada.
- `src/components/broadcasts/step4-schedule-send.tsx` + `src/app/(dashboard)/broadcasts/new/page.tsx` — redirect pra detalhe.
- `src/app/(dashboard)/broadcasts/[id]/page.tsx` — polling leve enquanto `sending`.

**Reuso (inalterado):** `broadcast-core.ts` (`deliverBroadcast`, `finalizeBroadcastStatus`), `broadcast-resume.ts` (claim/plan/mark/release), a rota de resume.

**Middleware:** confirmar que `/api/whatsapp/broadcasts/drain` está na exclusão de auth do `src/middleware.ts` (rota server-to-server autenticada por segredo próprio), como as outras rotas de cron/relay.

---

## Fluxo de dados

**Disparo:** wizard coleta {nome, template, mappings, audiência (incl. csvContacts), headerMediaUrl, selectedUnitId} → POST `/dispatch` → servidor resolve unidade+audiência+variáveis, cria broadcast+destinatários `pending`, chuta a 1ª leva em `after()`, responde 202 → wizard redireciona pra `/broadcasts/[id]` (polling).
**Drenagem:** cron → para cada broadcast `sending` com `pending` sem lock → `runDrainPass` entrega ≤1000 → sobra fica `pending` pro próximo tick → ao zerar, `finalizeBroadcastStatus` fecha.

## Erros e segurança
- **Sem envio duplicado:** claim-lock (UPDATE condicional atômico) — 1 passe por vez; chute + cron não colidem; lock stale expira em 30 min.
- **Sem órfão:** `createBroadcastQueued` marca `failed` se um bloco de destinatários falhar.
- **Tenant-safe:** leituras de audiência via client de sessão (RLS por conta); entrega via service-role (como o resume já faz).
- **Auth do cron:** timing-safe, aceita `BROADCAST_DRAIN_SECRET` ou `x-license-secret`; sem segredo válido → 401 (fail-closed).
- **Erros do dispatch:** mensagens claras (WhatsApp não configurado; audiência vazia; template malformado — reusa `resolveTemplateRow.malformed`).
- **CSV grande** vira POST maior (JSON) — ok pra tamanhos típicos; anotar o limite.

## Testes (TDD)
- `broadcast-audience.test.ts`: `resolveAudienceServer` (all/tags/custom_field/csv/excludeTags) + `resolveVariables` (static/field/custom_field) + `upsertCsvContacts` (dedup por phone_normalized, insere faltantes) — supabase mockado.
- `broadcast-queue.test.ts`: `createBroadcastQueued` (blocos, failsafe→failed) + `runDrainPass` (claim vencido→pula, plan vazio, finaliza) — mocks do engine/db.
- `dispatch/route.test.ts`: 202 + rejected; RBAC (viewer barrado); unidade resolvida.
- `drain/route.test.ts`: auth (cron/license/401); orçamento de tempo; pula travados; recupera stalled.
- Regressão: testes de `broadcast-core`/`broadcast-resume` seguem verdes (não toco no engine).

## Deploy / ops
- **Env nova (instância):** `BROADCAST_DRAIN_SECRET` (gerar valor forte).
- **Cron novo** no cron-job.org: `GET https://<instância>/api/whatsapp/broadcasts/drain` com header `x-cron-secret`, a cada ~2–5 min.
- **Sem migration** (usa `delivery_locked_at` + colunas que já existem).
- Redeploy da instância.

## Riscos / em aberto
- `createBroadcastQueued` com audiências grandes (>alguns milhares) → payload de inserts; blocos de 200 (mesmo padrão do hook atual) mitigam.
- Pré-resolução de variáveis para audiências enormes roda no request do dispatch (antes do 202) — pode ficar pesado; se virar gargalo, mover a resolução de params pra dentro do 1º passe (fora do escopo agora).
- Mudança de UX do wizard: sai a barra 30→100 client, entra 202 + polling na tela de detalhe. Garantir que a experiência fique clara ("Disparando… acompanhe em Broadcasts").
- CSV muito grande no corpo do POST — validar limite; se necessário, upload à parte (fora do escopo).
