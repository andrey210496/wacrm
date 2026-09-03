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
