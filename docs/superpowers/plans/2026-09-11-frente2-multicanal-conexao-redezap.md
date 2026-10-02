# Frente 2 — Multi-canal + "Conexão redezap" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Roteador de saída que envia uma % das mensagens COBRÁVEIS via uazapi (R$0 Meta) em vez do oficial, com fail-safe, override e telemetria — para economizar custo de mensageria.

**Architecture:** Função pura de decisão (`outbound-router`) escolhe `official|uazapi`; quando uazapi, a instância envia via central (tokens só lá); erro na uazapi → fail-safe pro oficial. Config e contador por unidade; `messages.channel` marca o canal usado.

**Tech Stack:** Next.js 16 (wacrm + gestao-usai), Supabase (Postgres/RLS) na instância, Prisma/Postgres na central, vitest, TDD.

Spec: `docs/superpowers/specs/2026-09-11-frente2-multicanal-conexao-redezap-design.md`

---

## File structure

**gestao-usai (central):**
- Modify `src/lib/uazapi/provision.ts` — add `sendUnit()`.
- Create `src/app/api/instances/uazapi/send/route.ts` — `POST`, auth `x-license-secret`.
- Modify `src/lib/uazapi/provision.connect.test.ts` (or new `provision.send.test.ts`) — tests for `sendUnit`.

**wacrm (instância):**
- Create `supabase/migrations/052_channel_hybrid.sql` — `channel_hybrid_config`, `messages.channel`, RPC `next_interleave_counter`.
- Create `src/lib/whatsapp/outbound-router.ts` — funções puras.
- Create `src/lib/whatsapp/outbound-router.test.ts`.
- Modify `src/lib/uazapi/central-client.ts` — add `sendUazapi()`.
- Modify `src/lib/uazapi/central-client.test.ts` (create if missing) — `sendUazapi` test (pure parse via a thin helper).
- Modify `src/lib/whatsapp/send-message.ts` — integrar roteador + fail-safe + `channelOverride` + persistir `channel`.
- Create `src/lib/whatsapp/send-message.routing.test.ts` — integração (mock central-client + supabaseAdmin).
- Create `src/lib/channels/hybrid-config.ts` — leitura/escrita da config (server).
- Create `src/app/(app)/settings/actions/channel-hybrid.ts` (ou reusar actions existentes) — get/save config (admin).
- Create `src/components/settings/conexao-redezap-panel.tsx` — card da UI.
- Modify `src/app/(app)/settings/...whatsapp page` — montar o card.

---

## Task 1 (central): `sendUnit` na provision

**Files:**
- Modify: `gestao-usai/src/lib/uazapi/provision.ts`
- Test: `gestao-usai/src/lib/uazapi/provision.send.test.ts` (novo)

- [ ] **Step 1: Test falhando** — `provision.send.test.ts` (reusa mocks do `provision.connect.test.ts`: prisma/crypto/client via `vi.hoisted`):

```ts
// mocks iguais aos de provision.connect.test.ts (prismaMock, clientMock via vi.hoisted)
import { sendUnit } from "./provision";

// server config resolvido, conn existente com token
beforeEach(() => {
  prismaMock.uazapiServerConfig.findUnique.mockResolvedValue({ id:"singleton", baseUrl:"https://salesflow.uazapi.com", adminTokenEnc:"enc:ADMIN" });
  prismaMock.uazapiConnection.findUnique.mockResolvedValue({ id:"c1", instanceTokenEnc:"enc:TKN" });
  clientMock.sendText.mockResolvedValue({ messageId:"UZ1", raw:{} });
  clientMock.sendMedia.mockResolvedValue({ messageId:"UZ2", raw:{} });
});

it("text → chama sendText com number+text e devolve messageId", async () => {
  const r = await sendUnit({ instanceId:"i1", unitLabel:"u1", to:"5511999998888", type:"text", text:"oi" });
  expect(clientMock.sendText).toHaveBeenCalledWith(expect.objectContaining({ baseUrl:"https://salesflow.uazapi.com", token:"TKN" }), { number:"5511999998888", text:"oi" });
  expect(r.messageId).toBe("UZ1");
});

it("media → chama sendMedia (kind/file/caption)", async () => {
  const r = await sendUnit({ instanceId:"i1", unitLabel:"u1", to:"5511999998888", type:"media", mediaKind:"image", mediaUrl:"https://x/y.jpg", text:"leg", filename:"y.jpg" });
  expect(clientMock.sendMedia).toHaveBeenCalledWith(expect.anything(), { number:"5511999998888", type:"image", file:"https://x/y.jpg", text:"leg", docName:"y.jpg" });
  expect(r.messageId).toBe("UZ2");
});

it("sem conexão da unidade → erro claro", async () => {
  prismaMock.uazapiConnection.findUnique.mockResolvedValue(null);
  await expect(sendUnit({ instanceId:"i1", unitLabel:"u1", to:"55119", type:"text", text:"x" })).rejects.toThrow(/não conectad|sem conex/i);
});
```

- [ ] **Step 2:** rodar `npx vitest run src/lib/uazapi/provision.send.test.ts` → FAIL (sendUnit não existe).
- [ ] **Step 3: Implementar `sendUnit`** em `provision.ts` (importar `sendText, sendMedia` do client):

```ts
export async function sendUnit(params: {
  instanceId: string; unitLabel: string; to: string;
  type: "text" | "media"; text?: string;
  mediaKind?: "image"|"video"|"audio"|"document"; mediaUrl?: string; filename?: string;
}): Promise<{ messageId?: string }> {
  const server = await getUazapiServer();
  if (!server) throw new Error("Servidor uazapi não configurado na central.");
  const conn = await prisma.uazapiConnection.findUnique({
    where: { instanceId_unitLabel: { instanceId: params.instanceId, unitLabel: params.unitLabel } },
  });
  if (!conn) throw new Error("Unidade sem conexão uazapi (não conectada).");
  const token = decryptSecret(conn.instanceTokenEnc);
  const inst = { baseUrl: server.baseUrl, token };
  if (params.type === "media") {
    if (!params.mediaKind || !params.mediaUrl) throw new Error("mídia sem kind/url.");
    const r = await sendMedia(inst, { number: params.to, type: params.mediaKind, file: params.mediaUrl, text: params.text, docName: params.filename });
    return { messageId: r.messageId };
  }
  if (!params.text) throw new Error("texto vazio.");
  const r = await sendText(inst, { number: params.to, text: params.text });
  return { messageId: r.messageId };
}
```
Adicionar `sendText, sendMedia` ao import de `@/lib/uazapi/client`.

- [ ] **Step 4:** rodar o teste → PASS. `npx tsc --noEmit` → 0 erros.
- [ ] **Step 5: Commit** `feat(uazapi): sendUnit envia texto/mídia via central`.

## Task 2 (central): rota POST /api/instances/uazapi/send

**Files:**
- Create: `gestao-usai/src/app/api/instances/uazapi/send/route.ts`
- Verify: `gestao-usai/src/proxy.ts` matcher exclui `api/instances/uazapi` (já cobre /send — confirmar).

- [ ] **Step 1:** criar a rota (espelha connect/status):

```ts
import { NextResponse } from "next/server";
import { authInstanceByLicense, sendUnit } from "@/lib/uazapi/provision";

export async function POST(request: Request) {
  const secret = request.headers.get("x-license-secret");
  const inst = await authInstanceByLicense(secret);
  if (!inst) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }
  const unitLabel = String(body.unitLabel ?? "").trim();
  const to = String(body.to ?? "").trim();
  const type = body.type === "media" ? "media" : "text";
  if (!unitLabel || !to) return NextResponse.json({ error: "unitLabel e to são obrigatórios" }, { status: 400 });
  try {
    const r = await sendUnit({
      instanceId: inst.id, unitLabel, to, type,
      text: typeof body.text === "string" ? body.text : undefined,
      mediaKind: body.mediaKind as ("image"|"video"|"audio"|"document"|undefined),
      mediaUrl: typeof body.mediaUrl === "string" ? body.mediaUrl : undefined,
      filename: typeof body.filename === "string" ? body.filename : undefined,
    });
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    const message = err instanceof Error ? err.message : "erro";
    console.error(`[instances/uazapi/send] falhou unit=${unitLabel}: ${message}`);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
```

- [ ] **Step 2:** confirmar `proxy.ts` exclui `api/instances/uazapi` (regex já cobre `/send`). Se não, adicionar.
- [ ] **Step 3:** `npx tsc --noEmit` → 0. Commit `feat(uazapi): rota central de envio`.

## Task 3 (wacrm): migration 052

**Files:** Create `wacrm/supabase/migrations/052_channel_hybrid.sql`

- [ ] **Step 1:** escrever a migration:

```sql
-- 052 · Frente 2: canal híbrido "Conexão redezap" (por unidade) + marca de canal.
-- Aditivo/idempotente.

CREATE TABLE IF NOT EXISTS channel_hybrid_config (
  unit_id            UUID PRIMARY KEY REFERENCES unidades(id) ON DELETE CASCADE,
  account_id         UUID NOT NULL,
  hybrid_enabled     BOOLEAN NOT NULL DEFAULT false,
  uazapi_pct         INT NOT NULL DEFAULT 0 CHECK (uazapi_pct BETWEEN 0 AND 100),
  billable_mode      TEXT NOT NULL DEFAULT 'auto' CHECK (billable_mode IN ('auto','always','template_only')),
  interleave_counter BIGINT NOT NULL DEFAULT 0,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE channel_hybrid_config ENABLE ROW LEVEL SECURITY;
-- deny-all; acesso via rota/admin server-side + supabaseAdmin (padrão das tarifas 051).

-- Marca de canal na mensagem (default oficial mantém o comportamento atual).
ALTER TABLE messages ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'official';

-- Incremento atômico do contador (distribuição intercalada). Devolve o valor PRÉ-incremento.
CREATE OR REPLACE FUNCTION next_interleave_counter(p_unit UUID)
RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE n BIGINT;
BEGIN
  UPDATE channel_hybrid_config
     SET interleave_counter = interleave_counter + 1
   WHERE unit_id = p_unit
   RETURNING interleave_counter - 1 INTO n;
  RETURN COALESCE(n, 0);
END; $$;
```

- [ ] **Step 2:** commit `feat(db): migration 052 canal híbrido`. (Aplicar no Supabase no rollout.)

## Task 4 (wacrm): outbound-router (puro) — o coração

**Files:** Create `src/lib/whatsapp/outbound-router.ts` + `src/lib/whatsapp/outbound-router.test.ts`

- [ ] **Step 1: Testes falhando** (`outbound-router.test.ts`):

```ts
import { describe, it, expect } from "vitest";
import { isUazapiEligibleType, isBillableAtSend, shouldUseUazapi, chooseChannel } from "./outbound-router";

const OCT1 = new Date("2026-10-01T00:00:00Z");
const SEP = new Date("2026-09-15T12:00:00Z");
const OCT = new Date("2026-10-05T12:00:00Z");

describe("isUazapiEligibleType", () => {
  it("texto/mídia/template → true; interativo → false", () => {
    for (const t of ["text","image","video","document","audio","template"]) expect(isUazapiEligibleType(t)).toBe(true);
    expect(isUazapiEligibleType("interactive")).toBe(false);
  });
});

describe("isBillableAtSend", () => {
  it("auto: template sempre cobrável", () => {
    expect(isBillableAtSend({ messageType:"template", windowOpen:true, now:SEP, mode:"auto" })).toBe(true);
  });
  it("auto: não-template GRÁTIS antes de 01/10/2026", () => {
    expect(isBillableAtSend({ messageType:"text", windowOpen:true, now:SEP, mode:"auto" })).toBe(false);
  });
  it("auto: não-template COBRÁVEL em/depois de 01/10/2026", () => {
    expect(isBillableAtSend({ messageType:"text", windowOpen:true, now:OCT, mode:"auto" })).toBe(true);
    expect(isBillableAtSend({ messageType:"text", windowOpen:true, now:OCT1, mode:"auto" })).toBe(true);
  });
  it("always → sempre true; template_only → só template", () => {
    expect(isBillableAtSend({ messageType:"text", windowOpen:true, now:SEP, mode:"always" })).toBe(true);
    expect(isBillableAtSend({ messageType:"text", windowOpen:true, now:OCT, mode:"template_only" })).toBe(false);
    expect(isBillableAtSend({ messageType:"template", windowOpen:true, now:SEP, mode:"template_only" })).toBe(true);
  });
});

describe("shouldUseUazapi (Bresenham)", () => {
  it("pct=0 nunca; pct=100 sempre", () => {
    for (let n=0;n<100;n++){ expect(shouldUseUazapi(n,0)).toBe(false); expect(shouldUseUazapi(n,100)).toBe(true); }
  });
  it("pct=30 → exatamente 30 hits a cada 100 e espalhado (não bloco)", () => {
    let hits=0; for (let n=0;n<100;n++) if (shouldUseUazapi(n,30)) hits++;
    expect(hits).toBe(30);
    // espalhado: não são os 30 primeiros seguidos
    const firstBlock = [...Array(30).keys()].every(n => shouldUseUazapi(n,30));
    expect(firstBlock).toBe(false);
  });
});

describe("chooseChannel", () => {
  const base = { hybridEnabled:true, uazapiPct:100, billableMode:"auto" as const, messageType:"text", windowOpen:true, now:OCT, hasPhone:true, counter:0, override:"auto" as const };
  it("override official vence", () => {
    expect(chooseChannel({ ...base, override:"official" }).channel).toBe("official");
  });
  it("override uazapi respeita elegibilidade+telefone", () => {
    expect(chooseChannel({ ...base, override:"uazapi", messageType:"interactive" }).channel).toBe("official");
    expect(chooseChannel({ ...base, override:"uazapi", hasPhone:false }).channel).toBe("official");
    expect(chooseChannel({ ...base, override:"uazapi" }).channel).toBe("uazapi");
  });
  it("híbrido off → official", () => { expect(chooseChannel({ ...base, hybridEnabled:false }).channel).toBe("official"); });
  it("interativo → official", () => { expect(chooseChannel({ ...base, messageType:"interactive" }).channel).toBe("official"); });
  it("sem telefone (BSUID) → official", () => { expect(chooseChannel({ ...base, hasPhone:false }).channel).toBe("official"); });
  it("não-cobrável (texto pré-01/10) → official, sem consumir contador", () => {
    const r = chooseChannel({ ...base, now:SEP });
    expect(r.channel).toBe("official"); expect(r.consumeCounter).toBe(false);
  });
  it("cobrável+elegível+100% → uazapi e consome contador", () => {
    const r = chooseChannel({ ...base, uazapiPct:100 });
    expect(r.channel).toBe("uazapi"); expect(r.consumeCounter).toBe(true);
  });
  it("cobrável mas 0% → official, consome contador", () => {
    const r = chooseChannel({ ...base, uazapiPct:0 });
    expect(r.channel).toBe("official"); expect(r.consumeCounter).toBe(true);
  });
});
```

- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3: Implementar** `outbound-router.ts`:

```ts
export type BillableMode = "auto" | "always" | "template_only";
export type Channel = "official" | "uazapi";
export type ChannelOverride = "auto" | "official" | "uazapi";

const SERVICE_BILLABLE_FROM = Date.UTC(2026, 9, 1); // 2026-10-01 (mês 0-based=9)
const UAZAPI_ELIGIBLE = new Set(["text","image","video","document","audio","template"]);

export function isUazapiEligibleType(messageType: string): boolean {
  return UAZAPI_ELIGIBLE.has(messageType);
}

export function isBillableAtSend(p: { messageType: string; windowOpen: boolean; now: Date; mode: BillableMode; }): boolean {
  if (p.mode === "always") return true;
  if (p.mode === "template_only") return p.messageType === "template";
  // auto (fiel à doc oficial da Meta):
  if (p.messageType === "template") return true; // heurística segura
  return p.now.getTime() >= SERVICE_BILLABLE_FROM; // não-template: grátis antes, cobrável a partir de 01/10/2026
}

/** Distribuição intercalada (Bresenham): exatamente `pct` a cada 100, espalhado. */
export function shouldUseUazapi(counter: number, pct: number): boolean {
  if (pct <= 0) return false;
  if (pct >= 100) return true;
  return Math.floor((counter + 1) * pct / 100) - Math.floor(counter * pct / 100) === 1;
}

export function chooseChannel(p: {
  hybridEnabled: boolean; uazapiPct: number; billableMode: BillableMode;
  messageType: string; windowOpen: boolean; now: Date;
  hasPhone: boolean; counter: number; override: ChannelOverride;
}): { channel: Channel; consumeCounter: boolean } {
  if (p.override === "official") return { channel: "official", consumeCounter: false };
  if (p.override === "uazapi") {
    const ok = isUazapiEligibleType(p.messageType) && p.hasPhone;
    return { channel: ok ? "uazapi" : "official", consumeCounter: false };
  }
  if (!p.hybridEnabled) return { channel: "official", consumeCounter: false };
  if (!isUazapiEligibleType(p.messageType)) return { channel: "official", consumeCounter: false };
  if (!p.hasPhone) return { channel: "official", consumeCounter: false };
  if (!isBillableAtSend({ messageType: p.messageType, windowOpen: p.windowOpen, now: p.now, mode: p.billableMode }))
    return { channel: "official", consumeCounter: false };
  const channel: Channel = shouldUseUazapi(p.counter, p.uazapiPct) ? "uazapi" : "official";
  return { channel, consumeCounter: true };
}
```

- [ ] **Step 4:** rodar → PASS. `tsc` 0.
- [ ] **Step 5: Commit** `feat(router): decisão de canal pura (Frente 2)`.

## Task 5 (wacrm): central-client.sendUazapi

**Files:** Modify `src/lib/uazapi/central-client.ts`; test via helper puro em `central-client.test.ts` (novo).

- [ ] **Step 1: Test** (parse do resultado, helper puro `parseSendResult`):

```ts
import { parseSendResult } from "./central-client";
it("parseSendResult lê messageId", () => {
  expect(parseSendResult({ ok:true, messageId:"UZ1" })).toEqual({ messageId:"UZ1" });
  expect(parseSendResult({ ok:true })).toEqual({ messageId: undefined });
});
```

- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3: Implementar** `sendUazapi` + `parseSendResult`:

```ts
export function parseSendResult(body: Record<string, unknown>): { messageId?: string } {
  return { messageId: typeof body.messageId === "string" ? body.messageId : undefined };
}

export async function sendUazapi(unitLabel: string, payload: {
  to: string; type: "text"|"media"; text?: string;
  mediaKind?: "image"|"video"|"audio"|"document"; mediaUrl?: string; filename?: string;
}): Promise<{ messageId?: string }> {
  const res = await centralFetch("/api/instances/uazapi/send", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ unitLabel, ...payload }),
  });
  const body = await readJson(res, "enviar");
  return parseSendResult(body);
}
```

- [ ] **Step 4:** PASS. `tsc` 0. Commit `feat(uazapi): sendUazapi no client da instância`.

## Task 6 (wacrm): integrar no send-message + fail-safe

**Files:**
- Create `src/lib/channels/hybrid-config.ts` — `getHybridConfig(unitId)` + `nextInterleaveCounter(unitId)` via `supabaseAdmin()`.
- Modify `src/lib/whatsapp/send-message.ts`.
- Create `src/lib/whatsapp/send-message.routing.test.ts`.

- [ ] **Step 1:** `hybrid-config.ts`:

```ts
import { supabaseAdmin } from "@/lib/flows/admin-client";
export type HybridConfig = { hybridEnabled: boolean; uazapiPct: number; billableMode: "auto"|"always"|"template_only" };
export async function getHybridConfig(unitId: string): Promise<HybridConfig> {
  const { data } = await supabaseAdmin().from("channel_hybrid_config")
    .select("hybrid_enabled, uazapi_pct, billable_mode").eq("unit_id", unitId).maybeSingle();
  return {
    hybridEnabled: data?.hybrid_enabled ?? false,
    uazapiPct: data?.uazapi_pct ?? 0,
    billableMode: (data?.billable_mode ?? "auto"),
  };
}
export async function nextInterleaveCounter(unitId: string): Promise<number> {
  const { data } = await supabaseAdmin().rpc("next_interleave_counter", { p_unit: unitId });
  return typeof data === "number" ? data : 0;
}
```

- [ ] **Step 2: Test de integração** (`send-message.routing.test.ts`) — mockar `@/lib/uazapi/central-client`, `@/lib/channels/hybrid-config`, `@/lib/whatsapp/meta-api`, e um `db` fake. Casos:
  - híbrido on, 100%, texto, cobrável (now≥Oct1), contato com telefone → chama `sendUazapi`, NÃO chama Meta, persiste `channel='uazapi'`.
  - `sendUazapi` lança → **fail-safe**: chama Meta e persiste `channel='official'`.
  - contato só-BSUID → nunca uazapi (Meta, `channel='official'`).
  - `messageType='interactive'` → Meta.
  (Estruturar com `vi.hoisted` para os mocks; `db` fake com `.from().select().eq()...` encadeável devolvendo conversation/contact/config.)

- [ ] **Step 3: Implementar** a integração em `sendMessageToConversation`:
  - Adicionar `channelOverride?: ChannelOverride` em `SendMessageParams` (default `'auto'`).
  - Após resolver `config`, `contact`, `sanitizedPhone`/`bsuid`, `templateRow`, computar:
    ```ts
    const cfg = await getHybridConfig(conversation.unit_id);
    const windowOpen = conversation.last_inbound_at ? (Date.now() - new Date(conversation.last_inbound_at).getTime() < 24*3600*1000) : false;
    let counter = 0;
    const pre = chooseChannel({ hybridEnabled: cfg.hybridEnabled, uazapiPct: cfg.uazapiPct, billableMode: cfg.billableMode, messageType, windowOpen, now: new Date(), hasPhone: !!sanitizedPhone, counter: 0, override: params.channelOverride ?? "auto" });
    // Só consulta contador quando a decisão depende dele:
    let decided = pre;
    if (pre.consumeCounter) { counter = await nextInterleaveCounter(conversation.unit_id); decided = chooseChannel({ ...same, counter }); }
    ```
    (Nota: `chooseChannel` é determinística; recomputar com o counter real fecha a decisão de interleave.)
  - Se `decided.channel === 'uazapi'` E `sanitizedPhone` E tipo elegível:
    - montar deliverable: `type='media'` se `isMediaKind`, senão `'text'` com `text = messageType==='template' ? templateContentText(templateRow, templateBodyParams(...), contentText) : contentText`.
    - `try { const r = await sendUazapi(unitLabel, {...}); waMessageId = r.messageId ?? ''; channelUsed='uazapi'; } catch { /* fail-safe */ decided.channel='official'; }`
    - (`unitLabel` = `conversation.unit_id`.)
  - Se caiu (ou é) `official`: rodar o fluxo Meta atual; `channelUsed='official'`.
  - No `insert` de `messages`, adicionar `channel: channelUsed`.
  - **Fail-safe correto:** se uazapi falhar, seguir EXATAMENTE o fluxo Meta existente (com variantes/erros), sem duplicar envio.

- [ ] **Step 4:** rodar `vitest run src/lib/whatsapp` → PASS (incluindo os testes existentes de send). `tsc` 0.
- [ ] **Step 5: Commit** `feat(send): roteamento híbrido + fail-safe + channel`.

## Task 7 (wacrm): config server + UI "Conexão redezap"

**Files:**
- Create `src/lib/channels/hybrid-config.ts` já tem leitura; adicionar `saveHybridConfig` (admin).
- Create server action/route p/ get+save (admin, valida role).
- Create `src/components/settings/conexao-redezap-panel.tsx`.
- Modify a página de settings/WhatsApp para montar o card (perto do `UazapiChannelPanel`).

- [ ] **Step 1:** `saveHybridConfig(unitId, accountId, {hybridEnabled, uazapiPct, billableMode})` — upsert via `supabaseAdmin()` (ou rota admin com `requireRole('admin')`). Validar `0<=pct<=100` e `billableMode ∈ {...}`.
- [ ] **Step 2:** rota `POST /api/channels/hybrid` (get via GET) com `requireRole('admin')` → chama save/get. (Espelha o padrão das rotas de billing/uazapi.) Excluir do proxy se necessário? Não — é rota de sessão (admin), fica no matcher normal.
- [ ] **Step 3:** `conexao-redezap-panel.tsx` (client): seletor de unidade (reusa `unidades`), toggle `Ativar`, slider `%`, select modo, aviso de risco, status uazapi (link ao painel da Frente 1). Salva via a rota. Mensagens claras.
- [ ] **Step 4:** montar o card na página de WhatsApp settings (junto do painel uazapi). `tsc`/build 0.
- [ ] **Step 5: Commit** `feat(ui): card Conexão redezap (config híbrida por unidade)`.

## Task 8: verde final + entrega

- [ ] `npx vitest run` nos DOIS repos → tudo verde.
- [ ] `npx tsc --noEmit` nos dois → 0 erros.
- [ ] build da instância (`next build`) → ok.
- [ ] Commit/push por branch; deploy: aplicar migration 052 no Supabase da instância, redeploy central + instância (Zero Downtime OFF).
- [ ] Validação ao vivo: ativar em 1 estúdio, % baixo, mandar cobrável → conferir `channel='uazapi'` no envio e inbound seguindo oficial.

## Self-review (cobertura do spec)
- Roteador puro (Task 4) ✓ | Envio uazapi via central (1,2,5) ✓ | Config por unidade + contador (3,7) ✓ | Integração+fail-safe+channel (6) ✓ | Override por envio (6) ✓ | UI (7) ✓ | Telemetria messages.channel (3,6) ✓ | Date-aware billable (4) ✓ | Testes ponta a ponta (todas) ✓.
