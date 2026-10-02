-- ============================================================
-- 058 · Catálogo da agenda: liberar escrita para ATENDENTES (agent+).
--
-- Antes (053) a escrita de serviços/recursos/horários/folgas era admin+.
-- O dono quer que atendentes também criem/editem. Recriamos as policies de
-- escrita com is_account_member(..., 'agent'). Leitura continua igual.
--
-- Idempotente (DROP IF EXISTS + CREATE).
-- ============================================================

-- services
DROP POLICY IF EXISTS services_write ON services;
CREATE POLICY services_write ON services FOR ALL
  USING (is_account_member(account_id, 'agent') AND can_see_unit(account_id, unit_id))
  WITH CHECK (is_account_member(account_id, 'agent') AND can_see_unit(account_id, unit_id));

-- resources
DROP POLICY IF EXISTS resources_write ON resources;
CREATE POLICY resources_write ON resources FOR ALL
  USING (is_account_member(account_id, 'agent') AND can_see_unit(account_id, unit_id))
  WITH CHECK (is_account_member(account_id, 'agent') AND can_see_unit(account_id, unit_id));

-- resource_working_hours
DROP POLICY IF EXISTS working_hours_write ON resource_working_hours;
CREATE POLICY working_hours_write ON resource_working_hours FOR ALL
  USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));

-- resource_time_off
DROP POLICY IF EXISTS time_off_write ON resource_time_off;
CREATE POLICY time_off_write ON resource_time_off FOR ALL
  USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));
