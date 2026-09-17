-- ===================== 047_unit_isolation_hardening.sql =====================
-- 047_unit_isolation_hardening.sql
-- Fecha as brechas de isolamento por unidade encontradas na auditoria e
-- conserta o envio de transmissão sob a coluna unit_id NOT NULL. Idempotente.

-- 1) whatsapp_config: SELECT escopado por unidade — um atendente só enxerga a
--    config (número/status) da unidade dele; admin+ veem todas (can_see_unit
--    retorna true para role >= admin). Writes seguem admin+ (inalterado na 017).
DROP POLICY IF EXISTS whatsapp_config_select ON whatsapp_config;
CREATE POLICY whatsapp_config_select ON whatsapp_config FOR SELECT
  USING (is_account_member(account_id) AND can_see_unit(account_id, unit_id));

-- 2) unidades: atendente/visualizador enxerga só a própria unidade; admin+ todas.
--    (aqui o "unit alvo" do can_see_unit é o próprio id da linha.)
DROP POLICY IF EXISTS unidades_select ON unidades;
CREATE POLICY unidades_select ON unidades FOR SELECT
  USING (is_account_member(account_id) AND can_see_unit(account_id, id));

-- 3) whatsapp_config.unit_id NOT NULL — toda config pertence a uma unidade.
--    Todas as linhas foram preenchidas na 042 e a rota de config passou a
--    exigir unitId em toda escrita; isto trava contra uma config órfã.
ALTER TABLE whatsapp_config ALTER COLUMN unit_id SET NOT NULL;

-- 4) create_broadcast_with_recipients: inseria broadcasts SEM unit_id, que é
--    NOT NULL desde a 043 — todo envio quebrava com 23502. Adiciona p_unit_id
--    e carimba. Só service_role chama (REVOKE de authenticated/anon).
--    DROP da assinatura antiga (8 args) antes de recriar com 9.
DROP FUNCTION IF EXISTS public.create_broadcast_with_recipients(
  UUID, UUID, TEXT, TEXT, TEXT, INTEGER, UUID[], JSONB[]
);

CREATE OR REPLACE FUNCTION public.create_broadcast_with_recipients(
  p_account_id        UUID,
  p_unit_id           UUID,
  p_user_id           UUID,
  p_name              TEXT,
  p_template_name     TEXT,
  p_template_language TEXT,
  p_total_recipients  INTEGER,
  p_contact_ids       UUID[],
  p_template_params   JSONB[]
)
RETURNS TABLE(broadcast_id UUID, recipient_id UUID, contact_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_broadcast_id UUID;
BEGIN
  INSERT INTO broadcasts (
    account_id, unit_id, user_id, name, template_name,
    template_language, status, total_recipients
  )
  VALUES (
    p_account_id, p_unit_id, p_user_id, p_name, p_template_name,
    p_template_language, 'sending', p_total_recipients
  )
  RETURNING id INTO v_broadcast_id;

  RETURN QUERY
  WITH ins AS (
    INSERT INTO broadcast_recipients (broadcast_id, contact_id, status, template_params)
    SELECT v_broadcast_id, t.cid, 'pending', t.prm
    FROM unnest(p_contact_ids, p_template_params) AS t(cid, prm)
    RETURNING id, contact_id
  )
  SELECT v_broadcast_id, ins.id, ins.contact_id
  FROM ins;
END;
$$;

REVOKE ALL ON FUNCTION public.create_broadcast_with_recipients(UUID, UUID, UUID, TEXT, TEXT, TEXT, INTEGER, UUID[], JSONB[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_broadcast_with_recipients(UUID, UUID, UUID, TEXT, TEXT, TEXT, INTEGER, UUID[], JSONB[]) FROM anon;
REVOKE ALL ON FUNCTION public.create_broadcast_with_recipients(UUID, UUID, UUID, TEXT, TEXT, TEXT, INTEGER, UUID[], JSONB[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.create_broadcast_with_recipients(UUID, UUID, UUID, TEXT, TEXT, TEXT, INTEGER, UUID[], JSONB[]) TO service_role;

-- ===================== 048_message_templates_unit.sql =====================
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

