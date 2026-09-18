# MM-1 (Marketing Messages API baseline) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rotear os disparos de template **marketing** pelo endpoint `/marketing_messages` (com `product_policy: CLOUD_API_FALLBACK`), expor o status de onboarding MM Lite no painel e contabilizar `marketing_lite` no billing — sem quebrar utility/auth nem exigir migration.

**Architecture:** Toda a decisão vive num helper puro novo (`mm-lite.ts`) consumido em um único ponto de envio (`sendTemplateMessage`). O status de onboarding é fetch on-demand via rota fina. O billing normaliza `marketing_lite → marketing` num único choke point (`aggregateConsumption`). Versão da Graph para MM Lite vem de env dedicada (`META_MM_API_VERSION`), isolando o blast radius do resto dos envios (que ficam em `v21.0`).

**Tech Stack:** Next.js 16 (App Router), TypeScript, Vitest, Supabase. Repo `wacrm`, branch `feature/usa-i-multiunidade-sp1`.

Spec: `docs/superpowers/specs/2026-09-18-mm-lite-baseline-mm1-design.md`.

---

## File Structure

- **Create** `src/lib/whatsapp/mm-lite.ts` — núcleo puro: versão MM, detecção de marketing, URL de envio marketing, fetch de status de onboarding.
- **Create** `src/lib/whatsapp/mm-lite.test.ts` — testes do núcleo.
- **Modify** `src/lib/whatsapp/meta-api.ts` — `sendTemplateMessage` roteia por categoria + `product_policy`.
- **Create** `src/lib/whatsapp/meta-api.marketing.test.ts` — testa o roteamento do envio.
- **Modify** `src/lib/whatsapp/billing.ts` — `normalizePricingCategory` + uso em `aggregateConsumption`.
- **Create/Modify** `src/lib/whatsapp/billing.test.ts` — testa a normalização e a agregação.
- **Create** `src/app/api/whatsapp/mm-lite/status/route.ts` — rota fina de status por unidade.
- **Create** `src/components/settings/mm-lite-status-badge.tsx` — badge cliente.
- **Modify** `src/components/settings/whatsapp-config.tsx` — renderiza o badge.

---

## Task 1: Núcleo MM Lite (`mm-lite.ts`)

**Files:**
- Create: `src/lib/whatsapp/mm-lite.ts`
- Test: `src/lib/whatsapp/mm-lite.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

Create `src/lib/whatsapp/mm-lite.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  isMarketingTemplate,
  marketingSendUrl,
  mmApiVersion,
  getMarketingOnboardingStatus,
} from './mm-lite';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('isMarketingTemplate', () => {
  it('true para categoria Marketing (case-insensitive)', () => {
    expect(isMarketingTemplate({ category: 'Marketing' })).toBe(true);
    expect(isMarketingTemplate({ category: 'marketing' })).toBe(true);
  });
  it('false para Utility, Authentication, ausente', () => {
    expect(isMarketingTemplate({ category: 'Utility' })).toBe(false);
    expect(isMarketingTemplate({ category: 'Authentication' })).toBe(false);
    expect(isMarketingTemplate(undefined)).toBe(false);
    expect(isMarketingTemplate(null)).toBe(false);
  });
});

describe('mmApiVersion / marketingSendUrl', () => {
  it('usa a env META_MM_API_VERSION quando definida', () => {
    vi.stubEnv('META_MM_API_VERSION', 'v25.0');
    expect(mmApiVersion()).toBe('v25.0');
    expect(marketingSendUrl('PN1')).toBe(
      'https://graph.facebook.com/v25.0/PN1/marketing_messages',
    );
  });
  it('cai no default quando a env não está setada', () => {
    vi.stubEnv('META_MM_API_VERSION', '');
    expect(mmApiVersion()).toBe('v24.0');
  });
});

describe('getMarketingOnboardingStatus', () => {
  function stubFetch(status: number, body: unknown) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
      })),
    );
  }

  it('ONBOARDED', async () => {
    stubFetch(200, { marketing_messages_onboarding_status: 'ONBOARDED', id: 'W1' });
    const r = await getMarketingOnboardingStatus('W1', 'tok');
    expect(r.status).toBe('ONBOARDED');
    expect(r.raw).toBe('ONBOARDED');
  });
  it('ELIGIBLE', async () => {
    stubFetch(200, { marketing_messages_onboarding_status: 'ELIGIBLE' });
    expect((await getMarketingOnboardingStatus('W1', 'tok')).status).toBe('ELIGIBLE');
  });
  it('valor desconhecido -> UNKNOWN', async () => {
    stubFetch(200, { marketing_messages_onboarding_status: 'SOMETHING_NEW' });
    expect((await getMarketingOnboardingStatus('W1', 'tok')).status).toBe('UNKNOWN');
  });
  it('resposta não-ok -> UNKNOWN', async () => {
    stubFetch(400, { error: { message: 'bad' } });
    expect((await getMarketingOnboardingStatus('W1', 'tok')).status).toBe('UNKNOWN');
  });
  it('fetch lança -> UNKNOWN (nunca propaga)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network'); }));
    expect((await getMarketingOnboardingStatus('W1', 'tok')).status).toBe('UNKNOWN');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib/whatsapp/mm-lite.test.ts`
Expected: FAIL — `Failed to resolve import './mm-lite'`.

- [ ] **Step 3: Implementar o mínimo**

Create `src/lib/whatsapp/mm-lite.ts`:

```ts
// ============================================================
// Marketing Messages API (MM Lite) — núcleo puro.
//
// Decide o roteamento de envio de templates de MARKETING para o endpoint
// dedicado /marketing_messages e consulta o status de onboarding do WABA.
// A versão da Graph usada AQUI é dedicada (env META_MM_API_VERSION), isolada
// do v21.0 usado no resto dos envios — blast radius mínimo.
// ============================================================

import type { MessageTemplate } from '@/types';

/** Versão da Graph só para chamadas MM Lite. Definida no deploy via env
 *  (constraint: >= v24.0, onde marketing_messages_onboarding_status existe). */
export function mmApiVersion(): string {
  return process.env.META_MM_API_VERSION || 'v24.0';
}

/** true quando o template é da categoria marketing (case-insensitive). Row
 *  ausente => false (cai no /messages clássico). */
export function isMarketingTemplate(
  template?: Pick<MessageTemplate, 'category'> | null,
): boolean {
  return (template?.category ?? '').toLowerCase() === 'marketing';
}

/** URL do endpoint dedicado de marketing para um phone_number_id. */
export function marketingSendUrl(phoneNumberId: string): string {
  return `https://graph.facebook.com/${mmApiVersion()}/${phoneNumberId}/marketing_messages`;
}

export type MmOnboardingStatus = 'ONBOARDED' | 'ELIGIBLE' | 'UNKNOWN';

/** Consulta o status de onboarding MM Lite do WABA. Best-effort: qualquer
 *  falha vira UNKNOWN, nunca lança. */
export async function getMarketingOnboardingStatus(
  wabaId: string,
  accessToken: string,
): Promise<{ status: MmOnboardingStatus; raw: string | null }> {
  try {
    const url = `https://graph.facebook.com/${mmApiVersion()}/${wabaId}?fields=marketing_messages_onboarding_status`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return { status: 'UNKNOWN', raw: null };
    const data = (await res.json()) as {
      marketing_messages_onboarding_status?: string | null;
    };
    const raw = data?.marketing_messages_onboarding_status ?? null;
    const status: MmOnboardingStatus =
      raw === 'ONBOARDED' ? 'ONBOARDED' : raw === 'ELIGIBLE' ? 'ELIGIBLE' : 'UNKNOWN';
    return { status, raw };
  } catch {
    return { status: 'UNKNOWN', raw: null };
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/lib/whatsapp/mm-lite.test.ts`
Expected: PASS (todos os testes).

- [ ] **Step 5: Commit**

```bash
git add src/lib/whatsapp/mm-lite.ts src/lib/whatsapp/mm-lite.test.ts
git commit -m "feat(mm-1): núcleo MM Lite (roteamento marketing + status de onboarding)"
```

---

## Task 2: Roteamento no envio (`sendTemplateMessage`)

**Files:**
- Modify: `src/lib/whatsapp/meta-api.ts` (função `sendTemplateMessage`, ~linhas 469–537)
- Test: `src/lib/whatsapp/meta-api.marketing.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

Create `src/lib/whatsapp/meta-api.marketing.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';

// Isola o roteamento: o builder de components não é o alvo aqui.
vi.mock('@/lib/whatsapp/template-send-builder', () => ({
  buildSendComponents: () => [],
}));

import { sendTemplateMessage } from './meta-api';
import type { MessageTemplate } from '@/types';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function stubFetchCapture() {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: { body: string }) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return { ok: true, status: 200, json: async () => ({ messages: [{ id: 'M1' }] }) };
    }),
  );
  return calls;
}

const marketingTemplate = { category: 'Marketing' } as MessageTemplate;
const utilityTemplate = { category: 'Utility' } as MessageTemplate;

describe('sendTemplateMessage — roteamento MM Lite', () => {
  it('template MARKETING vai para /marketing_messages com product_policy', async () => {
    vi.stubEnv('META_MM_API_VERSION', 'v24.0');
    const calls = stubFetchCapture();
    await sendTemplateMessage({
      phoneNumberId: 'PN1',
      accessToken: 'tok',
      to: '15550001',
      templateName: 'promo',
      template: marketingTemplate,
    });
    expect(calls[0].url).toBe('https://graph.facebook.com/v24.0/PN1/marketing_messages');
    expect(calls[0].body.product_policy).toBe('CLOUD_API_FALLBACK');
    expect(calls[0].body.type).toBe('template');
  });

  it('template UTILITY continua no /messages, sem product_policy', async () => {
    const calls = stubFetchCapture();
    await sendTemplateMessage({
      phoneNumberId: 'PN1',
      accessToken: 'tok',
      to: '15550001',
      templateName: 'recibo',
      template: utilityTemplate,
    });
    expect(calls[0].url).toContain('/PN1/messages');
    expect(calls[0].url).not.toContain('marketing_messages');
    expect(calls[0].body.product_policy).toBeUndefined();
  });

  it('sem template row (legacy) continua no /messages', async () => {
    const calls = stubFetchCapture();
    await sendTemplateMessage({
      phoneNumberId: 'PN1',
      accessToken: 'tok',
      to: '15550001',
      templateName: 'promo',
      params: ['x'],
    });
    expect(calls[0].url).toContain('/PN1/messages');
    expect(calls[0].body.product_policy).toBeUndefined();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib/whatsapp/meta-api.marketing.test.ts`
Expected: FAIL — o marketing template ainda bate em `/messages` e `product_policy` é `undefined`.

- [ ] **Step 3: Implementar o roteamento**

Em `src/lib/whatsapp/meta-api.ts`, adicionar o import (logo abaixo dos imports existentes no topo do arquivo):

```ts
import { isMarketingTemplate, marketingSendUrl } from './mm-lite'
```

Em `sendTemplateMessage`, trocar a linha da URL (atual `const url = \`${META_API_BASE}/${phoneNumberId}/messages\``) por:

```ts
  const marketing = isMarketingTemplate(template)
  const url = marketing
    ? marketingSendUrl(phoneNumberId)
    : `${META_API_BASE}/${phoneNumberId}/messages`
```

E logo após montar `const body: Record<string, unknown> = { ... }` (antes do `if (contextMessageId)`), adicionar:

```ts
  if (marketing) {
    // MM Lite: cai automaticamente no Cloud API se o número ainda não
    // concluiu o onboarding (aceite da ToS) — envio nunca falha por isso.
    body.product_policy = 'CLOUD_API_FALLBACK'
  }
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/lib/whatsapp/meta-api.marketing.test.ts`
Expected: PASS (3 testes).

- [ ] **Step 5: Rodar a suíte de envio existente (regressão)**

Run: `npx vitest run src/lib/whatsapp/`
Expected: PASS — nenhum teste de texto/mídia/interativo/broadcast quebra.

- [ ] **Step 6: Commit**

```bash
git add src/lib/whatsapp/meta-api.ts src/lib/whatsapp/meta-api.marketing.test.ts
git commit -m "feat(mm-1): roteia templates de marketing pro /marketing_messages"
```

---

## Task 3: Billing reconhece `marketing_lite`

**Files:**
- Modify: `src/lib/whatsapp/billing.ts` (novo `normalizePricingCategory`; uso em `aggregateConsumption`, ~linha 64)
- Test: `src/lib/whatsapp/billing.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

Create (ou append, se já existir) `src/lib/whatsapp/billing.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  normalizePricingCategory,
  aggregateConsumption,
  type ConsumptionRow,
  type Rate,
} from './billing';

describe('normalizePricingCategory', () => {
  it('marketing_lite -> marketing', () => {
    expect(normalizePricingCategory('marketing_lite')).toBe('marketing');
  });
  it('marketing/utility passam direto', () => {
    expect(normalizePricingCategory('marketing')).toBe('marketing');
    expect(normalizePricingCategory('utility')).toBe('utility');
  });
  it('null/undefined -> unknown', () => {
    expect(normalizePricingCategory(null)).toBe('unknown');
    expect(normalizePricingCategory(undefined)).toBe('unknown');
  });
});

describe('aggregateConsumption com marketing_lite', () => {
  it('conta marketing_lite sob a tarifa de marketing', () => {
    const rows: ConsumptionRow[] = [
      { unitId: 'u1', category: 'marketing_lite', billable: true },
      { unitId: 'u1', category: 'marketing', billable: true },
    ];
    const rates: Rate[] = [{ category: 'marketing', price: 0.35 }];
    const out = aggregateConsumption(rows, rates);
    const u1 = out.find((u) => u.unitId === 'u1')!;
    const marketing = u1.byCategory.find((c) => c.category === 'marketing')!;
    // As duas mensagens caem em 'marketing' e são cobradas à tarifa.
    expect(marketing.total).toBe(2);
    expect(marketing.billable).toBe(2);
    expect(u1.estimatedCost).toBeCloseTo(0.7, 5);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib/whatsapp/billing.test.ts`
Expected: FAIL — `normalizePricingCategory` não existe; e a agregação hoje separa `marketing_lite` (custo 0).

- [ ] **Step 3: Implementar a normalização**

Em `src/lib/whatsapp/billing.ts`, adicionar a função exportada (logo após `BILLABLE_CATEGORIES`):

```ts
/**
 * Normaliza a categoria de pricing vinda do webhook antes de agregar.
 * O MM Lite reporta 'marketing_lite' (SKU MARKETING_LITE) — é marketing
 * para efeito de tarifa/cobrança. Guardamos o valor cru em messages
 * (auditoria); a normalização é só aqui, na agregação.
 */
export function normalizePricingCategory(
  category: string | null | undefined,
): string {
  if (!category) return 'unknown';
  return category.toLowerCase() === 'marketing_lite' ? 'marketing' : category;
}
```

E em `aggregateConsumption`, trocar a linha:

```ts
    const category = row.category ?? 'unknown';
```

por:

```ts
    const category = normalizePricingCategory(row.category);
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/lib/whatsapp/billing.test.ts src/lib/whatsapp/fleet-summary.test.ts`
Expected: PASS — inclui a regressão do fleet-summary (que usa `aggregateConsumption` por baixo).

- [ ] **Step 5: Commit**

```bash
git add src/lib/whatsapp/billing.ts src/lib/whatsapp/billing.test.ts
git commit -m "feat(mm-1): contabiliza marketing_lite como marketing no billing"
```

---

## Task 4: Rota de status de onboarding

**Files:**
- Create: `src/app/api/whatsapp/mm-lite/status/route.ts`

> A lógica de fetch/parse já é testada em `mm-lite.test.ts` (Task 1). Esta rota é
> só cola fina (auth + config por unidade + chamada do helper); é validada por
> `tsc`/`build` (Task 6) e por smoke manual.

- [ ] **Step 1: Criar a rota**

Create `src/app/api/whatsapp/mm-lite/status/route.ts`:

```ts
// ============================================================
// GET /api/whatsapp/mm-lite/status[?unit=<unitId>]
//
// Status de onboarding do Marketing Messages API (MM Lite) para o número
// (WABA) de uma unidade. Somente leitura (viewer). Best-effort: erro -> UNKNOWN.
// Não escreve nada; sem migration.
// ============================================================

import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { resolveOperatorUnitId } from '@/lib/units/operator-unit'
import { decrypt } from '@/lib/whatsapp/encryption'
import { getMarketingOnboardingStatus } from '@/lib/whatsapp/mm-lite'

export async function GET(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('viewer')

    const unitParam = new URL(request.url).searchParams.get('unit')
    const unitId =
      unitParam || (await resolveOperatorUnitId(supabase, accountId, userId))

    const { data: config } = await supabase
      .from('whatsapp_config')
      .select('waba_id, access_token')
      .eq('account_id', accountId)
      .eq('unit_id', unitId)
      .limit(1)
      .single()

    if (!config?.waba_id || !config?.access_token) {
      return NextResponse.json({ status: 'UNKNOWN', configured: false, unitId })
    }

    const { status, raw } = await getMarketingOnboardingStatus(
      config.waba_id as string,
      decrypt(config.access_token as string),
    )
    return NextResponse.json({ status, raw, configured: true, unitId })
  } catch (err) {
    return toErrorResponse(err)
  }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: sem erros (confirma que `requireRole`, `toErrorResponse`, `resolveOperatorUnitId`, `decrypt` batem com as assinaturas reais).

- [ ] **Step 3: Commit**

```bash
git add src/app/api/whatsapp/mm-lite/status/route.ts
git commit -m "feat(mm-1): rota de status de onboarding MM Lite por unidade"
```

---

## Task 5: Badge de status no painel de WhatsApp

**Files:**
- Create: `src/components/settings/mm-lite-status-badge.tsx`
- Modify: `src/components/settings/whatsapp-config.tsx`

- [ ] **Step 1: Criar o componente do badge**

Create `src/components/settings/mm-lite-status-badge.tsx`:

```tsx
'use client'

import { useEffect, useState } from 'react'

type Status = 'ONBOARDED' | 'ELIGIBLE' | 'UNKNOWN'

/**
 * Badge informativo do status MM Lite do número da unidade atual. NÃO bloqueia
 * nada — só orienta o cliente a aceitar a ToS no WhatsApp Manager para destravar
 * a otimização de entrega. Best-effort: falha some silenciosamente.
 */
export function MmLiteStatusBadge() {
  const [status, setStatus] = useState<Status | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/whatsapp/mm-lite/status')
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setStatus((d?.status as Status) ?? 'UNKNOWN')
      })
      .catch(() => {
        if (!cancelled) setStatus('UNKNOWN')
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (status === null) return null

  if (status === 'ONBOARDED') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-green-500/30 bg-green-500/10 px-2.5 py-1 text-xs font-medium text-green-500">
        MM Lite: Ativo
      </span>
    )
  }

  if (status === 'ELIGIBLE') {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-full border border-yellow-500/30 bg-yellow-500/10 px-2.5 py-1 text-xs font-medium text-yellow-500"
        title="Aceite os termos do Marketing Messages no WhatsApp Manager (Overview → Alerts → Accept terms) para ativar a entrega otimizada dos disparos."
      >
        MM Lite: aceite a ToS no WhatsApp Manager
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
      MM Lite: indisponível
    </span>
  )
}
```

- [ ] **Step 2: Encontrar o ponto de inserção no painel**

Run: `grep -n "text-2xl\|font-heading\|h1\|h2\|WhatsApp" src/components/settings/whatsapp-config.tsx | head`
Objetivo: achar o bloco do título/cabeçalho da seção de configuração do WhatsApp. Anotar a linha do heading principal.

- [ ] **Step 3: Renderizar o badge**

Em `src/components/settings/whatsapp-config.tsx`:

1. Adicionar o import no topo (junto aos outros imports de componentes):

```tsx
import { MmLiteStatusBadge } from '@/components/settings/mm-lite-status-badge'
```

2. Logo após o bloco de título/descrição do cabeçalho da seção (a linha achada no Step 2), renderizar:

```tsx
<div className="mt-2">
  <MmLiteStatusBadge />
</div>
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/mm-lite-status-badge.tsx src/components/settings/whatsapp-config.tsx
git commit -m "feat(mm-1): badge de status MM Lite no painel de WhatsApp"
```

---

## Task 6: Validação final + documentação da env

**Files:**
- Modify: `.env.example` (se existir no repo)

- [ ] **Step 1: Documentar a env nova**

Run: `ls .env.example 2>/dev/null && grep -n "META_" .env.example | head`
Se `.env.example` existir, adicionar a linha (senão, pular este step e anotar no handoff):

```
# Versão da Graph API usada SÓ nas chamadas MM Lite (marketing_messages + status).
# Constraint: >= v24.0 (onde marketing_messages_onboarding_status existe). Default no código: v24.0.
META_MM_API_VERSION=v24.0
```

- [ ] **Step 2: Suíte completa de testes**

Run: `npx vitest run`
Expected: PASS (exceto as 5 falhas PRÉ-EXISTENTES conhecidas em `currency.test.ts` e `dashboard/date-utils.test.ts` — locale/ICU no Windows, não relacionadas). Todos os testes novos e os de `whatsapp/*` verdes.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 4: Build de produção**

Run: `npx next build`
Expected: build conclui sem erros.

- [ ] **Step 5: Commit final (se .env.example mudou)**

```bash
git add .env.example
git commit -m "docs(mm-1): documenta META_MM_API_VERSION no .env.example"
```

---

## Notas de deploy (fora do plano de código)

- **Env nova na instância (EasyPanel):** `META_MM_API_VERSION` (confirmar a versão GA atual da Graph no momento do deploy; constraint ≥ v24.0).
- **Sem migration.**
- **Ação do cliente:** aceitar a ToS do Marketing Messages no WhatsApp Manager por número (o badge indica quando está pendente). Enquanto não aceita, os disparos de marketing continuam saindo via fallback (Cloud API), só sem a otimização.
- Smoke manual pós-deploy: abrir Configurações → WhatsApp e ver o badge; disparar 1 template de marketing para um número de teste e confirmar entrega.
