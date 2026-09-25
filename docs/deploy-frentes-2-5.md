# Runbook de deploy — Frente 2 (Conexão redezap) + Frente 5 (Agendamento)

Data: 2026-09-13. Cobre tudo que foi construído: canal híbrido **Conexão redezap**,
**agenda de serviços** (A), **lembretes + confirmação + funil** (B), **status de
lembrete** (B.1), **autoagendamento público** (C) e o **cron orquestrado pela central**.

> Ordem de leitura: faça na sequência das seções. Cada passo tem como validar.

## 0. O que está sendo publicado

| Repo | Serviço EasyPanel | Branch/commit alvo |
|---|---|---|
| `wacrm` (instância) | `redezap-purepilates` | `feature/usa-i-multiunidade-sp1` → **`7b6a738`** |
| `gestao-usai` (central) | `gestao-usai` | `master` → **`e3c7b7d`** |

Regras de sempre: **Zero Downtime OFF** no VPS de 3,6 GB; conferir no log de build que subiu o **commit certo**.

## 1. Migrations no Supabase da INSTÂNCIA

Aplique **antes** do redeploy da instância. As migrations vivem em
`wacrm/supabase/migrations/`. O jeito mais simples: abra o **SQL Editor** do
Supabase da instância (projeto `ddeoyffpquscojiqjbyf`) e cole o **bundle**:

```
deploy/deploy-frentes-2-5_052-058.sql
```

Ele contém, em ordem (aditivas/idempotentes — rodar de novo não quebra):

| Migration | O que cria |
|---|---|
| `052_channel_hybrid` | `channel_hybrid_config` (Conexão redezap por unidade) + `messages.channel` + RPC `next_interleave_counter` |
| `053_scheduling` | `services`, `resources`, `resource_working_hours`, `resource_time_off`, `appointments` (+ trava de overbooking `EXCLUDE gist`, exige `btree_gist`) |
| `054_scheduling_reminders` | `scheduling_config` (lembretes/canal/texto/keywords/funil) + `appointment_reminders_sent` |
| `055_public_booking` | colunas de autoagendamento em `scheduling_config` (slug, lead-time, janela) |
| `056_reminder_status` | `appointment_reminders_sent`: `status`/`error`/`updated_at` (selo no card) |
| `057_reminders_per_message` | `scheduling_config.reminders` JSONB (mensagem por lembrete) |
| `058_catalog_agent_write` | RLS de escrita do catálogo baixa de admin→agent (atendente cria serviço/recurso/horário) |

> O bundle antigo `deploy-frentes-2-5_052-056.sql` continua no repo, mas use o **052-058** (mais completo). Rodar o 052-058 por cima de um banco que já tem 052-056 é seguro (idempotente).

**Validar:** o SQL Editor deve rodar sem erro. Confirme que as tabelas existem:
```sql
select count(*) from services;
select count(*) from appointments;
select count(*) from scheduling_config;
```

## 2. Variáveis de ambiente

### 2.1 Central (`gestao-usai`) — 1 variável NOVA
```
REMINDERS_CRON_SECRET=<gere: openssl rand -base64 24>
```
É a senha que o **cron → central** usa. Só existe na central.

### 2.2 Instância (`redezap-purepilates`) — nada novo obrigatório
Já tem o necessário: **`LICENSE_CONTROL_SECRET`** (a central usa isso pra chamar
a instância) e **`CONTROL_PLANE_URL=https://gestao.usaisistemas.com`**.
`REMINDERS_CRON_SECRET` na instância é **opcional** (só pro cron direto de backup).

## 3. Deploy (ordem)

1. **Central primeiro** — redeploy do `gestao-usai` no commit `e3c7b7d` (Zero Downtime OFF).
   Ela ganha o `POST /api/cron/reminders` (orquestra a frota) e o envio uazapi da Frente 2.
2. **Instância depois** — redeploy do `redezap-purepilates` no commit `99b048a` (Zero Downtime OFF).

**Validar central no ar:**
```bash
curl -fsS -X POST https://gestao.usaisistemas.com/api/cron/reminders \
  -H "x-cron-secret: SEU_SEGREDO_DA_CENTRAL"
```
Esperado: `{"ok":true,"summary":{"instances":N,"ok":N,"failed":0,"sent":0,...}}`.
- `302 /login` → a central não subiu o `e3c7b7d` (redeploy não pegou o commit).
- `401` → `REMINDERS_CRON_SECRET` do header ≠ do env.
- `failed:1 / HTTP 401` numa instância → a instância não subiu o `99b048a` (auth `x-license-secret`).

## 4. Cron único (na central)

**Um** cron cobre toda a frota. Escolha:

**A) cron-job.org (sem servidor, recomendado):**
- URL `https://gestao.usaisistemas.com/api/cron/reminders` · método **POST** · a cada **15 min** ·
  header `x-cron-secret: SEU_SEGREDO_DA_CENTRAL` · "Notify on failure" ligado.

**B) crontab na VPS da central:**
```bash
*/15 * * * * curl -fsS -X POST https://gestao.usaisistemas.com/api/cron/reminders -H "x-cron-secret: SEU_SEGREDO_DA_CENTRAL" >> ~/redezap-lembretes.log 2>&1
```

Instância nova entra sozinha (a central já a conhece). Não precisa de cron novo por unidade.

## 5. Validação ponta a ponta (na instância)

1. **Agenda → Catálogo**: crie 1 serviço + 1 recurso com horário de trabalho.
2. **Novo agendamento**: marque um horário; confira a **trava de conflito** (não deixa dobrar o recurso).
3. **Lembretes & Funil**: ligue lembretes com offset curto (ex.: `5`); crie um agendamento pra ~7 min à frente;
   rode o curl da central → `sent:1` e o WhatsApp chega. Volte o offset pro normal (`1440,180`).
4. **Selo de lembrete**: o card mostra 🔔 enviado / ⚠️ falhou.
5. **Autoagendamento**: em Lembretes & Funil ligue o público, copie o link `/agendar/<slug>`, teste marcar como cliente.
6. **Conexão redezap** (opcional agora): Config → WhatsApp → ative com % baixo numa unidade que já tenha uazapi conectada.

## 6. Segurança / pós-deploy

- **Rotacionar segredos** que apareceram em conversas (ex.: `REMINDERS_CRON_SECRET`):
  `openssl rand -base64 24` → atualiza no env da central (redeploy) **e** no cron.
- RLS por unidade em tudo; rotas públicas do autoagendamento são rate-limited + honeypot + revalidação server-side.

## 7. Rollback

- As migrations são **aditivas** (não removem/alteram dados existentes) → o rollback é
  **redeploy do commit anterior** de cada serviço. As tabelas novas podem ficar (inertes) ou
  serem removidas manualmente se desejar. `hybrid_enabled` e `reminders_enabled` nascem
  **desligados** por unidade → zero efeito até alguém ligar.
