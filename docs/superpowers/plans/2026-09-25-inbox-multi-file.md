# Inbox — Envio de múltiplos arquivos — Plano

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:test-driven-development para o helper puro. Repo `wacrm`, branch `feature/inbox-multi-file` (base: `feature/usa-i-multiunidade-sp1`).

**Goal:** Permitir selecionar e enviar mais de um arquivo no chat do inbox. WhatsApp envia 1 mídia por mensagem → uma FILA de anexos enviada como mensagens separadas, em ordem, cada uma com legenda própria.

**Architecture:** O compositor (`message-composer.tsx`) troca o `draft` único por uma FILA `drafts: MediaDraft[]` (cada item já sobe pro storage ao ser escolhido, como hoje). Preview em lista, cada item com legenda + remover. "Enviar" dispara `onSendMedia` por item, sequencialmente (await → ordem + sem colisão de id otimista). Validação de tamanho por tipo + teto de quantidade num helper PURO testado.

## File Structure
- `src/lib/inbox/media-queue.ts` (+`.test.ts`) — puro: `MAX_MEDIA_QUEUE`, `acceptFilesForQueue`.
- `src/components/inbox/message-composer.tsx` — fila + preview em lista + envio sequencial + `multiple`.
- `src/components/inbox/message-thread.tsx` — id otimista único (hardening).
- `messages/{pt,en,ko}.json` — chaves novas (ex.: enviar todos, teto de arquivos).

---

## Task 1: Helper puro da fila (TDD)
**Files:** Create `src/lib/inbox/media-queue.ts`, `src/lib/inbox/media-queue.test.ts`

- [ ] **Teste (RED):**
```ts
import { describe, it, expect } from "vitest";
import { acceptFilesForQueue, MAX_MEDIA_QUEUE } from "./media-queue";

function f(name: string, size: number): File {
  return new File([new Uint8Array(size)], name, { type: "image/png" });
}

describe("acceptFilesForQueue", () => {
  it("aceita dentro do tamanho e do teto", () => {
    const r = acceptFilesForQueue({ files: [f("a.png", 10), f("b.png", 20)], kind: "image", currentCount: 0, maxBytes: 100 });
    expect(r.accepted.map((x) => x.name)).toEqual(["a.png", "b.png"]);
    expect(r.rejected).toEqual([]);
  });
  it("rejeita acima do tamanho, com motivo", () => {
    const r = acceptFilesForQueue({ files: [f("big.png", 200)], kind: "image", currentCount: 0, maxBytes: 100 });
    expect(r.accepted).toEqual([]);
    expect(r.rejected).toHaveLength(1);
    expect(r.rejected[0].name).toBe("big.png");
    expect(r.rejected[0].reason).toContain("limite");
  });
  it("respeita o teto da fila (MAX_MEDIA_QUEUE), rejeitando o excedente", () => {
    const files = Array.from({ length: 3 }, (_, i) => f(`f${i}.png`, 1));
    const r = acceptFilesForQueue({ files, kind: "image", currentCount: MAX_MEDIA_QUEUE - 1, maxBytes: 100 });
    expect(r.accepted).toHaveLength(1);
    expect(r.rejected).toHaveLength(2);
    expect(r.rejected[0].reason).toContain("máximo");
  });
});
```
- [ ] **Impl (GREEN):**
```ts
export const MAX_MEDIA_QUEUE = 10;

export interface AcceptInput {
  files: File[];
  kind: "image" | "video" | "document" | "audio";
  currentCount: number;
  maxBytes: number;
}
export interface AcceptResult {
  accepted: File[];
  rejected: { name: string; reason: string }[];
}

export function acceptFilesForQueue(input: AcceptInput): AcceptResult {
  const accepted: File[] = [];
  const rejected: { name: string; reason: string }[] = [];
  let slot = input.currentCount;
  for (const file of input.files) {
    if (slot >= MAX_MEDIA_QUEUE) {
      rejected.push({ name: file.name, reason: `Limite de no máximo ${MAX_MEDIA_QUEUE} arquivos por vez.` });
      continue;
    }
    if (file.size > input.maxBytes) {
      const mb = (file.size / 1024 / 1024).toFixed(1);
      const cap = Math.round(input.maxBytes / 1024 / 1024);
      rejected.push({ name: file.name, reason: `${file.name} tem ${mb} MB — limite de ${input.kind} é ${cap} MB.` });
      continue;
    }
    accepted.push(file);
    slot++;
  }
  return { accepted, rejected };
}
```
- [ ] Rodar `npx vitest run src/lib/inbox/media-queue.test.ts` (RED→GREEN). Commit.

---

## Task 2: Compositor — fila de anexos
**Files:** Modify `src/components/inbox/message-composer.tsx`

- [ ] `MediaDraft` ganha `id: string` (ex.: `crypto.randomUUID()`), mantém `{kind, mediaUrl, path, filename, caption}`.
- [ ] Estado: trocar `const [draft, setDraft] = useState<MediaDraft | null>(null)` por `const [drafts, setDrafts] = useState<MediaDraft[]>([])`. `draftRef` vira `draftsRef` (array) para o cleanup GC de todos.
- [ ] Inputs de arquivo: adicionar `multiple` nos 3 inputs (image/video/document). `onChange` passa `Array.from(e.target.files ?? [])` para um novo `handlePickedMany(kind, files)`.
- [ ] `handlePickedMany(kind, files)`: usa `acceptFilesForQueue({ files, kind, currentCount: drafts.length, maxBytes: MEDIA_MAX_BYTES_BY_KIND[kind] })`; para cada `rejected` → `toast.error(reason)`; para cada `accepted` → `stageUpload(kind, file)` (append). 
- [ ] `stageUpload`: em vez de substituir, **acrescenta** à fila: `setDrafts((prev) => [...prev, { id: crypto.randomUUID(), kind, mediaUrl, path, filename: file.name, caption: "" }])`. (Sobe cada arquivo; `busy` cobre a janela de upload — pode subir em série.) Remover o GC do "draft anterior" (não há mais substituição).
- [ ] `finalizeRecording` (voz): também **acrescenta** um item de áudio à fila.
- [ ] Cleanup no unmount: GC de **todos** os `draftsRef.current` não enviados.
- [ ] Preview: renderizar a **lista** de `drafts`. Cada item = o card atual (thumbnail/arquivo) + input de **legenda por item** (exceto áudio) + botão **remover** (GC daquele path e tira da fila). Botão **Enviar** único no rodapé do bloco: envia todos.
- [ ] `sendAll` (novo, async): `for (const d of drafts) { await onSendMedia({ kind: d.kind, mediaUrl: d.mediaUrl, path: d.path, caption: d.kind === "audio" ? undefined : d.caption.trim() || undefined, filename: d.kind === "document" ? d.filename : undefined, replyToId: firstOnly ? replyTo?.id : undefined }); }` — aplicar `replyToId` só no **primeiro** item; ao final `setDrafts([])` e `onClearReply?.()`. (Sequencial preserva ordem e evita colisão de id otimista.)
- [ ] `setCaption(id, caption)`: atualiza a legenda do item `id` na fila.
- [ ] Prop `onSendMedia`: tipo passa a `(payload: SendMediaPayload) => void | Promise<void>` e `sendAll` faz `await`.
- [ ] `MediaDraftPreview` (componente): re-trabalhar para receber a **lista** (ou renderizar 1 item e o pai mapeia). Preferível: manter `MediaDraftPreview` para 1 item (com `onCaptionChange(caption)`, `onRemove`) e um wrapper que lista + botão Enviar/limpar tudo. Manter em escopo de módulo (foco do input não se perde).
- [ ] `npx tsc --noEmit`.

---

## Task 3: Hardening do id otimista (envio sequencial)
**Files:** Modify `src/components/inbox/message-thread.tsx`

- [ ] Em `handleSendMedia`, trocar `const tempId = \`temp-${Date.now()}\`` por um id garantidamente único (ex.: `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` ou um contador `useRef`), para múltiplos envios não colidirem. Confirmar que `onSendMedia` já é `async` (é) — o compositor agora o aguarda.
- [ ] `npx tsc --noEmit`.

---

## Task 4: i18n
**Files:** Modify `messages/{pt,en,ko}.json`

- [ ] Adicionar em `Inbox.composer` (mesma estrutura das chaves existentes) as chaves usadas: ex. `sendAll` (pt "Enviar", en "Send", ko …), `attachmentsCount` (ex.: "{count} anexos") se usada. Reaproveitar `removeAttachment`/`addCaption` já existentes. LER as chaves atuais e replicar o padrão. Rodar `npx vitest run src/i18n` se existir.

---

## Validação final
- [ ] `npx tsc --noEmit` limpo.
- [ ] `npx vitest run` — verdes (as 5 falhas pré-existentes de locale currency/date-utils NÃO contam).
- [ ] `npm run build` compila.
- [ ] Verificação visual no preview (opcional): selecionar 2+ imagens, ver a fila, remover uma, enviar → 2 mensagens em ordem.

## Self-Review
1. **Cobertura:** multi-seleção (`multiple`) + fila + preview em lista + legenda por item + envio sequencial (1 msg/mídia) + teto + validação de tamanho. 
2. **Placeholders:** Task 1 com código completo; Tasks 2–4 com passos cirúrgicos sobre o arquivo já lido.
3. **Consistência:** `acceptFilesForQueue`/`MAX_MEDIA_QUEUE` (T1) usados no compositor (T2); `onSendMedia` awaited (T2) casa com `handleSendMedia` async + id único (T3).
