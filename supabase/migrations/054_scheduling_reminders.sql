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
