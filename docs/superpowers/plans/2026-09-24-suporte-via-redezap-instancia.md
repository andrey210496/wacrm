# Suporte via RedeZap — Instância (Fase 3) — Plano

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps usam `- [ ]`. Repo: `wacrm` (RedeZap). Branch: `feature/suporte-via-redezap` (criar a partir da mainline atual do wacrm; confirmar com o dono qual é a base antes de mergear).

**Goal:** Adicionar no RedeZap uma aba **"Suporte"** onde qualquer usuário logado abre, acompanha e responde chamados (com anexos) — falando com a central pela ponte de licença, sem login novo.

**Architecture:** Páginas App Router chamam server actions que usam um cliente server-side (`central-client.ts`, estendido) para bater na API relay da central com `x-license-secret` (envs `CONTROL_PLANE_URL` + `LICENSE_CONTROL_SECRET`, já existentes). O segredo nunca vai ao navegador. Anexos: upload repassado à central; download via rota-proxy do próprio RedeZap.

**Tech Stack:** Next.js 16 (App Router), Supabase auth, i18n (`messages/*.json`), Vitest.

**Contexto verificado (confie):**
- Auth: `requireRole(min)` de `@/lib/auth/account` → `{ supabase, userId, accountId, role, account:{id,name} }`; lança `UnauthorizedError`/`ForbiddenError` (helper `toErrorResponse`). Papel mínimo = `"viewer"` (qualquer logado). Nome da pessoa: ler de `profiles` (coluna de nome) pelo `userId`, com fallback para `account.name`.
- Ponte já existe: `src/lib/uazapi/central-client.ts` usa `CONTROL_PLANE_URL` + `LICENSE_CONTROL_SECRET` e manda header `x-license-secret` (padrão a seguir).
- i18n: `messages/{pt,en,ko}.json`; sidebar em `src/components/layout/sidebar.tsx` usa itens `{ href, labelKey, icon }` (grupos "Atendimento", "Alcance", "Inteligência"…).
- **Contrato da central (relay)** — todas exigem header `x-license-secret`:
  - `POST /api/support/relay/tickets` (multipart: `title`,`body?`,`typeId?`,`authorName`,`files[]?`) → `{ id, protocolo }`.
  - `GET /api/support/relay/tickets` → `{ tickets:[{id,protocolo,title,status,priorityName,slaDueAt,createdAt,messageCount}] }`.
  - `GET /api/support/relay/tickets/:id` → `{ ticket:{ id,protocolo,title,body,status,priorityName,slaDueAt,createdAt,openedByExternalName, attachments:[{id,fileName}], messages:[{id,body,authorLabel,fromTeam,createdAt,attachments:[{id,fileName}]}] } }` | 404.
  - `POST /api/support/relay/tickets/:id/reply` (multipart: `body`,`authorName`,`files[]?`) → `{ ok:true }` | 404.
  - `GET /api/support/relay/attachments/:id` → bytes (attachment).

## File Structure

- `src/lib/support/central-support-client.ts` — funções de suporte (create/list/get/reply/download) via segredo.
- `src/app/api/support/attachments/[id]/route.ts` — proxy de download (exige sessão).
- `src/app/support/page.tsx` (lista), `src/app/support/new/page.tsx` + `new-ticket-form.tsx` + `actions.ts`, `src/app/support/[id]/page.tsx` + `reply-form.tsx` + `actions.ts`.
- `src/components/layout/sidebar.tsx` + `messages/{pt,en,ko}.json` — item de navegação.

> NB: se o RedeZap tiver um utilitário de erro/print de status já pronto (`toErrorResponse`), reuse-o nas rotas/actions. LEIA um arquivo de página + uma action existentes (ex.: `src/app/agents/*` ou `src/app/settings/*`) e ESPELHE o estilo (componentes UI, i18n `useTranslations`, tratamento de erro) — este plano dá o essencial, não o estilo casa-a-casa.

---

## Task 1: Cliente de suporte para a central

**Files:** Create `src/lib/support/central-support-client.ts`

- [ ] **Step 1:** Implemente (espelhando `central-client.ts`):
```ts
/**
 * RedeZap (instância) → central: API de suporte. Server-only.
 * Autentica pela licença (x-license-secret). O segredo NUNCA vai ao navegador.
 */
const TIMEOUT_MS = 20_000;

function centralBase(): string {
  const url = process.env.CONTROL_PLANE_URL?.trim();
  if (!url) throw new Error("CONTROL_PLANE_URL não configurada na instância.");
  return url.replace(/\/+$/, "");
}
function secret(): string {
  const s = process.env.LICENSE_CONTROL_SECRET;
  if (!s) throw new Error("LICENSE_CONTROL_SECRET não configurada na instância.");
  return s;
}
async function withTimeout(): Promise<{ signal: AbortSignal; done: () => void }> {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), TIMEOUT_MS);
  return { signal: c.signal, done: () => clearTimeout(t) };
}

export interface SupportTicketListItem {
  id: string; protocolo: string | null; title: string; status: string;
  priorityName: string | null; slaDueAt: string | null; createdAt: string; messageCount: number;
}
export interface SupportTicketDetail {
  id: string; protocolo: string | null; title: string; body: string | null; status: string;
  priorityName: string | null; slaDueAt: string | null; createdAt: string; openedByExternalName: string | null;
  attachments: { id: string; fileName: string }[];
  messages: { id: string; body: string; authorLabel: string | null; fromTeam: boolean; createdAt: string; attachments: { id: string; fileName: string }[] }[];
}

async function jsonOrThrow(res: Response, ctx: string): Promise<Record<string, unknown>> {
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : `Central: ${ctx} (HTTP ${res.status}).`);
  return body;
}

export async function supportListTickets(): Promise<SupportTicketListItem[]> {
  const { signal, done } = await withTimeout();
  try {
    const res = await fetch(`${centralBase()}/api/support/relay/tickets`, {
      method: "GET", cache: "no-store", signal, headers: { "x-license-secret": secret() },
    });
    const body = await jsonOrThrow(res, "listar chamados");
    return (body.tickets as SupportTicketListItem[]) ?? [];
  } finally { done(); }
}

export async function supportGetTicket(id: string): Promise<SupportTicketDetail | null> {
  const { signal, done } = await withTimeout();
  try {
    const res = await fetch(`${centralBase()}/api/support/relay/tickets/${encodeURIComponent(id)}`, {
      method: "GET", cache: "no-store", signal, headers: { "x-license-secret": secret() },
    });
    if (res.status === 404) return null;
    const body = await jsonOrThrow(res, "abrir chamado");
    return (body.ticket as SupportTicketDetail) ?? null;
  } finally { done(); }
}

/** Cria chamado. `form` deve conter title/body?/typeId?/files[]?; authorName é injetado aqui. */
export async function supportCreateTicket(form: FormData, authorName: string): Promise<{ id: string; protocolo: string | null }> {
  form.set("authorName", authorName);
  const { signal, done } = await withTimeout();
  try {
    const res = await fetch(`${centralBase()}/api/support/relay/tickets`, {
      method: "POST", cache: "no-store", signal, headers: { "x-license-secret": secret() }, body: form,
    });
    const body = await jsonOrThrow(res, "abrir chamado");
    return { id: String(body.id), protocolo: (body.protocolo as string) ?? null };
  } finally { done(); }
}

export async function supportReply(ticketId: string, form: FormData, authorName: string): Promise<void> {
  form.set("authorName", authorName);
  const { signal, done } = await withTimeout();
  try {
    const res = await fetch(`${centralBase()}/api/support/relay/tickets/${encodeURIComponent(ticketId)}/reply`, {
      method: "POST", cache: "no-store", signal, headers: { "x-license-secret": secret() }, body: form,
    });
    await jsonOrThrow(res, "responder chamado");
  } finally { done(); }
}

/** Baixa um anexo da central. Devolve o Response cru para a rota-proxy repassar. */
export async function supportDownloadAttachment(id: string): Promise<Response> {
  return fetch(`${centralBase()}/api/support/relay/attachments/${encodeURIComponent(id)}`, {
    method: "GET", cache: "no-store", headers: { "x-license-secret": secret() },
  });
}
```
- [ ] **Step 2:** `npx tsc --noEmit`. Commit `feat(support): cliente da API de suporte da central`.

---

## Task 2: Proxy de download de anexo

**Files:** Create `src/app/api/support/attachments/[id]/route.ts`

- [ ] **Step 1:** Exige sessão (qualquer logado) e repassa o stream da central:
```ts
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { supportDownloadAttachment } from "@/lib/support/central-support-client";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireRole("viewer"); // qualquer usuário logado da instância
  } catch (err) {
    return toErrorResponse(err);
  }
  const { id } = await params;
  const upstream = await supportDownloadAttachment(id);
  if (!upstream.ok || !upstream.body) {
    return new Response("Arquivo indisponível.", { status: upstream.status === 404 ? 404 : 502 });
  }
  // Repassa cabeçalhos relevantes (anexo + nosniff) da central.
  const headers = new Headers();
  for (const h of ["content-type", "content-disposition", "content-length", "x-content-type-options", "cache-control"]) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }
  return new Response(upstream.body, { status: 200, headers });
}
```
(Se o nome real do helper de erro não for `toErrorResponse`, ajuste conforme `@/lib/auth/account`.)
- [ ] **Step 2:** `npx tsc --noEmit`. Commit `feat(support): proxy de download de anexo (exige sessão)`.

---

## Task 3: Páginas da aba Suporte (lista, abrir, detalhe/responder)

**Files:** Create `src/app/support/page.tsx`, `src/app/support/new/{page.tsx,new-ticket-form.tsx,actions.ts}`, `src/app/support/[id]/{page.tsx,reply-form.tsx,actions.ts}`

> LEIA antes uma página+action existente (ex.: `src/app/agents/…` ou `src/app/settings/…`) e o util de i18n (`useTranslations`/`getTranslations`) para espelhar o estilo. Use os componentes UI do RedeZap (`src/components/ui/*`).

- [ ] **Step 1: Helper de autor** — em cada action, obtenha o nome do usuário: `const ctx = await requireRole("viewer");` e busque o nome em `profiles` (`ctx.supabase.from("profiles").select("<coluna-de-nome>").eq("id", ctx.userId).single()`), com fallback `ctx.account.name`. Extraia isso num pequeno helper local `authorNameFromCtx(ctx)` reusado nas 2 actions (abrir/responder). Confirme a coluna de nome do `profiles` lendo o schema/migrations do wacrm.

- [ ] **Step 2: Lista** `src/app/support/page.tsx` (server component): `await requireRole("viewer")`; `const tickets = await supportListTickets();` renderiza tabela (protocolo, título, status com rótulo PT, prazo, nº de mensagens) + botão "Novo chamado" (link para `/support/new`). Status/labels: crie um mapa PT local simples (OPEN→"Aberto", IN_PROGRESS→"Em andamento", WAITING_CLIENT→"Aguardando você", RESOLVED→"Resolvido", CLOSED→"Fechado"). Vazio → estado vazio com CTA.

- [ ] **Step 3: Abrir** — `new/actions.ts`:
```ts
"use server";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/account";
import { supportCreateTicket } from "@/lib/support/central-support-client";

export async function submitNewSupportTicket(_prev: string | undefined, formData: FormData): Promise<string | undefined> {
  const ctx = await requireRole("viewer");
  const title = String(formData.get("title") ?? "").trim();
  if (title.length < 3) return "Informe um título (mín. 3 caracteres).";
  const authorName = await authorNameFromCtx(ctx); // helper do Step 1
  let id: string;
  try {
    const r = await supportCreateTicket(formData, authorName);
    id = r.id;
  } catch (e) {
    return e instanceof Error ? e.message : "Falha ao abrir o chamado.";
  }
  redirect(`/support/${id}`);
}
```
`new/new-ticket-form.tsx` (client, `useActionState`): campos `title`, `body` (textarea), `typeId` (opcional — se quiser popular tipos, é uma melhoria futura; pode omitir o select na v1) e `<input type="file" name="files" multiple accept="image/png,image/jpeg,image/webp,image/gif,application/pdf">` + aviso "até 5 arquivos, 10 MB". `new/page.tsx` renderiza o form.

- [ ] **Step 4: Detalhe + responder** — `[id]/page.tsx` (server): `await requireRole("viewer")`; `const t = await supportGetTicket(id); if (!t) notFound();` renderiza cabeçalho (protocolo, status, prazo), descrição + anexos da abertura (links `/api/support/attachments/<id>`), a thread (cada mensagem: `fromTeam` decide o lado/estilo; mostra `authorLabel`, `body`, anexos) e o `ReplyForm`. `[id]/reply-form.tsx` (client, `useActionState`): textarea `body` + input de arquivo, submit. `[id]/actions.ts`:
```ts
"use server";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/account";
import { supportReply } from "@/lib/support/central-support-client";

export async function submitSupportReply(ticketId: string, _prev: string | undefined, formData: FormData): Promise<string | undefined> {
  const ctx = await requireRole("viewer");
  const body = String(formData.get("body") ?? "").trim();
  if (!body) return "Escreva uma mensagem.";
  const authorName = await authorNameFromCtx(ctx);
  try {
    await supportReply(ticketId, formData, authorName);
  } catch (e) {
    return e instanceof Error ? e.message : "Falha ao enviar a resposta.";
  }
  revalidatePath(`/support/${ticketId}`);
  return undefined;
}
```
(o `reply-form` faz `submitSupportReply.bind(null, ticketId)`.)

- [ ] **Step 5:** `npx tsc --noEmit` e `npx vitest run` (verde, sem regressões). Commit `feat(support): aba Suporte no RedeZap (lista, abrir, detalhe, responder)`.

---

## Task 4: Navegação + i18n

**Files:** Modify `src/components/layout/sidebar.tsx`, `messages/{pt,en,ko}.json`

- [ ] **Step 1:** Adicione um item de navegação para `/support` (ex.: no grupo "Atendimento" ou um item solto), com `labelKey: "support"` e um ícone do `lucide-react` já importado (ex.: `LifeBuoy` — importe se necessário).
- [ ] **Step 2:** Adicione a chave `support` nos três arquivos de i18n no mesmo namespace/estrutura das outras chaves de sidebar: `pt` = "Suporte", `en` = "Support", `ko` = "지원" (ou o padrão do arquivo). LEIA como as chaves de sidebar existentes (ex.: `inbox`, `agents`) estão aninhadas e replique exatamente.
- [ ] **Step 3:** `npx tsc --noEmit`; rode o teste de i18n se existir (`npx vitest run src/i18n`). Commit `feat(support): item de navegacao Suporte + i18n`.

---

## Task 5: Validação final + push

- [ ] `npx tsc --noEmit` limpo · `npx vitest run` verde (as falhas pré-existentes de locale/currency já conhecidas NÃO contam como regressão — confirme que o conjunto que passava continua passando).
- [ ] `npm run build` (ou o build script do wacrm) — compila.
- [ ] `git push origin feature/suporte-via-redezap`.

## Self-Review

**1. Cobertura:** aba com lista + abrir + detalhe + responder + anexos (upload e download). Qualquer usuário logado (guard `viewer`). Nome do autor enviado à central.
**2. Segurança:** segredo só server-side (`central-support-client` + rota-proxy); download exige sessão e passa pela central (que checa dono); nunca chama a central direto do browser. Upload/anexos validados na central (allowlist/tamanho).
**3. Placeholders:** Tasks 1–2 com código completo; Task 3/4 dão o essencial das actions + contrato e mandam ESPELHAR páginas/i18n existentes do wacrm (para não divergir do estilo) e confirmar a coluna de nome do `profiles`.
**4. Consistência:** tipos `SupportTicketListItem`/`SupportTicketDetail` batem com o contrato do plano da central; `authorName` (rótulo) enviado nas duas actions; proxy de anexo casa com `GET /api/support/relay/attachments/:id`.
