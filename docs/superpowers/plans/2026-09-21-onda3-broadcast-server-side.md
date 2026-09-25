# Onda 3 — Broadcast server-side (fila durável) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mover o envio inicial de broadcast do navegador para o servidor: endpoint `/dispatch` resolve audiência+variáveis+CSV, cria o broadcast + destinatários e chuta a 1ª leva; cron `/drain` drena o resto (≤1000/passe) e auto-recupera campanhas travadas.

**Architecture:** Reusa o motor testado (`deliverBroadcast` + `broadcast-resume` claim-lock/plan/finalize). Código novo: um módulo de audiência server-side (porta do hook client), um módulo de fila (`createBroadcastQueued` + `runDrainPass`), o endpoint de disparo (sessão) e o cron de drenagem (secret). O wizard vira fino (POST + redirect).

**Tech Stack:** Next.js 16 (App Router, `src/middleware.ts`), TypeScript, Supabase, Vitest.

Spec: `docs/superpowers/specs/2026-09-21-onda3-broadcast-server-side-design.md`.

**Convenções:** testes mockam supabase com objetos chain (ver `broadcast-core.test.ts`); `npx vitest run <arquivo>`; `npx tsc --noEmit`; `npx next build`. Engine (NÃO alterar): `broadcast-core.ts` (`deliverBroadcast(db, plan)`, `finalizeBroadcastStatus(db, id)`), `broadcast-resume.ts` (`claimBroadcastDelivery(db, accountId, id)`, `releaseBroadcastDelivery(db, id)`, `markBroadcastSending(db, id)`, `planBroadcastResume(db, accountId, id, scope)→{plan, remaining, unsendable}`). Service-role: `supabaseAdmin()` de `@/lib/flows/admin-client`. Auth sessão: `requireRole('agent')` de `@/lib/auth/account` → `{ supabase, accountId, userId }`.

---

## File Structure

**Novos:**
- `src/lib/whatsapp/broadcast-audience.ts` (+ test) — `resolveVariables`, `fetchCustomValueIndex`, `upsertCsvContacts`, `resolveAudienceServer` (porta do hook client, recebendo supabase/accountId/userId).
- `src/lib/whatsapp/broadcast-queue.ts` (+ test) — `createBroadcastQueued` (cria parent + destinatários pending, sem teto de 1000, failsafe→failed) e `runDrainPass` (claim→plan pending→deliver→finalize→release).
- `src/app/api/whatsapp/broadcasts/dispatch/route.ts` (+ test) — endpoint de disparo (sessão).
- `src/app/api/whatsapp/broadcasts/drain/route.ts` (+ test) — cron de drenagem (secret dual).

**Alterados:**
- `src/hooks/use-broadcast-sending.ts` — fino (POST /dispatch + redirect).
- `src/components/broadcasts/step4-schedule-send.tsx` + `src/app/(dashboard)/broadcasts/new/page.tsx` — redirect pra `/broadcasts/[id]`.
- `src/app/(dashboard)/broadcasts/[id]/page.tsx` — polling leve enquanto `sending`.
- `src/middleware.ts` — excluir `/api/whatsapp/broadcasts/drain` da auth de sessão.
- `.env.local.example` — `BROADCAST_DRAIN_SECRET`.

---

## Task 1: Módulo de audiência server-side

**Files:** Create `src/lib/whatsapp/broadcast-audience.ts` (+ `.test.ts`)

- [ ] **Step 1: Ler as funções originais no hook**

Run: `grep -n "function resolveVariables\|function fetchCustomValueIndex\|function upsertCsvContacts\|function resolveAudience\|function resolveCustomFieldAudience\|AudienceConfig\|VariableMapping\|CustomFieldFilter\|normalizeKey" src/hooks/use-broadcast-sending.ts`
Leia essas funções (são a fonte da porta). Elas usam `accountId`/`user` de closures — na porta viram PARÂMETROS.

- [ ] **Step 2: Escrever o teste**

Create `src/lib/whatsapp/broadcast-audience.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import {
  resolveVariables,
  resolveAudienceServer,
  type AudienceConfig,
} from './broadcast-audience';
import type { Contact } from '@/types';

const contact = { id: 'c1', name: 'Jane', phone: '+15550001', email: 'j@x.com', company: 'Acme' } as Contact;

describe('resolveVariables', () => {
  it('static/field/custom_field na ordem numérica', () => {
    const out = resolveVariables(
      { '1': { type: 'field', value: 'name' }, '2': { type: 'static', value: 'X' }, '3': { type: 'custom_field', value: 'cf1' } },
      contact,
      new Map([['cf1', 'V']]),
    );
    expect(out).toEqual(['Jane', 'X', 'V']);
  });
  it('custom_field ausente vira string vazia', () => {
    expect(resolveVariables({ '1': { type: 'custom_field', value: 'z' } }, contact)).toEqual(['']);
  });
});

// supabase chain mock: .from('contacts').select('*') resolve `all`
function db(rows: Record<string, unknown[]>) {
  return {
    from(table: string) {
      const result = rows[table] ?? [];
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        in: () => Promise.resolve({ data: result, error: null }),
        // termina em await direto (audience 'all' faz select().then)
        then: (r: (v: { data: unknown[]; error: null }) => unknown) => r({ data: result, error: null }),
      };
      return chain;
    },
  } as never;
}

describe('resolveAudienceServer', () => {
  it('type all retorna todos os contatos', async () => {
    const contacts = await resolveAudienceServer(
      db({ contacts: [{ id: 'a' }, { id: 'b' }] }),
      'acc',
      'user',
      { type: 'all' } as AudienceConfig,
    );
    expect(contacts.map((c) => c.id)).toEqual(['a', 'b']);
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npx vitest run src/lib/whatsapp/broadcast-audience.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 4: Implementar (porta do hook)**

Create `src/lib/whatsapp/broadcast-audience.ts` copiando as funções do hook (`use-broadcast-sending.ts`), trocando as closures por parâmetros. Estrutura obrigatória:

```ts
// ============================================================
// Resolução de audiência + variáveis de broadcast, server-side.
// Porta das funções que viviam no hook client (use-broadcast-sending.ts),
// recebendo o supabase de sessão + accountId + userId como parâmetros.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeKey } from '@/lib/contacts/dedupe';
import type { Contact } from '@/types';

export type CustomFieldOperator = 'is' | 'is_not' | 'contains';
export interface CustomFieldFilter { fieldId: string; operator: CustomFieldOperator; value: string }
export interface AudienceConfig {
  type: 'all' | 'tags' | 'custom_field' | 'csv';
  tagIds?: string[];
  customField?: CustomFieldFilter;
  csvContacts?: { phone: string; name?: string }[];
  excludeTagIds?: string[];
}
export type VariableMapping =
  | { type: 'static'; value: string }
  | { type: 'field'; value: string }
  | { type: 'custom_field'; value: string };

type CustomValueIndex = Map<string, Map<string, string>>;

export function resolveVariables(
  variables: Record<string, VariableMapping>,
  contact: Contact,
  customValues?: Map<string, string>,
): string[] {
  const keys = Object.keys(variables).sort((a, b) => {
    const an = Number(a), bn = Number(b);
    if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
    return a.localeCompare(b);
  });
  return keys.map((key) => {
    const v = variables[key];
    if (v.type === 'static') return v.value;
    if (v.type === 'field') {
      const fieldMap: Record<string, string | undefined> = {
        name: contact.name, phone: contact.phone, email: contact.email, company: contact.company,
      };
      return fieldMap[v.value] ?? '';
    }
    return customValues?.get(v.value) ?? '';
  });
}

export async function fetchCustomValueIndex(
  supabase: SupabaseClient,
  contactIds: string[],
): Promise<CustomValueIndex> {
  const index: CustomValueIndex = new Map();
  if (contactIds.length === 0) return index;
  const PAGE = 500;
  for (let i = 0; i < contactIds.length; i += PAGE) {
    const slice = contactIds.slice(i, i + PAGE);
    const { data } = await supabase
      .from('contact_custom_values')
      .select('contact_id, custom_field_id, value')
      .in('contact_id', slice);
    for (const row of data ?? []) {
      const bucket = index.get(row.contact_id) ?? new Map<string, string>();
      bucket.set(row.custom_field_id, row.value ?? '');
      index.set(row.contact_id, bucket);
    }
  }
  return index;
}

export async function upsertCsvContacts(
  supabase: SupabaseClient,
  accountId: string,
  userId: string,
  csvRows: { phone: string; name?: string }[],
): Promise<Contact[]> {
  if (csvRows.length === 0) return [];
  const uniqueByKey = new Map<string, { phone: string; name?: string }>();
  for (const row of csvRows) {
    const key = normalizeKey(row.phone);
    if (key && !uniqueByKey.has(key)) uniqueByKey.set(key, row);
  }
  const keys = [...uniqueByKey.keys()];
  const { data: existing, error: lookupErr } = await supabase
    .from('contacts').select('*').eq('account_id', accountId).in('phone_normalized', keys);
  if (lookupErr) throw new Error(`Failed to look up CSV contacts: ${lookupErr.message}`);
  const byKey = new Map<string, Contact>();
  for (const c of (existing ?? []) as Contact[]) {
    const key = normalizeKey(c.phone ?? '');
    if (key) byKey.set(key, c);
  }
  const missing = keys.filter((k) => !byKey.has(k)).map((k) => uniqueByKey.get(k)!)
    .map((row) => ({ user_id: userId, account_id: accountId, phone: row.phone, name: row.name ?? null }));
  const INSERT_CHUNK = 200;
  for (let i = 0; i < missing.length; i += INSERT_CHUNK) {
    const chunk = missing.slice(i, i + INSERT_CHUNK);
    const { data: inserted, error: insertErr } = await supabase.from('contacts').insert(chunk).select();
    if (insertErr) throw new Error(`Failed to create CSV contacts: ${insertErr.message}`);
    for (const c of (inserted ?? []) as Contact[]) {
      const key = normalizeKey(c.phone ?? '');
      if (key) byKey.set(key, c);
    }
  }
  return keys.map((k) => byKey.get(k)).filter((c): c is Contact => Boolean(c));
}

async function resolveCustomFieldAudience(
  supabase: SupabaseClient, filter: CustomFieldFilter,
): Promise<Contact[]> {
  const { fieldId, operator, value } = filter;
  let query = supabase.from('contact_custom_values').select('contact_id').eq('custom_field_id', fieldId);
  if (operator === 'is') query = query.eq('value', value);
  else if (operator === 'is_not') query = query.neq('value', value);
  else if (operator === 'contains') query = query.ilike('value', `%${value}%`);
  const { data: matches, error: matchErr } = await query;
  if (matchErr) throw new Error(`Custom-field filter failed: ${matchErr.message}`);
  const contactIds = [...new Set((matches ?? []).map((m) => m.contact_id))];
  if (contactIds.length === 0) return [];
  const { data, error } = await supabase.from('contacts').select('*').in('id', contactIds);
  if (error) throw new Error(`Failed to fetch contacts: ${error.message}`);
  return (data ?? []) as Contact[];
}

export async function resolveAudienceServer(
  supabase: SupabaseClient,
  accountId: string,
  userId: string,
  audience: AudienceConfig,
): Promise<Contact[]> {
  let contacts: Contact[] = [];
  if (audience.type === 'all') {
    const { data, error } = await supabase.from('contacts').select('*');
    if (error) throw new Error(`Failed to fetch contacts: ${error.message}`);
    contacts = (data ?? []) as Contact[];
  } else if (audience.type === 'tags' && audience.tagIds && audience.tagIds.length > 0) {
    const { data: contactTags, error: tagError } = await supabase
      .from('contact_tags').select('contact_id').in('tag_id', audience.tagIds);
    if (tagError) throw new Error(`Failed to fetch contact tags: ${tagError.message}`);
    if (contactTags && contactTags.length > 0) {
      const ids = [...new Set(contactTags.map((ct) => ct.contact_id))];
      const { data, error } = await supabase.from('contacts').select('*').in('id', ids);
      if (error) throw new Error(`Failed to fetch contacts: ${error.message}`);
      contacts = (data ?? []) as Contact[];
    }
  } else if (audience.type === 'custom_field' && audience.customField) {
    contacts = await resolveCustomFieldAudience(supabase, audience.customField);
  } else if (audience.type === 'csv' && audience.csvContacts) {
    contacts = await upsertCsvContacts(supabase, accountId, userId, audience.csvContacts);
  }
  if (audience.excludeTagIds && audience.excludeTagIds.length > 0) {
    const { data: excludeRows } = await supabase
      .from('contact_tags').select('contact_id').in('tag_id', audience.excludeTagIds);
    const excludedIds = new Set((excludeRows ?? []).map((r) => r.contact_id));
    contacts = contacts.filter((c) => !excludedIds.has(c.id));
  }
  return contacts;
}
```

> Confirme os nomes reais das funções/campos contra o hook (Step 1). Se `resolveVariables`/`fetchCustomValueIndex` já forem exportados do hook, ainda assim CRIE cópias aqui (o hook será reescrito na Task 6); não import de dentro do hook.

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run src/lib/whatsapp/broadcast-audience.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/whatsapp/broadcast-audience.ts src/lib/whatsapp/broadcast-audience.test.ts
git commit -m "feat(onda3): módulo de audiência+variáveis server-side (porta do hook)"
```

---

## Task 2: `createBroadcastQueued`

**Files:** Create `src/lib/whatsapp/broadcast-queue.ts` (+ `.test.ts`)

- [ ] **Step 1: Ver como o hook cria broadcast + insere recipients**

Run: `grep -n "from('broadcasts')\|from('broadcast_recipients')\|INSERT_BATCH_SIZE\|total_recipients\|status: 'sending'\|template_params" src/hooks/use-broadcast-sending.ts`
Anote os campos do insert do parent e o batch de 200.

- [ ] **Step 2: Teste**

Create `src/lib/whatsapp/broadcast-queue.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { createBroadcastQueued } from './broadcast-queue';
import type { SupabaseClient } from '@supabase/supabase-js';

function makeDb(recipientInsertError: unknown = null) {
  const calls = { recipientBatches: 0, broadcastUpdatedFailed: false };
  const db = {
    from(table: string) {
      if (table === 'broadcasts') {
        return {
          insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: { id: 'b1' }, error: null }) }) }),
          update: (row: Record<string, unknown>) => ({ eq: () => { if (row.status === 'failed') calls.broadcastUpdatedFailed = true; return Promise.resolve({ error: null }); } }),
        };
      }
      if (table === 'broadcast_recipients') {
        return { insert: () => { calls.recipientBatches++; return Promise.resolve({ error: recipientInsertError }); } };
      }
      throw new Error(`unexpected ${table}`);
    },
  } as unknown as SupabaseClient;
  return { db, calls };
}

describe('createBroadcastQueued', () => {
  it('cria broadcast + insere destinatários pending em blocos, retorna id/total', async () => {
    const { db, calls } = makeDb();
    const recipients = Array.from({ length: 250 }, (_, i) => ({ contactId: `c${i}`, phone: `+1555${i}`, params: [] as string[] }));
    const r = await createBroadcastQueued(db, 'acc', 'user', {
      name: 'promo', unitId: 'u1', templateName: 't', templateLanguage: 'pt_BR', variables: {}, audience: { type: 'all' }, recipients,
    });
    expect(r.broadcastId).toBe('b1');
    expect(r.total).toBe(250);
    expect(calls.recipientBatches).toBe(2); // 200 + 50
    expect(calls.broadcastUpdatedFailed).toBe(false);
  });

  it('erro em bloco de destinatários marca o broadcast failed e lança', async () => {
    const { db, calls } = makeDb({ message: 'insert boom' });
    const recipients = [{ contactId: 'c1', phone: '+1', params: [] as string[] }];
    await expect(createBroadcastQueued(db, 'acc', 'user', {
      name: 'promo', unitId: 'u1', templateName: 't', templateLanguage: 'pt_BR', variables: {}, audience: { type: 'all' }, recipients,
    })).rejects.toThrow(/insert boom|recipient/i);
    expect(calls.broadcastUpdatedFailed).toBe(true);
  });

  it('dedup por contactId', async () => {
    const { db } = makeDb();
    const r = await createBroadcastQueued(db, 'acc', 'user', {
      name: 'x', unitId: 'u1', templateName: 't', templateLanguage: 'pt_BR', variables: {}, audience: { type: 'all' },
      recipients: [{ contactId: 'c1', phone: '+1', params: [] }, { contactId: 'c1', phone: '+1', params: [] }],
    });
    expect(r.total).toBe(1);
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npx vitest run src/lib/whatsapp/broadcast-queue.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implementar**

Create `src/lib/whatsapp/broadcast-queue.ts`:

```ts
// ============================================================
// Fila de broadcast: cria o broadcast + destinatários (pending) SEM o teto
// de 1000 (o cap é por PASSE de entrega, não por campanha) e roda um passe
// de entrega reusando o motor de resume (claim-lock + plan + deliver).
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  claimBroadcastDelivery,
  releaseBroadcastDelivery,
  markBroadcastSending,
  planBroadcastResume,
} from '@/lib/whatsapp/broadcast-resume';
import { deliverBroadcast, finalizeBroadcastStatus } from '@/lib/whatsapp/broadcast-core';

const INSERT_BATCH_SIZE = 200;

export interface QueuedRecipient { contactId: string; phone: string; params: string[] }

export interface CreateBroadcastQueuedInput {
  name: string;
  unitId: string;
  templateName: string;
  templateLanguage: string;
  variables: Record<string, unknown>;
  audience: Record<string, unknown>;
  recipients: QueuedRecipient[];
}

/** Cria o broadcast e insere TODOS os destinatários (pending) em blocos.
 *  Failsafe: erro num bloco marca o broadcast failed e lança. */
export async function createBroadcastQueued(
  db: SupabaseClient,
  accountId: string,
  auditUserId: string,
  input: CreateBroadcastQueuedInput,
): Promise<{ broadcastId: string; total: number }> {
  // Dedup por contactId (mesmo contato listado 2x / CSV+base).
  const seen = new Set<string>();
  const deduped = input.recipients.filter((r) => {
    if (seen.has(r.contactId)) return false;
    seen.add(r.contactId);
    return true;
  });
  if (deduped.length === 0) throw new Error('No recipients to queue');

  const { data: broadcast, error: bcErr } = await db
    .from('broadcasts')
    .insert({
      user_id: auditUserId,
      account_id: accountId,
      unit_id: input.unitId,
      name: input.name,
      template_name: input.templateName,
      template_language: input.templateLanguage,
      template_variables: input.variables,
      audience_filter: input.audience,
      status: 'sending',
      total_recipients: deduped.length,
      sent_count: 0,
      delivered_count: 0,
      read_count: 0,
      replied_count: 0,
      failed_count: 0,
    })
    .select()
    .single();
  if (bcErr || !broadcast) throw new Error(`Failed to create broadcast: ${bcErr?.message ?? 'unknown'}`);

  const rows = deduped.map((r) => ({
    broadcast_id: broadcast.id,
    contact_id: r.contactId,
    status: 'pending' as const,
    template_params: r.params,
  }));
  for (let i = 0; i < rows.length; i += INSERT_BATCH_SIZE) {
    const batch = rows.slice(i, i + INSERT_BATCH_SIZE);
    const { error } = await db.from('broadcast_recipients').insert(batch);
    if (error) {
      await db.from('broadcasts').update({ status: 'failed', failed_count: deduped.length }).eq('id', broadcast.id);
      throw new Error(`Failed to insert recipient batch ${i / INSERT_BATCH_SIZE + 1}: ${error.message}`);
    }
  }
  return { broadcastId: broadcast.id, total: deduped.length };
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run src/lib/whatsapp/broadcast-queue.test.ts`
Expected: PASS (3 testes).

- [ ] **Step 6: Commit**

```bash
git add src/lib/whatsapp/broadcast-queue.ts src/lib/whatsapp/broadcast-queue.test.ts
git commit -m "feat(onda3): createBroadcastQueued (cria broadcast+destinatários pending, sem teto)"
```

---

## Task 3: `runDrainPass`

**Files:** Modify `src/lib/whatsapp/broadcast-queue.ts` (+ test)

- [ ] **Step 1: Teste**

Adicione em `src/lib/whatsapp/broadcast-queue.test.ts`:

```ts
import { runDrainPass } from './broadcast-queue';
import * as resume from '@/lib/whatsapp/broadcast-resume';
import * as core from '@/lib/whatsapp/broadcast-core';

describe('runDrainPass', () => {
  it('pula quando não consegue o lock', async () => {
    vi.spyOn(resume, 'claimBroadcastDelivery').mockResolvedValue(false);
    const r = await runDrainPass({} as never, 'acc', 'b1');
    expect(r.skipped).toBe(true);
  });

  it('claim ok: planeja pending, entrega, finaliza e libera', async () => {
    vi.spyOn(resume, 'claimBroadcastDelivery').mockResolvedValue(true);
    const plan = { broadcastId: 'b1', planned: [{ recipientRowId: 'r1', phone: '1', params: [] }] } as never;
    const planSpy = vi.spyOn(resume, 'planBroadcastResume').mockResolvedValue({ plan, remaining: 0, unsendable: 0 } as never);
    vi.spyOn(resume, 'markBroadcastSending').mockResolvedValue(undefined as never);
    const deliverSpy = vi.spyOn(core, 'deliverBroadcast').mockResolvedValue(undefined);
    const finalizeSpy = vi.spyOn(core, 'finalizeBroadcastStatus').mockResolvedValue(undefined);
    const releaseSpy = vi.spyOn(resume, 'releaseBroadcastDelivery').mockResolvedValue(undefined);
    const r = await runDrainPass({} as never, 'acc', 'b1');
    expect(planSpy).toHaveBeenCalledWith(expect.anything(), 'acc', 'b1', 'pending');
    expect(deliverSpy).toHaveBeenCalled();
    expect(finalizeSpy).toHaveBeenCalled();
    expect(releaseSpy).toHaveBeenCalled();
    expect(r.skipped).toBe(false);
    expect(r.remaining).toBe(0);
  });

  it('sem pending (plan lança): finaliza e libera mesmo assim', async () => {
    vi.spyOn(resume, 'claimBroadcastDelivery').mockResolvedValue(true);
    vi.spyOn(resume, 'planBroadcastResume').mockRejectedValue(new Error('nothing to resume'));
    const finalizeSpy = vi.spyOn(core, 'finalizeBroadcastStatus').mockResolvedValue(undefined);
    const releaseSpy = vi.spyOn(resume, 'releaseBroadcastDelivery').mockResolvedValue(undefined);
    const r = await runDrainPass({} as never, 'acc', 'b1');
    expect(finalizeSpy).toHaveBeenCalled();
    expect(releaseSpy).toHaveBeenCalled();
    expect(r.skipped).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib/whatsapp/broadcast-queue.test.ts`
Expected: FAIL — `runDrainPass` não existe.

- [ ] **Step 3: Implementar (append em broadcast-queue.ts)**

```ts
/** Roda UM passe de entrega de um broadcast: claim → plan(pending) → deliver →
 *  finalize → release. Best-effort, nunca lança. O claim-lock garante que dois
 *  passes (chute + cron) nunca enviam em dobro. */
export async function runDrainPass(
  admin: SupabaseClient,
  accountId: string,
  broadcastId: string,
): Promise<{ skipped: boolean; remaining: number }> {
  const claimed = await claimBroadcastDelivery(admin, accountId, broadcastId);
  if (!claimed) return { skipped: true, remaining: -1 };

  let remaining = 0;
  try {
    const { plan, remaining: rem } = await planBroadcastResume(admin, accountId, broadcastId, 'pending');
    remaining = rem;
    await markBroadcastSending(admin, broadcastId);
    await deliverBroadcast(admin, plan);
  } catch {
    // 'nothing_to_resume' (sem pending) ou erro de entrega: finaliza abaixo.
  }
  try {
    await finalizeBroadcastStatus(admin, broadcastId);
  } catch {
    // best-effort
  }
  await releaseBroadcastDelivery(admin, broadcastId);
  return { skipped: false, remaining };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/lib/whatsapp/broadcast-queue.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/whatsapp/broadcast-queue.ts src/lib/whatsapp/broadcast-queue.test.ts
git commit -m "feat(onda3): runDrainPass (passe de entrega reusando o engine de resume)"
```

---

## Task 4: Endpoint de disparo `/dispatch`

**Files:** Create `src/app/api/whatsapp/broadcasts/dispatch/route.ts` (+ test)

- [ ] **Step 1: Ver o padrão da rota de resume (auth/after)**

Run: `sed -n '1,60p' src/app/api/whatsapp/broadcast/[id]/resume/route.ts`
Confirme `requireRole('agent')`, `supabaseAdmin()`, `after(...)`, `maxDuration`.

- [ ] **Step 2: Implementar a rota**

Create `src/app/api/whatsapp/broadcasts/dispatch/route.ts`:

```ts
// ============================================================
// POST /api/whatsapp/broadcasts/dispatch
// Disparo server-side de campanha: resolve audiência + variáveis + CSV,
// cria o broadcast + destinatários (pending) e chuta a 1ª leva em after().
// Responde 202; o cron de drenagem entrega o restante. Substitui o laço de
// envio que rodava no navegador.
// ============================================================

import { NextResponse, after } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { resolveOperatorUnitId } from '@/lib/units/operator-unit';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import {
  resolveAudienceServer,
  resolveVariables,
  fetchCustomValueIndex,
  type AudienceConfig,
  type VariableMapping,
} from '@/lib/whatsapp/broadcast-audience';
import { createBroadcastQueued, runDrainPass } from '@/lib/whatsapp/broadcast-queue';

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent');
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Corpo inválido' }, { status: 400 });
    }

    const name: string = typeof body.name === 'string' ? body.name : '';
    const template = body.template ?? {};
    const templateName: string = typeof template.name === 'string' ? template.name : '';
    const templateLanguage: string = typeof template.language === 'string' ? template.language : 'en_US';
    const variables: Record<string, VariableMapping> = body.variables ?? {};
    const audience: AudienceConfig = body.audience ?? { type: 'all' };
    if (!templateName) return NextResponse.json({ error: 'template_name é obrigatório' }, { status: 400 });

    const unitId = await resolveOperatorUnitId(
      supabase, accountId, userId,
      typeof body.selectedUnitId === 'string' ? body.selectedUnitId : null,
    );

    const contacts = await resolveAudienceServer(supabase, accountId, userId, audience);
    if (contacts.length === 0) {
      return NextResponse.json({ error: 'Nenhum contato encontrado para essa audiência.' }, { status: 400 });
    }

    const customValueIndex = await fetchCustomValueIndex(supabase, contacts.map((c) => c.id));
    const recipients = contacts
      .filter((c) => c.phone)
      .map((c) => ({
        contactId: c.id,
        phone: c.phone as string,
        params: resolveVariables(variables, c, customValueIndex.get(c.id)),
      }));
    const rejected = contacts.length - recipients.length;
    if (recipients.length === 0) {
      return NextResponse.json({ error: 'Nenhum contato com telefone válido.' }, { status: 400 });
    }

    const { broadcastId, total } = await createBroadcastQueued(supabase, accountId, userId, {
      name: name || `Campanha (${templateName})`,
      unitId, templateName, templateLanguage, variables, audience, recipients,
    });

    // Chuta a 1ª leva com service-role (outlives o request), como o resume.
    const admin = supabaseAdmin();
    after(() => runDrainPass(admin, accountId, broadcastId));

    return NextResponse.json({ broadcast_id: broadcastId, total_recipients: total, rejected }, { status: 202 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
```

- [ ] **Step 3: Teste da rota**

Create `src/app/api/whatsapp/broadcasts/dispatch/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth/account', () => ({
  requireRole: vi.fn(async () => ({ supabase: {}, accountId: 'acc', userId: 'user' })),
  toErrorResponse: (e: unknown) => new Response(JSON.stringify({ error: String(e) }), { status: 500 }),
}));
vi.mock('@/lib/units/operator-unit', () => ({ resolveOperatorUnitId: vi.fn(async () => 'u1') }));
vi.mock('@/lib/flows/admin-client', () => ({ supabaseAdmin: () => ({}) }));
vi.mock('next/server', async () => {
  const actual = await vi.importActual<typeof import('next/server')>('next/server');
  return { ...actual, after: (fn: () => unknown) => { void fn; } };
});
const resolveAudienceServer = vi.fn(async () => [{ id: 'c1', phone: '+1' }]);
vi.mock('@/lib/whatsapp/broadcast-audience', () => ({
  resolveAudienceServer: (...a: unknown[]) => resolveAudienceServer(...a),
  resolveVariables: () => [],
  fetchCustomValueIndex: async () => new Map(),
}));
const createBroadcastQueued = vi.fn(async () => ({ broadcastId: 'b1', total: 1 }));
vi.mock('@/lib/whatsapp/broadcast-queue', () => ({
  createBroadcastQueued: (...a: unknown[]) => createBroadcastQueued(...a),
  runDrainPass: vi.fn(),
}));

import { POST } from './route';

function req(body: unknown) {
  return new Request('http://x/api/whatsapp/broadcasts/dispatch', { method: 'POST', body: JSON.stringify(body) });
}

beforeEach(() => { resolveAudienceServer.mockResolvedValue([{ id: 'c1', phone: '+1' }]); });

describe('POST /dispatch', () => {
  it('202 com total e rejected', async () => {
    const res = await POST(req({ template: { name: 't' }, audience: { type: 'all' } }));
    expect(res.status).toBe(202);
    const j = await res.json();
    expect(j).toMatchObject({ broadcast_id: 'b1', total_recipients: 1, rejected: 0 });
  });
  it('400 sem template_name', async () => {
    const res = await POST(req({ template: {}, audience: { type: 'all' } }));
    expect(res.status).toBe(400);
  });
  it('400 audiência vazia', async () => {
    resolveAudienceServer.mockResolvedValue([]);
    const res = await POST(req({ template: { name: 't' }, audience: { type: 'all' } }));
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 4: Rodar testes + tsc**

Run: `npx vitest run src/app/api/whatsapp/broadcasts/dispatch/route.test.ts && npx tsc --noEmit`
Expected: PASS + sem erros. (Se `toErrorResponse`/`requireRole` tiverem assinatura diferente do mock, ajuste o mock ao real — confirme no Step 1.)

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/whatsapp/broadcasts/dispatch"
git commit -m "feat(onda3): endpoint /dispatch (envio server-side + chute da 1a leva)"
```

---

## Task 5: Cron de drenagem `/drain`

**Files:** Create `src/app/api/whatsapp/broadcasts/drain/route.ts` (+ test); Modify `src/middleware.ts`

- [ ] **Step 1: Ver o padrão de auth dual-secret + a exclusão do middleware**

Run: `sed -n '43,70p' src/app/api/appointments/reminders/run/route.ts` e `grep -n "broadcast\|reminders\|matcher\|x-license\|api/whatsapp" src/middleware.ts | head`
Reuse o `safeEq` (timing-safe) e o padrão de exclusão de rota.

- [ ] **Step 2: Implementar a rota**

Create `src/app/api/whatsapp/broadcasts/drain/route.ts`:

```ts
// ============================================================
// GET/POST /api/whatsapp/broadcasts/drain — cron de drenagem.
// Entrega o restante das campanhas em passes de <=1000 e auto-recupera
// campanhas travadas (status 'sending' com pending sem lock). Auth timing-safe:
// x-cron-secret = BROADCAST_DRAIN_SECRET OU x-license-secret = LICENSE_CONTROL_SECRET.
// ============================================================

import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { runDrainPass } from '@/lib/whatsapp/broadcast-queue';
import { DELIVERY_LOCK_STALE_MS } from '@/lib/whatsapp/broadcast-resume';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const RUN_BUDGET_MS = 250_000;
const MAX_BROADCASTS_PER_RUN = 50;

function safeEq(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const ba = Buffer.from(a), bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

async function handle(request: Request): Promise<Response> {
  const cronOk = safeEq(request.headers.get('x-cron-secret'), process.env.BROADCAST_DRAIN_SECRET);
  const licenseOk = safeEq(request.headers.get('x-license-secret'), process.env.LICENSE_CONTROL_SECRET);
  if (!cronOk && !licenseOk) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const admin = supabaseAdmin();
  const deadline = Date.now() + RUN_BUDGET_MS;
  const staleCutoff = new Date(Date.now() - DELIVERY_LOCK_STALE_MS).toISOString();

  // Campanhas ainda enviando, sem lock ativo (ou lock stale).
  const { data: broadcasts } = await admin
    .from('broadcasts')
    .select('id, account_id')
    .eq('status', 'sending')
    .or(`delivery_locked_at.is.null,delivery_locked_at.lt.${staleCutoff}`)
    .limit(MAX_BROADCASTS_PER_RUN);

  let processed = 0;
  let partial = false;
  for (const b of broadcasts ?? []) {
    if (Date.now() >= deadline) { partial = true; break; }
    await runDrainPass(admin, b.account_id as string, b.id as string);
    processed += 1;
  }
  return NextResponse.json({ ok: true, processed, partial });
}

export async function POST(request: Request) { return handle(request); }
export async function GET(request: Request) { return handle(request); }
```

- [ ] **Step 3: Excluir a rota no middleware**

Em `src/middleware.ts`, adicione `/api/whatsapp/broadcasts/drain` à lista de rotas server-to-server que NÃO passam pela auth de sessão (mesmo padrão das outras rotas de cron/relay — confirme no Step 1 como as exclusões são escritas, ex.: array de prefixos ou matcher).

- [ ] **Step 4: Teste da rota**

Create `src/app/api/whatsapp/broadcasts/drain/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const runDrainPass = vi.fn(async () => ({ skipped: false, remaining: 0 }));
vi.mock('@/lib/whatsapp/broadcast-queue', () => ({ runDrainPass: (...a: unknown[]) => runDrainPass(...a) }));
const broadcasts: { id: string; account_id: string }[] = [];
vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: () => ({
    from: () => ({ select: () => ({ eq: () => ({ or: () => ({ limit: () => Promise.resolve({ data: broadcasts, error: null }) }) }) }) }),
  }),
}));

import { POST } from './route';

function req(headers: Record<string, string>) {
  return new Request('http://x/api/whatsapp/broadcasts/drain', { method: 'POST', headers });
}

beforeEach(() => {
  process.env.BROADCAST_DRAIN_SECRET = 'S';
  broadcasts.length = 0;
  runDrainPass.mockClear();
});

describe('POST /drain', () => {
  it('401 sem segredo', async () => {
    const res = await POST(req({}));
    expect(res.status).toBe(401);
  });
  it('processa broadcasts com segredo do cron', async () => {
    broadcasts.push({ id: 'b1', account_id: 'a1' }, { id: 'b2', account_id: 'a2' });
    const res = await POST(req({ 'x-cron-secret': 'S' }));
    expect(res.status).toBe(200);
    expect(runDrainPass).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 5: Testes + tsc**

Run: `npx vitest run src/app/api/whatsapp/broadcasts/drain/route.test.ts && npx tsc --noEmit`
Expected: PASS + sem erros.

- [ ] **Step 6: Commit**

```bash
git add "src/app/api/whatsapp/broadcasts/drain" src/middleware.ts
git commit -m "feat(onda3): cron /drain (drena pending + auto-recupera travadas)"
```

---

## Task 6: Wizard fino (POST /dispatch + redirect)

**Files:** Modify `src/hooks/use-broadcast-sending.ts`, `src/components/broadcasts/step4-schedule-send.tsx`, `src/app/(dashboard)/broadcasts/new/page.tsx`

- [ ] **Step 1: Mapear o consumo atual do hook**

Run: `grep -rn "useBroadcastSending\|createAndSendBroadcast\|isProcessing\|progress" src/components/broadcasts src/app/\(dashboard\)/broadcasts`
Anote quem chama `createAndSendBroadcast` e como usa `isProcessing`/`progress`.

- [ ] **Step 2: Reescrever o hook fino**

Substitua o corpo de `src/hooks/use-broadcast-sending.ts` por uma versão que só monta o payload e faz o POST. Mantenha a MESMA interface pública que os componentes já usam (`createAndSendBroadcast(payload) => Promise<string>` retornando o broadcastId; `isProcessing`; `progress` pode virar 0/100 apenas). Núcleo:

```tsx
'use client';
import { useState } from 'react';
import { useUnitScope } from '@/components/units/unit-scope-provider';
import { MessageTemplate } from '@/types';

export type VariableMapping =
  | { type: 'static'; value: string }
  | { type: 'field'; value: string }
  | { type: 'custom_field'; value: string };

interface AudienceConfig {
  type: 'all' | 'tags' | 'custom_field' | 'csv';
  tagIds?: string[];
  customField?: { fieldId: string; operator: 'is' | 'is_not' | 'contains'; value: string };
  csvContacts?: { phone: string; name?: string }[];
  excludeTagIds?: string[];
}
interface BroadcastPayload {
  name: string;
  template: MessageTemplate;
  audience: AudienceConfig;
  variables: Record<string, VariableMapping>;
  headerMediaUrl?: string;
}

export function useBroadcastSending() {
  const { selectedUnitId } = useUnitScope();
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);

  async function createAndSendBroadcast(payload: BroadcastPayload): Promise<string> {
    setIsProcessing(true);
    setProgress(0);
    try {
      const res = await fetch('/api/whatsapp/broadcasts/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: payload.name,
          template: { name: payload.template.name, language: payload.template.language ?? 'en_US', header_type: payload.template.header_type },
          variables: payload.variables,
          audience: payload.audience,
          headerMediaUrl: payload.headerMediaUrl,
          selectedUnitId: selectedUnitId ?? undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Falha ao disparar a campanha');
      setProgress(100);
      return data.broadcast_id as string;
    } finally {
      setIsProcessing(false);
    }
  }

  return { createAndSendBroadcast, isProcessing, progress };
}
```

> Ajuste o tipo `MessageTemplate` (header_type existe?) e o import de `useUnitScope` aos reais. Se `resolveVariables`/`resolveAudience`/`upsertCsvContacts` estavam exportados do hook e algum outro arquivo os importava, aponte esses imports para `@/lib/whatsapp/broadcast-audience` (grep antes de deletar).

- [ ] **Step 3: Redirect no wizard**

Em `step4-schedule-send.tsx`/`broadcasts/new/page.tsx`, onde hoje se aguarda `createAndSendBroadcast` e mostra progresso, ao receber o `broadcastId`, `router.push(\`/broadcasts/${broadcastId}\`)`. Texto do botão/estado: "Disparando…" enquanto `isProcessing`.

- [ ] **Step 4: tsc + build**

Run: `npx tsc --noEmit`
Expected: sem erros (nenhum import órfão das funções movidas).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/use-broadcast-sending.ts src/components/broadcasts/step4-schedule-send.tsx "src/app/(dashboard)/broadcasts/new/page.tsx"
git commit -m "feat(onda3): wizard fino (POST /dispatch + redirect pra detalhe)"
```

---

## Task 7: Polling leve na tela de detalhe

**Files:** Modify `src/app/(dashboard)/broadcasts/[id]/page.tsx`

- [ ] **Step 1: Ver o fetch atual**

Run: `grep -n "fetchData\|useEffect\|broadcast.status\|useCallback" src/app/\(dashboard\)/broadcasts/\[id\]/page.tsx | head`

- [ ] **Step 2: Adicionar polling enquanto sending**

No `useEffect` que chama `fetchData` no mount, adicione um `setInterval` que re-executa `fetchData` a cada 4s ENQUANTO `broadcast?.status === 'sending'`, limpando o intervalo quando o status sair de 'sending' ou no unmount:

```tsx
useEffect(() => {
  fetchData();
  const id = setInterval(() => {
    // só refetch enquanto estiver enviando; para sozinho quando settla
    setBroadcast((b) => {
      if (b && b.status !== 'sending') { clearInterval(id); }
      return b;
    });
    fetchData();
  }, 4000);
  return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [fetchData]);
```
> Ajuste ao shape real do estado (`broadcast`/`setBroadcast`). Se ficar mais simples, condicione o intervalo com um `useRef` do status. O importante: refetch a cada ~4s enquanto `sending`, e parar quando settla.

- [ ] **Step 3: tsc + commit**

Run: `npx tsc --noEmit`
```bash
git add "src/app/(dashboard)/broadcasts/[id]/page.tsx"
git commit -m "feat(onda3): polling leve na tela de detalhe enquanto enviando"
```

---

## Task 8: Env + validação final

**Files:** Modify `.env.local.example`

- [ ] **Step 1: Documentar a env**

Em `.env.local.example`, adicione:
```
# Segredo do cron de drenagem de broadcast (fila durável). O agendador chama
# GET /api/whatsapp/broadcasts/drain com header x-cron-secret = este valor.
BROADCAST_DRAIN_SECRET=troque-por-um-segredo-forte
```

- [ ] **Step 2: Suíte completa**

Run: `npx vitest run`
Expected: PASS (exceto as 5 falhas PRÉ-EXISTENTES de `currency.test.ts` + `dashboard/date-utils.test.ts` — locale/ICU). Novos de audience/queue/dispatch/drain verdes; broadcast-core/resume seguem verdes.

- [ ] **Step 3: Type-check + build**

Run: `npx tsc --noEmit && npx next build`
Expected: sem erros; rota `/api/whatsapp/broadcasts/dispatch` e `/api/whatsapp/broadcasts/drain` compilam.

- [ ] **Step 4: Commit**

```bash
git add .env.local.example
git commit -m "docs(onda3): documenta BROADCAST_DRAIN_SECRET"
```

---

## Notas de deploy
- Env nova: `BROADCAST_DRAIN_SECRET`. Cron novo no cron-job.org: `GET https://<instância>/api/whatsapp/broadcasts/drain` com header `x-cron-secret`, a cada ~2–5 min. Sem migration.
- Smoke: disparar campanha pequena → 202 + redirect pra detalhe → progresso ao vivo; fechar o tab no meio → o cron termina (destinatários `pending` viram `sent`).

## Self-review
- Spec coberto: audiência server-side (T1), createBroadcastQueued (T2), runDrainPass (T3), dispatch (T4), drain+middleware (T5), wizard fino (T6), polling (T7), env+validação (T8). Reuso do engine (T2/T3 importam broadcast-core/resume, não os alteram). Claim-lock anti-duplicado (T3). Auth dual-secret (T5). Sem migration.
- Tipos consistentes: `AudienceConfig`/`VariableMapping` (T1↔T4↔T6); `QueuedRecipient`/`createBroadcastQueued`/`runDrainPass` (T2/T3↔T4/T5); assinaturas do engine confirmadas (deliverBroadcast/planBroadcastResume/finalizeBroadcastStatus).
