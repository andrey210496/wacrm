# Frente 5 — Fase B — Lembretes + confirmação + funil

Data: 2026-09-13
Status: DESIGN aprovado (build). Depende da Fase A (agenda) + Frente 2 (canal).
Repo: `wacrm`.

## Objetivo
Lembretes automáticos antes do agendamento pelo canal escolhido (Frente 2),
**confirmação por palavra-chave** no inbound (funciona em qualquer canal, sem
depender de botão de template) que muda o status **e move o funil** (deal→etapa).

## Dados (migration 054, por unidade)
- `scheduling_config(unit_id PK, account_id, reminders_enabled bool=false,
  reminder_offsets_min int[]='{1440,180}', reminder_channel text='auto'
  (auto|official|uazapi), reminder_text text (com placeholders), confirm_enabled
  bool=true, confirm_keywords text[]='{sim,confirmar,confirmado,ok,1}',
  funnel_pipeline_id uuid?, stage_scheduled/confirmed/completed/no_show uuid?,
  updated_at)`. RLS deny-all → acesso via rota admin + supabaseAdmin.
- `appointment_reminders_sent(id, appointment_id FK, offset_min int, sent_at,
  channel, UNIQUE(appointment_id, offset_min))`. RLS deny-all (só service-role).

## Puro (testável) — `src/lib/scheduling/reminders.ts` + `confirm.ts`
- `renderReminder(text, {cliente,servico,data,hora,recurso})` → troca placeholders.
- `dueOffsets(now, apptStart, offsets, sentOffsets)` → offsets vencidos ainda não
  enviados (now ≥ start − offset; e start ainda no futuro). Evita reenvio.
- `isConfirmIntent(text, keywords)` → normaliza (lower/trim/sem acento) e casa.
- `pickDealToMove(deals)` → deal ativo mais recente (ou null).

## Worker de lembretes — `POST /api/appointments/reminders/run` (x-cron-secret)
Cron do EasyPanel. Para cada unidade com `reminders_enabled`: busca appointments
`scheduled|confirmed` que começam nas próximas ~max(offsets)h; para cada offset
vencido e não enviado (`dueOffsets`), resolve a conversa do contato
(`resolveConversationByPhone`) e envia o texto renderizado via
`sendMessageToConversation({messageType:'text', channelOverride: reminder_channel})`;
grava em `appointment_reminders_sent` (UNIQUE evita corrida/duplicata). Erro no
envio = loga e segue (não derruba o lote). Segredo: `REMINDERS_CRON_SECRET`.

## Confirmação no inbound — hook em `process-webhook`
Após processar um inbound de TEXTO, se `confirm_enabled` e `isConfirmIntent`,
e o contato tem um appointment `scheduled` começando nas próximas 48h → marca o
**mais próximo** como `confirmed` e move o funil (se configurado). Idempotente
(já confirmado = no-op). Best-effort (try/catch, nunca quebra o webhook).
Também aceita payload de botão `confirm_appt:<id>` se vier (bônus).

## Funil — `src/lib/scheduling/funnel.ts`
Em eventos (confirmed no v1; scheduled/completed/no_show se mapeados): move o
deal do contato no `funnel_pipeline_id` para o stage mapeado (`pickDealToMove`
→ update stage_id). Sem deal = no-op (não cria no v1). Reusa a mudança de status
da agenda: `setAppointmentStatus` chama o mesmo mover-funil.

## UI
Painel "Lembretes & Funil" (aba no catálogo da agenda ou dialog próprio, admin):
liga lembretes, offsets, canal, texto do lembrete (com dica de placeholders),
palavras de confirmação, e o mapeamento etapa-do-funil por evento (escolhe
pipeline + stage por status).

## Testes
Puros: renderReminder, dueOffsets (vencido/não/entregue/futuro/passado),
isConfirmIntent (acento/caixa/keyword), pickDealToMove. Worker/confirm hook:
lógica de seleção testada; envio mockado. `vitest` verde + `tsc` 0 + build.

## Segurança / não-objetivos
RLS: config admin; reminders_sent service-role. Não cria deal (só move). Sem
template aprovado no v1 (texto livre; official fora da janela depende de uazapi
ou de configurar template — documentado). Recorrência/no-show automático = futuro.
