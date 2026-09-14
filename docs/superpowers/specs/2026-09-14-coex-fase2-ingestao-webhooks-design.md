# Coex Fase 2 — ingestão dos webhooks (history / contatos / echoes) no CRM

Data: 2026-09-14
Status: DESIGN aprovado (build). Repo: `wacrm` (instância). Depende da Fase 1 (conexão coex).

## Objetivo
Trazer pro CRM o que a Fase 1 só disparou: **histórico** (até 180 dias),
**contatos** do app e as **mensagens que o cliente envia pelo próprio app**
WhatsApp Business (echoes) — pra o inbox refletir a conversa real.

## Fonte / regra Meta (verificado 2026-09-14, doc oficial)
- `smb_message_echoes`: `value.message_echoes[]` = `{ from(negócio), to(cliente),
  id(wamid), timestamp, type, [type] }` → mensagem ENVIADA pelo negócio (outbound).
- `history`: `value.history[]` = `{ metadata{phase,chunk_order,progress}, threads[] }`;
  `thread.id` = telefone do cliente; `messages[]` = `{ from, to?, id, timestamp,
  type, [type], history_context{status} }`; direção pelo `from` (== negócio → out).
- `smb_app_state_sync`: `value.state_sync[]` = `{ type:'contact', action:'add'|'remove',
  contact{full_name,first_name,phone_number}, metadata{timestamp} }`.
Nada memorizado; reconferir sempre na doc.

## Arquitetura (tudo no process-webhook da instância)
Roteamento por `change.field` no `processWebhook` (como os eventos de template):
`smb_message_echoes` / `history` / `smb_app_state_sync` → handlers dedicados. Cada
um resolve o `whatsapp_config` por `phone_number_id` (helper reaproveitado) e usa
os helpers existentes (`findOrCreateContact`/`findOrCreateConversation`, insert
idempotente por `(conversation_id, message_id)`).

### Parsers PUROS (testáveis) — `src/lib/whatsapp/coex-webhooks.ts`
- `parseMessageEchoes(value)` → `[{ metaId, contactPhone(to), timestamp, contentType, contentText }]`.
- `parseHistory(value, businessPhone)` → `[{ metaId, contactPhone(thread.id), direction:'in'|'out', timestamp, contentType, contentText, status }]`.
- `parseAppStateSync(value)` → `[{ phone, name }]` (só `action:'add'`).
- `extractCoexContent(msg)` (texto/legenda por tipo) + `mapHistoryStatus` (READ→read...).

### Handlers (em process-webhook.ts, reusam helpers privados)
- **echoes:** contato = `to`; insere `sender_type='agent'`, `via_business_app=true`,
  status `sent`; atualiza `last_message_text/last_message_at` (sem bump de não-lida).
  **Sem** automação/fluxo/IA/webhook público (o negócio já mandou).
- **history:** por thread/mensagem; `out`→agent+via_business_app, `in`→customer;
  status do `history_context`. Insert idempotente. 🔒 **Sem** disparo downstream
  (backfill não pode spamar automação/IA/webhook nem marcar não-lida). Atualiza o
  resumo da conversa pro mais recente do thread. `progress` só em log.
- **contatos:** `action:'add'` → `findOrCreateContact` (nome+telefone), sem
  conversa/mensagem. `action:'remove'` **ignorado** (não apaga contato do CRM).

## Armazenamento
- Migration **060**: `messages.via_business_app boolean NOT NULL DEFAULT false`.
  Marca o que veio do app (echo/history do negócio). `sender_type` segue
  `customer`/`agent`.
- Inbox: **badge "enviada pelo app"** nas mensagens `via_business_app` (polish).

## Segurança / robustez
- Idempotência por `(conversation_id, message_id)` cobre re-entrega da Meta + chunks.
- Handlers best-effort: erro num item não derruba o webhook (Meta precisa do 200).
- Sem efeito colateral em history/echoes (nada de automação/IA/não-lida no backfill).

## Testes (TDD)
Parsers puros: echo (texto/mídia), history (direção in/out + status), contatos
(add/remove), tipos desconhecidos → fallback. tsc 0 + build.

## Não-objetivos v1
- Reprocessar mídia de history (só texto/legenda/rótulo; mídia antiga pode expirar
  na Meta — fica o texto).
- UI de progresso do sync (só log de `progress`).
