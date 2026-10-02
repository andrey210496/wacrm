# MM-1 — Adoção baseline do Marketing Messages API (MM Lite)

**Data:** 2026-09-18
**Repo:** wacrm (instância RedeZap) · branch `feature/usa-i-multiunidade-sp1`
**Frente:** MM-1 (primeira das três: MM-1 baseline → depois Onda 3 → depois MM-2 rastreio/métricas)

## Contexto e objetivo

Hoje **todos** os templates saem pelo endpoint clássico `POST /{phone_number_id}/messages`
(`src/lib/whatsapp/meta-api.ts:483`, versão `v21.0` fixa em `meta-api.ts:12`). O
Marketing Messages API ("MM Lite", GA em 19/11/2025) usa um endpoint dedicado
`POST /{phone_number_id}/marketing_messages` que, **só por trocar o endpoint**,
dá ganho de entrega (a doc cita até 9% mais entregas) e **proteção da qualidade
do número** — o que importa direto para o produto, cujo core é disparo em massa.

O `/messages` clássico **não** está deprecado para marketing (verificado na doc),
então isto é uma **adoção opt-in, aditiva e de baixo risco**, não uma migração
forçada.

### Fatos oficiais da Meta que embasam o desenho (verificados na doc)

- Endpoint: `POST /<versão>/<phone_number_id>/marketing_messages`.
- Corpo **idêntico** ao envio clássico de template (`messaging_product`,
  `recipient_type`, `to`, `type:"template"`, `template:{name,language,components}`)
  **+ opcionais** `product_policy` (`"CLOUD_API_FALLBACK"` default / `"STRICT"`) e
  `message_activity_sharing`.
- `product_policy: "CLOUD_API_FALLBACK"` → se o número ainda não concluiu o
  onboarding, a Meta **cai automaticamente no Cloud API** (entrega garantida).
- Só aceita templates **de marketing**; "supports all marketing templates"
  (templates aprovados existentes funcionam como estão — sem recriar).
- Onboarding de integração **direta** (nosso caso, via Embedded Signup): o admin
  do cliente **aceita a ToS no WhatsApp Manager** (UI). Status por WABA via
  `GET /<waba_id>?fields=marketing_messages_onboarding_status` → `ELIGIBLE` /
  `ONBOARDED`. Conclusão também dispara webhook `account_update`.
- No webhook de status, a categoria de pricing passa a vir `"marketing_lite"`
  (SKU `MARKETING_LITE`) em vez de `"marketing"`.
- Versão da Graph: o campo de status entrou em v24.0 (o antigo foi deprecado em
  v24.0); exemplos da doc usam v25.0. Ou seja, MM Lite exige versão **≥ v24.0**.

Fontes: developers.facebook.com/documentation/business-messaging/whatsapp/marketing-messages/
(overview, get-started, onboarding, sending-messages, send-marketing-messages,
features, pricing, changelog) — lidas em 2026-09-18.

## Decisões de desenho (aprovadas)

1. **Gate de onboarding = sempre com fallback.** Marketing sempre roteia para
   `/marketing_messages` com `product_policy: "CLOUD_API_FALLBACK"`. Não checamos
   status antes de enviar — o fallback da Meta garante entrega mesmo pré-ToS. O
   status aparece no painel apenas como **incentivo** para o cliente aceitar a
   ToS e destravar a otimização. (Mais simples e robusto; sem chamada extra por
   envio.)
2. **Versão da Graph = env dedicada.** Nova env `META_MM_API_VERSION` usada
   **apenas** nas chamadas `marketing_messages` + status; texto/mídia/interativo/
   template-utility continuam em `v21.0`. Blast radius mínimo (não revalida todos
   os envios). Valor definido no deploy (constraint: **≥ v24.0**; doc usa v25.0).

## Escopo

### Dentro do MM-1
- Roteamento por categoria dentro de `sendTemplateMessage`.
- Envio de `product_policy: "CLOUD_API_FALLBACK"` nos disparos de marketing.
- Helper + rota de status de onboarding e badge no painel de WhatsApp.
- Billing: reconhecer `marketing_lite` / `MARKETING_LITE` como marketing cobrável.

### Fora do MM-1 (frentes seguintes)
- Onda 3 (orquestração server-side do envio de broadcast) — já desenhada.
- MM-2: rastreio de clique (`click_id` no webhook `marketing_messages_link_click`),
  métricas `conversation_analytics(MARKETING_MESSAGES)`.
- MM-3: lances (`optimization_spec`, beta), TTL, GIF header, deep links,
  atribuição/Pixel-CAPI (públicos lookalike/exclusão — lado de Ads do cliente).
- `message_activity_sharing` (deixado no default da WABA por ora — YAGNI).

## Componentes

### Novos
- `src/lib/whatsapp/mm-lite.ts`
  - `MM_API_VERSION` — lê `process.env.META_MM_API_VERSION` (default documentado
    ≥ v24.0).
  - `isMarketingTemplate(template)` — `true` quando
    `template?.category?.toLowerCase() === 'marketing'` (case-insensitive; row
    ausente → `false`).
  - `marketingSendUrl(phoneNumberId)` / manutenção da URL clássica — helper para
    montar o endpoint certo.
  - `getMarketingOnboardingStatus(wabaId, accessToken)` — `GET
    /{MM_API_VERSION}/{wabaId}?fields=marketing_messages_onboarding_status`;
    devolve `{ status: 'ONBOARDED' | 'ELIGIBLE' | 'UNKNOWN', raw }`; nunca lança
    (erro → `UNKNOWN`).
- `src/app/api/whatsapp/mm-lite/status/route.ts`
  - GET, `requireRole('viewer')` (leitura), resolve a unidade (query/​topbar),
    lê `whatsapp_config` (waba_id + token descriptografado) e retorna o status.
    Sem escrever nada; sem migration.

### Alterados
- `src/lib/whatsapp/meta-api.ts` — em `sendTemplateMessage` (linhas ~483–519):
  - URL condicional: marketing → `${MM_API_BASE}/${phoneNumberId}/marketing_messages`;
    caso contrário mantém `${META_API_BASE}/${phoneNumberId}/messages`.
  - Quando marketing, adicionar `body.product_policy = 'CLOUD_API_FALLBACK'`.
  - Corpo/`components` inalterados (mesmo `buildSendComponents`).
  - Legacy path (sem `template` row) → sempre `/messages` (não há categoria).
- `src/lib/whatsapp/process-webhook.ts` (~linha 338) — ao gravar
  `pricing_category`, normalizar `"marketing_lite"` para ser contabilizado como
  marketing (guardar o valor cru para auditoria, mas o agregador trata como
  marketing cobrável).
- `src/lib/whatsapp/billing.ts` e `src/app/api/whatsapp/billing/fleet-summary/route.ts`
  — onde a agregação decide "cobrável/marketing", incluir `marketing_lite`.
- Painel de Configurações → WhatsApp (componente `whatsapp-config.tsx`) — badge de
  status MM Lite por número: **Ativo** (ONBOARDED) / **Elegível — aceite a ToS no
  WhatsApp Manager** (ELIGIBLE, com passo a passo curto) / **Indisponível**
  (UNKNOWN). Busca via a rota de status nova. Não bloqueia nada.

## Fluxo de dados

**Envio (marketing):** caller (broadcast/automation/flow/inbox) → `sendTemplateMessage`
com a `template` row → detecta `category === 'Marketing'` → monta URL
`/marketing_messages` (versão MM) + `product_policy: CLOUD_API_FALLBACK` → POST à
Meta. Se o número não estiver onboarded, a Meta entrega via Cloud API (fallback).
Utility/auth seguem exatamente como hoje.

**Status no painel:** painel → `GET /api/whatsapp/mm-lite/status?unit=…` → servidor
lê config da unidade → `GET WABA?fields=marketing_messages_onboarding_status` →
badge.

**Billing:** webhook de status da Meta traz `pricing.category = "marketing_lite"`
→ `process-webhook` grava → agregador de Consumo (instância → central) conta como
marketing.

## Erros e segurança
- **Envio nunca regride:** só a URL e um campo opcional mudam para marketing; o
  fallback da Meta cobre número não-onboarded. Utility/auth intocados.
- **Status é best-effort:** falha na consulta → `UNKNOWN` (badge neutro), nunca
  derruba o painel nem o envio.
- **Tenant-safe:** rota de status é `requireRole` + escopo por unidade; token
  descriptografado só no servidor (nunca no cliente).
- **Billing:** manter o valor cru de `pricing_category` para auditoria; a
  normalização é só na camada de agregação (não perde informação).

## Testes (TDD)
- `mm-lite.test.ts`: `isMarketingTemplate` (Marketing/Utility/Authentication/row
  ausente, case-insensitive); `getMarketingOnboardingStatus` (ONBOARDED/ELIGIBLE/
  erro→UNKNOWN) com fetch mockado; `MM_API_VERSION` lê env.
- `meta-api` roteamento: Marketing → URL `/marketing_messages` + `product_policy`;
  Utility/Auth/legacy → `/messages` sem `product_policy`; corpo idêntico nos dois.
- `process-webhook`: `pricing.category='marketing_lite'` é contabilizado como
  marketing no agregador.
- Regressão: envios de texto/mídia/interativo e templates utility inalterados.

## Deploy / ops
- **Env nova (instância):** `META_MM_API_VERSION` (ex.: valor ≥ v24.0 definido no
  deploy).
- **Sem migration** (status é fetch on-demand; `pricing_category` já existe).
- **Ação do cliente:** aceitar a ToS do Marketing Messages no WhatsApp Manager
  (por número) — o painel mostra quando está pendente. Enquanto não aceita, os
  disparos continuam saindo (fallback), só sem a otimização.
- Redeploy da instância; central sem mudança (a menos que se decida exibir o
  status MM Lite no painel /numeros — fora do MM-1).

## Riscos / itens em aberto
- Confirmar no deploy a versão GA atual da Graph para `META_MM_API_VERSION`
  (constraint ≥ v24.0).
- Confirmar o nome exato da categoria no webhook (`marketing_lite`) no primeiro
  envio real e ajustar o normalizador se a Meta enviar variação.
- `whatsapp-config.tsx` é grande; adicionar só o badge (não refatorar em MM-1).
