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
