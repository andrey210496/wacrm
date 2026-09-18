# Frente 5 — Agendamento de serviços — Fase A (núcleo da agenda)

Data: 2026-09-13
Status: DESIGN aprovado (build). Genérico (qualquer nicho): Serviço + Recurso + Cliente.
Repo: `wacrm`. Fases B (lembretes+confirmação+funil) e C (autoagendamento) vêm depois.

## Objetivo
Agenda interna genérica: catálogo de **serviços**, **recursos** agendáveis (profissional/sala/
equipamento), **horário de trabalho + folgas** por recurso, e **agendamentos** de clientes
(contatos), com **motor de disponibilidade/slots** e **trava de overbooking**. Operador marca/
edita/cancela e muda status. Vendável a qualquer nicho.

## Dados (migration 053, por unidade, RLS `is_account_member`+`can_see_unit`)
- `services(id, account_id, unit_id, name, duration_min, price?, color?, active, created_at)`.
- `resources(id, account_id, unit_id, name, kind, active, created_at)` — kind: professional|room|equipment|other.
- `resource_working_hours(id, account_id, resource_id, weekday 0-6, start_time, end_time)`.
- `resource_time_off(id, account_id, resource_id, starts_at, ends_at, reason?)`.
- `appointments(id, account_id, unit_id, contact_id, service_id, resource_id, starts_at, ends_at,
  status, notes?, created_by?, created_at, updated_at)` — status: scheduled|confirmed|completed|canceled|no_show.
  - **Overbooking guard (DB):** `EXCLUDE USING gist (resource_id WITH =, tstzrange(starts_at, ends_at) WITH &&) WHERE (status NOT IN ('canceled','no_show'))` — exige `btree_gist`. Impede dobrar o recurso mesmo sob concorrência.
  - Índices: (unit_id, starts_at), (resource_id, starts_at), (contact_id).

## Motor de disponibilidade (puro — `src/lib/scheduling/availability.ts`)
- `generateSlots({ workingHours, timeOff, appointments, durationMin, dayStart, dayEnd, stepMin })`
  → lista de `{ start, end }` livres: dentro do horário de trabalho, sem colidir com folgas nem
  agendamentos ativos, com passo `stepMin` (default = duração). Puro/determinístico.
- `hasConflict(rangeStart, rangeEnd, appointments)` → bool.
- `overlaps(aStart, aEnd, bStart, bEnd)` helper.
Testes de borda: sobreposição exata/parcial, fim de expediente, várias faixas/dia, folga no meio,
duração maior que a janela, dia sem expediente.

## Server (rotas/actions, admin/agent + tenancy)
- CRUD `services`, `resources`, `resource_working_hours`, `resource_time_off` (admin+).
- `appointments`: criar/editar/cancelar/mudar status (agent+). Criar valida slot livre (o EXCLUDE
  é a rede final; a checagem antes dá erro amigável). 
- `GET slots?serviceId&resourceId&date` → horários livres do dia (usa o motor).
Tenancy: sempre account_id + unit_id; RLS reforça.

## UI
- Rota nova `/agenda`: visão do **dia por recurso** (colunas), navegação de data, criar
  (serviço→recurso→dia→slot livre→cliente), editar/cancelar, badge de status.
- Configurações → **Serviços** e **Recursos** (com horário de trabalho + folgas).
- Reusa contatos como cliente (busca; walk-in cria contato rápido — reusa fluxo existente).

## Timezone
`timestamptz` (UTC) no banco; entrada/exibição no fuso da conta (default America/Sao_Paulo).
Conversão na borda (UI/rota); o motor opera em epoch/Date. Fuso configurável = fase futura.

## Segurança
RLS por unidade em todas as tabelas; escrita de catálogo = admin, de agendamento = agent+.
Sem PII em URL. `created_by` = usuário da sessão.

## Testes (TDD, verde antes de deploy)
Motor de slots (bordas acima), conflito/overlap, CRUD server (auth/tenancy happy+deny),
criação de agendamento respeitando slot, mudança de status. `vitest` + `tsc` 0 + `next build`.

## Não-objetivos (Fase A)
Lembretes/confirmação/funil (Fase B), autoagendamento público (C), serviço↔recurso M:N,
múltiplos recursos/agendamento, pagamento, recorrência.
