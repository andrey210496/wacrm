-- ================================================================
-- BUNDLE DE DEPLOY — Frente 2 (Conexão redezap) + Frente 5 (Agenda)
-- Aplique ESTE arquivo no SQL Editor do Supabase da INSTÂNCIA.
-- Contém as migrations 052 a 056, em ordem. Idempotente/aditivo.
-- Gerado em: 2026-09-13T19:51:01Z
-- ================================================================

-- >>>>>>>>>>>>>>>>>>>> 052_channel_hybrid.sql >>>>>>>>>>>>>>>>>>>>
-- ============================================================
-- 052 · Frente 2: canal híbrido "Conexão redezap" (por unidade) + marca de canal.
--
-- Entrada sempre oficial; uma % das mensagens COBRÁVEIS vai pela uazapi (R$0
-- Meta), intercalada a cada 100. Config por unidade + contador de interleave.
-- `messages.channel` marca por onde a mensagem saiu (alimenta o painel de consumo).
--
-- Aditivo / idempotente. Default DESLIGADO — comportamento atual intacto.
-- ============================================================

CREATE TABLE IF NOT EXISTS channel_hybrid_config (
  unit_id            UUID PRIMARY KEY REFERENCES unidades(id) ON DELETE CASCADE,
  account_id         UUID NOT NULL,
  hybrid_enabled     BOOLEAN NOT NULL DEFAULT false,
  uazapi_pct         INT NOT NULL DEFAULT 0 CHECK (uazapi_pct BETWEEN 0 AND 100),
  billable_mode      TEXT NOT NULL DEFAULT 'auto' CHECK (billable_mode IN ('auto','always','template_only')),
  interleave_counter BIGINT NOT NULL DEFAULT 0,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS deny-all: acesso via rota admin server-side + supabaseAdmin (padrão das
-- tarifas da 051). O envio lê a config via service-role.
ALTER TABLE channel_hybrid_config ENABLE ROW LEVEL SECURITY;

-- Marca de canal na mensagem (default oficial mantém o comportamento atual).
ALTER TABLE messages ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'official';

-- Incremento ATÔMICO do contador de interleave. Devolve o valor PRÉ-incremento
-- (0-based). Se a unidade ainda não tem config, devolve 0.
CREATE OR REPLACE FUNCTION next_interleave_counter(p_unit UUID)
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
  n BIGINT;
BEGIN
  UPDATE channel_hybrid_config
     SET interleave_counter = interleave_counter + 1
   WHERE unit_id = p_unit
   RETURNING interleave_counter - 1 INTO n;
  RETURN COALESCE(n, 0);
END;
$$;

-- >>>>>>>>>>>>>>>>>>>> 053_scheduling.sql >>>>>>>>>>>>>>>>>>>>
-- ============================================================
-- 053 · Frente 5 (Fase A) — Agendamento de serviços (genérico).
--
-- Serviço + Recurso + Cliente, por unidade. Recurso = qualquer coisa agendável
-- (profissional, sala, equipamento). Horário de trabalho + folgas por recurso.
-- Agendamento trava overbooking no BANCO (EXCLUDE gist). RLS no padrão do projeto
-- (is_account_member / can_see_unit): catálogo escreve admin; agenda escreve agent.
--
-- Aditivo / idempotente.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ---- Serviços ----
CREATE TABLE IF NOT EXISTS services (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id   UUID NOT NULL,
  unit_id      UUID NOT NULL REFERENCES unidades(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  duration_min INT NOT NULL CHECK (duration_min > 0),
  price        NUMERIC(12, 2),
  color        TEXT,
  active       BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_services_unit ON services(unit_id) WHERE active;

-- ---- Recursos (agendáveis) ----
CREATE TABLE IF NOT EXISTS resources (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL,
  unit_id    UUID NOT NULL REFERENCES unidades(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  kind       TEXT NOT NULL DEFAULT 'professional' CHECK (kind IN ('professional','room','equipment','other')),
  active     BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_resources_unit ON resources(unit_id) WHERE active;

-- ---- Horário de trabalho por recurso (faixas por dia da semana) ----
CREATE TABLE IF NOT EXISTS resource_working_hours (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id  UUID NOT NULL,
  resource_id UUID NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  weekday     INT NOT NULL CHECK (weekday BETWEEN 0 AND 6), -- 0=domingo
  start_time  TIME NOT NULL,
  end_time    TIME NOT NULL,
  CHECK (end_time > start_time)
);
CREATE INDEX IF NOT EXISTS idx_working_hours_resource ON resource_working_hours(resource_id, weekday);

-- ---- Folgas / bloqueios pontuais ----
CREATE TABLE IF NOT EXISTS resource_time_off (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id  UUID NOT NULL,
  resource_id UUID NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  starts_at   TIMESTAMPTZ NOT NULL,
  ends_at     TIMESTAMPTZ NOT NULL,
  reason      TEXT,
  CHECK (ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS idx_time_off_resource ON resource_time_off(resource_id, starts_at);

-- ---- Agendamentos ----
CREATE TABLE IF NOT EXISTS appointments (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id  UUID NOT NULL,
  unit_id     UUID NOT NULL REFERENCES unidades(id) ON DELETE CASCADE,
  contact_id  UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  service_id  UUID NOT NULL REFERENCES services(id) ON DELETE RESTRICT,
  resource_id UUID NOT NULL REFERENCES resources(id) ON DELETE RESTRICT,
  starts_at   TIMESTAMPTZ NOT NULL,
  ends_at     TIMESTAMPTZ NOT NULL,
  status      TEXT NOT NULL DEFAULT 'scheduled'
                CHECK (status IN ('scheduled','confirmed','completed','canceled','no_show')),
  notes       TEXT,
  created_by  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  -- Trava de overbooking: um recurso não pode ter dois agendamentos ATIVOS que
  -- se sobreponham no tempo. Ignora cancelados/faltou.
  CONSTRAINT appointments_no_overbook EXCLUDE USING gist (
    resource_id WITH =,
    tstzrange(starts_at, ends_at) WITH &&
  ) WHERE (status <> 'canceled' AND status <> 'no_show')
);
CREATE INDEX IF NOT EXISTS idx_appointments_unit_start ON appointments(unit_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_appointments_resource_start ON appointments(resource_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_appointments_contact ON appointments(contact_id);

-- ============================================================
-- RLS (padrão do projeto: is_account_member(account_id[, min]) + can_see_unit).
-- Leitura: membros da conta veem o que é da sua unidade. Escrita de catálogo:
-- admin+. Escrita de horário/folga: admin+. Escrita de agendamento: agent+.
-- ============================================================
ALTER TABLE services ENABLE ROW LEVEL SECURITY;
ALTER TABLE resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE resource_working_hours ENABLE ROW LEVEL SECURITY;
ALTER TABLE resource_time_off ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;

-- services
CREATE POLICY services_select ON services FOR SELECT
  USING (is_account_member(account_id) AND can_see_unit(account_id, unit_id));
CREATE POLICY services_write ON services FOR ALL
  USING (is_account_member(account_id, 'admin') AND can_see_unit(account_id, unit_id))
  WITH CHECK (is_account_member(account_id, 'admin') AND can_see_unit(account_id, unit_id));

-- resources
CREATE POLICY resources_select ON resources FOR SELECT
  USING (is_account_member(account_id) AND can_see_unit(account_id, unit_id));
CREATE POLICY resources_write ON resources FOR ALL
  USING (is_account_member(account_id, 'admin') AND can_see_unit(account_id, unit_id))
  WITH CHECK (is_account_member(account_id, 'admin') AND can_see_unit(account_id, unit_id));

-- resource_working_hours (leitura por membro; escrita admin) — sem unit direto.
CREATE POLICY working_hours_select ON resource_working_hours FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY working_hours_write ON resource_working_hours FOR ALL
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

-- resource_time_off (leitura por membro; escrita admin)
CREATE POLICY time_off_select ON resource_time_off FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY time_off_write ON resource_time_off FOR ALL
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

-- appointments (CRUD por agent+, na sua unidade)
CREATE POLICY appointments_select ON appointments FOR SELECT
  USING (is_account_member(account_id) AND can_see_unit(account_id, unit_id));
CREATE POLICY appointments_write ON appointments FOR ALL
  USING (is_account_member(account_id, 'agent') AND can_see_unit(account_id, unit_id))
  WITH CHECK (is_account_member(account_id, 'agent') AND can_see_unit(account_id, unit_id));

-- >>>>>>>>>>>>>>>>>>>> 054_scheduling_reminders.sql >>>>>>>>>>>>>>>>>>>>
-- ============================================================
-- 054 · Frente 5 (Fase B) — Lembretes + confirmação + funil.
--
-- Config por unidade (lembretes, canal, texto, palavras de confirmação, e o
-- mapeamento status→etapa do funil) + log de lembretes enviados (dedupe).
-- RLS deny-all: config via rota admin + supabaseAdmin; log só service-role.
--
-- Aditivo / idempotente.
-- ============================================================

CREATE TABLE IF NOT EXISTS scheduling_config (
  unit_id              UUID PRIMARY KEY REFERENCES unidades(id) ON DELETE CASCADE,
  account_id           UUID NOT NULL,
  reminders_enabled    BOOLEAN NOT NULL DEFAULT false,
  reminder_offsets_min INT[]  NOT NULL DEFAULT '{1440,180}',
  reminder_channel     TEXT   NOT NULL DEFAULT 'auto' CHECK (reminder_channel IN ('auto','official','uazapi')),
  reminder_text        TEXT   NOT NULL DEFAULT 'Olá {cliente}! Lembrete do seu horário de {servico} em {data} às {hora}. Responda SIM para confirmar.',
  confirm_enabled      BOOLEAN NOT NULL DEFAULT true,
  confirm_keywords     TEXT[] NOT NULL DEFAULT '{sim,confirmar,confirmado,ok,1}',
  funnel_pipeline_id   UUID,
  stage_scheduled      UUID,
  stage_confirmed      UUID,
  stage_completed      UUID,
  stage_no_show        UUID,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE scheduling_config ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS appointment_reminders_sent (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  appointment_id UUID NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  offset_min     INT NOT NULL,
  channel        TEXT,
  sent_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (appointment_id, offset_min)
);
ALTER TABLE appointment_reminders_sent ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_reminders_sent_appt ON appointment_reminders_sent(appointment_id);

-- >>>>>>>>>>>>>>>>>>>> 055_public_booking.sql >>>>>>>>>>>>>>>>>>>>
-- ============================================================
-- 055 · Frente 5 (Fase C) — Autoagendamento público.
--
-- Estende scheduling_config com o link público (slug aleatório) + janelas.
-- Aditivo / idempotente.
-- ============================================================

ALTER TABLE scheduling_config ADD COLUMN IF NOT EXISTS public_booking_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE scheduling_config ADD COLUMN IF NOT EXISTS public_slug            TEXT;
ALTER TABLE scheduling_config ADD COLUMN IF NOT EXISTS public_lead_time_min   INT NOT NULL DEFAULT 120;
ALTER TABLE scheduling_config ADD COLUMN IF NOT EXISTS public_window_days     INT NOT NULL DEFAULT 30;

-- Slug único global (não enumerável) — usado na URL pública. NULL permitido
-- (só existe quando o autoagendamento é ligado).
CREATE UNIQUE INDEX IF NOT EXISTS idx_scheduling_public_slug
  ON scheduling_config(public_slug) WHERE public_slug IS NOT NULL;

-- >>>>>>>>>>>>>>>>>>>> 056_reminder_status.sql >>>>>>>>>>>>>>>>>>>>
-- ============================================================
-- 056 · Status visível do lembrete (Fase B.1).
--
-- appointment_reminders_sent passa a registrar TAMBÉM as falhas (antes só o
-- sucesso). Assim o atendente vê no card se o lembrete foi enviado ou falhou.
--   status: 'sent' (enviado) | 'failed' (falhou) | 'pending' (reivindicado, enviando)
--   error:  motivo da falha (quando failed)
-- Linhas antigas eram sempre sucesso → default 'sent'.
--
-- Aditivo / idempotente.
-- ============================================================

ALTER TABLE appointment_reminders_sent ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'sent'
  CHECK (status IN ('sent', 'failed', 'pending'));
ALTER TABLE appointment_reminders_sent ADD COLUMN IF NOT EXISTS error TEXT;
ALTER TABLE appointment_reminders_sent ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

