-- 048_message_templates_unit.sql
-- Templates pertencem ao WABA (número) de uma unidade — um mesmo nome/idioma
-- pode existir por unidade. Adiciona unit_id, backfill p/ a unidade mais antiga
-- (Matriz), escopa RLS por can_see_unit e troca a unicidade p/ ser por unidade.
-- Idempotente.

-- 1) Coluna + backfill p/ a Matriz (unidade mais antiga da conta).
ALTER TABLE message_templates
  ADD COLUMN IF NOT EXISTS unit_id UUID REFERENCES unidades(id) ON DELETE CASCADE;

UPDATE message_templates t
SET unit_id = (
  SELECT u.id FROM unidades u
  WHERE u.account_id = t.account_id
  ORDER BY u.created_at ASC
  LIMIT 1
)
WHERE t.unit_id IS NULL;

ALTER TABLE message_templates ALTER COLUMN unit_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_message_templates_unit ON message_templates(unit_id);

-- 2) Unicidade por unidade. Substitui o índice antigo (user_id, name, language)
--    — o sync passa a dar upsert com onConflict nesse novo conjunto.
DROP INDEX IF EXISTS message_templates_user_name_language_key;
CREATE UNIQUE INDEX IF NOT EXISTS message_templates_unit_name_language_key
  ON message_templates(account_id, unit_id, name, language);

-- 3) RLS escopada por unidade: atendente vê só os templates da unidade dele;
--    admin+ veem todas. Escrita segue admin+ (settings-class, como na 017).
DROP POLICY IF EXISTS message_templates_select ON message_templates;
DROP POLICY IF EXISTS message_templates_insert ON message_templates;
DROP POLICY IF EXISTS message_templates_update ON message_templates;
DROP POLICY IF EXISTS message_templates_delete ON message_templates;
CREATE POLICY message_templates_select ON message_templates FOR SELECT
  USING (is_account_member(account_id) AND can_see_unit(account_id, unit_id));
CREATE POLICY message_templates_insert ON message_templates FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin') AND can_see_unit(account_id, unit_id));
CREATE POLICY message_templates_update ON message_templates FOR UPDATE
  USING (is_account_member(account_id, 'admin') AND can_see_unit(account_id, unit_id))
  WITH CHECK (is_account_member(account_id, 'admin') AND can_see_unit(account_id, unit_id));
CREATE POLICY message_templates_delete ON message_templates FOR DELETE
  USING (is_account_member(account_id, 'admin') AND can_see_unit(account_id, unit_id));
