-- ===================== 040_unidades.sql =====================
-- 040_unidades.sql — the "unidade" (unit) tenancy level between accounts and data.
-- One account (client) has N unidades; each unidade owns one WhatsApp number and
-- its own lead pool. Idempotent.

CREATE TABLE IF NOT EXISTS unidades (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(account_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_unidades_account ON unidades(account_id);

ALTER TABLE unidades ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON unidades;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON unidades
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Members read; admins+ write (settings-class).
DROP POLICY IF EXISTS unidades_select ON unidades;
DROP POLICY IF EXISTS unidades_insert ON unidades;
DROP POLICY IF EXISTS unidades_update ON unidades;
DROP POLICY IF EXISTS unidades_delete ON unidades;
CREATE POLICY unidades_select ON unidades FOR SELECT USING (is_account_member(account_id));
CREATE POLICY unidades_insert ON unidades FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY unidades_update ON unidades FOR UPDATE USING (is_account_member(account_id, 'admin')) WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY unidades_delete ON unidades FOR DELETE USING (is_account_member(account_id, 'admin'));

-- ===================== 041_profiles_unit_scope.sql =====================
-- 041_profiles_unit_scope.sql — assign a user to a unit + the visibility helper.
-- owner/admin: unit_id irrelevant, they see ALL units (role >= admin).
-- agent/viewer: see ONLY rows whose unit_id == their profiles.unit_id.
-- An agent/viewer with NULL unit_id sees nothing until assigned (safe default).
-- Idempotent.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS unit_id UUID REFERENCES unidades(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_unit ON profiles(unit_id);

-- SECURITY DEFINER so RLS policy bodies can read profiles without recursion.
CREATE OR REPLACE FUNCTION can_see_unit(
  target_account_id UUID,
  target_unit_id UUID
) RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM profiles p
    WHERE p.user_id = auth.uid()
      AND p.account_id = target_account_id
      AND (
        CASE p.account_role
          WHEN 'owner'  THEN 4
          WHEN 'admin'  THEN 3
          WHEN 'agent'  THEN 2
          WHEN 'viewer' THEN 1
        END >= 3
        OR p.unit_id = target_unit_id
      )
  );
$$;

ALTER FUNCTION can_see_unit(UUID, UUID) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION can_see_unit(UUID, UUID) TO authenticated, service_role;

-- ===================== 042_whatsapp_config_unit.sql =====================
-- 042_whatsapp_config_unit.sql — one WhatsApp number PER UNIT (was per account).
-- Backfill: every existing account gets a "Matriz" unidade, and its existing
-- whatsapp_config row (if any) is linked to it. Keeps UNIQUE(phone_number_id)
-- global (webhook uses .single()). Idempotent.

-- 1) Column
ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS unit_id UUID REFERENCES unidades(id) ON DELETE CASCADE;

-- 2) Backfill: one "Matriz" unidade per account that has none yet.
INSERT INTO unidades (account_id, name, slug)
SELECT a.id, 'Matriz', 'matriz'
FROM accounts a
WHERE NOT EXISTS (SELECT 1 FROM unidades u WHERE u.account_id = a.id);

-- 3) Link existing configs to their account's Matriz (first unidade).
UPDATE whatsapp_config wc
SET unit_id = (
  SELECT u.id FROM unidades u
  WHERE u.account_id = wc.account_id
  ORDER BY u.created_at ASC
  LIMIT 1
)
WHERE wc.unit_id IS NULL;

-- 4) Swap the uniqueness: drop per-account, add per-unit.
ALTER TABLE whatsapp_config DROP CONSTRAINT IF EXISTS whatsapp_config_account_id_key;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_config_unit_id_key') THEN
    ALTER TABLE whatsapp_config ADD CONSTRAINT whatsapp_config_unit_id_key UNIQUE (unit_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_whatsapp_config_unit ON whatsapp_config(unit_id);

-- ===================== 043_operational_unit_id.sql =====================
-- 043_operational_unit_id.sql — stamp unit_id on every operational parent table.
-- Backfill points existing rows at the account's Matriz unidade. Idempotent.

ALTER TABLE contacts       ADD COLUMN IF NOT EXISTS unit_id UUID REFERENCES unidades(id) ON DELETE CASCADE;
ALTER TABLE conversations  ADD COLUMN IF NOT EXISTS unit_id UUID REFERENCES unidades(id) ON DELETE CASCADE;
ALTER TABLE deals          ADD COLUMN IF NOT EXISTS unit_id UUID REFERENCES unidades(id) ON DELETE CASCADE;
ALTER TABLE broadcasts     ADD COLUMN IF NOT EXISTS unit_id UUID REFERENCES unidades(id) ON DELETE CASCADE;
ALTER TABLE automations    ADD COLUMN IF NOT EXISTS unit_id UUID REFERENCES unidades(id) ON DELETE CASCADE;
ALTER TABLE flows          ADD COLUMN IF NOT EXISTS unit_id UUID REFERENCES unidades(id) ON DELETE CASCADE;

-- Backfill each table to the account's Matriz (oldest unidade of that account).
DO $$
DECLARE
  v_table TEXT;
  v_tables TEXT[] := ARRAY['contacts','conversations','deals','broadcasts','automations','flows'];
BEGIN
  FOREACH v_table IN ARRAY v_tables LOOP
    EXECUTE format($f$
      UPDATE %I t
      SET unit_id = (
        SELECT u.id FROM unidades u
        WHERE u.account_id = t.account_id
        ORDER BY u.created_at ASC LIMIT 1
      )
      WHERE t.unit_id IS NULL
    $f$, v_table);
  END LOOP;
END $$;

ALTER TABLE contacts       ALTER COLUMN unit_id SET NOT NULL;
ALTER TABLE conversations  ALTER COLUMN unit_id SET NOT NULL;
ALTER TABLE deals          ALTER COLUMN unit_id SET NOT NULL;
ALTER TABLE broadcasts     ALTER COLUMN unit_id SET NOT NULL;
ALTER TABLE automations    ALTER COLUMN unit_id SET NOT NULL;
ALTER TABLE flows          ALTER COLUMN unit_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_unit      ON contacts(unit_id);
CREATE INDEX IF NOT EXISTS idx_conversations_unit ON conversations(unit_id);
CREATE INDEX IF NOT EXISTS idx_deals_unit         ON deals(unit_id);
CREATE INDEX IF NOT EXISTS idx_broadcasts_unit    ON broadcasts(unit_id);
CREATE INDEX IF NOT EXISTS idx_automations_unit   ON automations(unit_id);
CREATE INDEX IF NOT EXISTS idx_flows_unit         ON flows(unit_id);

-- ===================== 044_contacts_unit_dedup.sql =====================
-- 044_contacts_unit_dedup.sql — the same phone can be a lead in two different
-- unidades (each keeps its own carteira), so dedup is now per (account, unit, phone).
-- Replaces the (account_id, phone_normalized) index from migration 022. Idempotent.

DROP INDEX IF EXISTS idx_contacts_account_phone_normalized;

CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_account_unit_phone_normalized
  ON contacts (account_id, unit_id, phone_normalized)
  WHERE phone_normalized <> '';

-- ===================== 045_rls_unit_scoping.sql =====================
-- 045_rls_unit_scoping.sql — agent/viewer see only their unit; admin+ see all.
-- Parent tables get an extra can_see_unit(account_id, unit_id) predicate;
-- child tables inherit the parent's unit via the existing join. Idempotent
-- (drop-then-create; migration owns these policy names).

-- ---- contacts ----
DROP POLICY IF EXISTS contacts_select ON contacts;
DROP POLICY IF EXISTS contacts_insert ON contacts;
DROP POLICY IF EXISTS contacts_update ON contacts;
DROP POLICY IF EXISTS contacts_delete ON contacts;
CREATE POLICY contacts_select ON contacts FOR SELECT
  USING (is_account_member(account_id) AND can_see_unit(account_id, unit_id));
CREATE POLICY contacts_insert ON contacts FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent') AND can_see_unit(account_id, unit_id));
CREATE POLICY contacts_update ON contacts FOR UPDATE
  USING (is_account_member(account_id, 'agent') AND can_see_unit(account_id, unit_id));
CREATE POLICY contacts_delete ON contacts FOR DELETE
  USING (is_account_member(account_id, 'agent') AND can_see_unit(account_id, unit_id));

-- ---- conversations ----
DROP POLICY IF EXISTS conversations_select ON conversations;
DROP POLICY IF EXISTS conversations_insert ON conversations;
DROP POLICY IF EXISTS conversations_update ON conversations;
DROP POLICY IF EXISTS conversations_delete ON conversations;
CREATE POLICY conversations_select ON conversations FOR SELECT
  USING (is_account_member(account_id) AND can_see_unit(account_id, unit_id));
CREATE POLICY conversations_insert ON conversations FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent') AND can_see_unit(account_id, unit_id));
CREATE POLICY conversations_update ON conversations FOR UPDATE
  USING (is_account_member(account_id, 'agent') AND can_see_unit(account_id, unit_id));
CREATE POLICY conversations_delete ON conversations FOR DELETE
  USING (is_account_member(account_id, 'agent') AND can_see_unit(account_id, unit_id));

-- ---- deals ----
DROP POLICY IF EXISTS deals_select ON deals;
DROP POLICY IF EXISTS deals_insert ON deals;
DROP POLICY IF EXISTS deals_update ON deals;
DROP POLICY IF EXISTS deals_delete ON deals;
CREATE POLICY deals_select ON deals FOR SELECT
  USING (is_account_member(account_id) AND can_see_unit(account_id, unit_id));
CREATE POLICY deals_insert ON deals FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent') AND can_see_unit(account_id, unit_id));
CREATE POLICY deals_update ON deals FOR UPDATE
  USING (is_account_member(account_id, 'agent') AND can_see_unit(account_id, unit_id));
CREATE POLICY deals_delete ON deals FOR DELETE
  USING (is_account_member(account_id, 'agent') AND can_see_unit(account_id, unit_id));

-- ---- broadcasts ----
DROP POLICY IF EXISTS broadcasts_select ON broadcasts;
DROP POLICY IF EXISTS broadcasts_insert ON broadcasts;
DROP POLICY IF EXISTS broadcasts_update ON broadcasts;
DROP POLICY IF EXISTS broadcasts_delete ON broadcasts;
CREATE POLICY broadcasts_select ON broadcasts FOR SELECT
  USING (is_account_member(account_id) AND can_see_unit(account_id, unit_id));
CREATE POLICY broadcasts_insert ON broadcasts FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent') AND can_see_unit(account_id, unit_id));
CREATE POLICY broadcasts_update ON broadcasts FOR UPDATE
  USING (is_account_member(account_id, 'agent') AND can_see_unit(account_id, unit_id));
CREATE POLICY broadcasts_delete ON broadcasts FOR DELETE
  USING (is_account_member(account_id, 'agent') AND can_see_unit(account_id, unit_id));

-- ---- automations ----
DROP POLICY IF EXISTS automations_select ON automations;
DROP POLICY IF EXISTS automations_insert ON automations;
DROP POLICY IF EXISTS automations_update ON automations;
DROP POLICY IF EXISTS automations_delete ON automations;
CREATE POLICY automations_select ON automations FOR SELECT
  USING (is_account_member(account_id) AND can_see_unit(account_id, unit_id));
CREATE POLICY automations_insert ON automations FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent') AND can_see_unit(account_id, unit_id));
CREATE POLICY automations_update ON automations FOR UPDATE
  USING (is_account_member(account_id, 'agent') AND can_see_unit(account_id, unit_id));
CREATE POLICY automations_delete ON automations FOR DELETE
  USING (is_account_member(account_id, 'agent') AND can_see_unit(account_id, unit_id));

-- ---- flows ----
DROP POLICY IF EXISTS flows_select ON flows;
DROP POLICY IF EXISTS flows_insert ON flows;
DROP POLICY IF EXISTS flows_update ON flows;
DROP POLICY IF EXISTS flows_delete ON flows;
CREATE POLICY flows_select ON flows FOR SELECT
  USING (is_account_member(account_id) AND can_see_unit(account_id, unit_id));
CREATE POLICY flows_insert ON flows FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent') AND can_see_unit(account_id, unit_id));
CREATE POLICY flows_update ON flows FOR UPDATE
  USING (is_account_member(account_id, 'agent') AND can_see_unit(account_id, unit_id));
CREATE POLICY flows_delete ON flows FOR DELETE
  USING (is_account_member(account_id, 'agent') AND can_see_unit(account_id, unit_id));

-- ---- messages (child of conversations) ----
DROP POLICY IF EXISTS messages_select ON messages;
DROP POLICY IF EXISTS messages_modify ON messages;
CREATE POLICY messages_select ON messages FOR SELECT USING (
  EXISTS (SELECT 1 FROM conversations c WHERE c.id = messages.conversation_id
          AND is_account_member(c.account_id) AND can_see_unit(c.account_id, c.unit_id))
);
CREATE POLICY messages_modify ON messages FOR ALL USING (
  EXISTS (SELECT 1 FROM conversations c WHERE c.id = messages.conversation_id
          AND is_account_member(c.account_id, 'agent') AND can_see_unit(c.account_id, c.unit_id))
) WITH CHECK (
  EXISTS (SELECT 1 FROM conversations c WHERE c.id = messages.conversation_id
          AND is_account_member(c.account_id, 'agent') AND can_see_unit(c.account_id, c.unit_id))
);

-- ---- contact_tags (child of contacts) ----
DROP POLICY IF EXISTS contact_tags_select ON contact_tags;
DROP POLICY IF EXISTS contact_tags_modify ON contact_tags;
CREATE POLICY contact_tags_select ON contact_tags FOR SELECT USING (
  EXISTS (SELECT 1 FROM contacts c WHERE c.id = contact_tags.contact_id
          AND is_account_member(c.account_id) AND can_see_unit(c.account_id, c.unit_id))
);
CREATE POLICY contact_tags_modify ON contact_tags FOR ALL USING (
  EXISTS (SELECT 1 FROM contacts c WHERE c.id = contact_tags.contact_id
          AND is_account_member(c.account_id, 'agent') AND can_see_unit(c.account_id, c.unit_id))
) WITH CHECK (
  EXISTS (SELECT 1 FROM contacts c WHERE c.id = contact_tags.contact_id
          AND is_account_member(c.account_id, 'agent') AND can_see_unit(c.account_id, c.unit_id))
);

-- ---- contact_custom_values (child of contacts) ----
DROP POLICY IF EXISTS contact_custom_values_select ON contact_custom_values;
DROP POLICY IF EXISTS contact_custom_values_modify ON contact_custom_values;
CREATE POLICY contact_custom_values_select ON contact_custom_values FOR SELECT USING (
  EXISTS (SELECT 1 FROM contacts c WHERE c.id = contact_custom_values.contact_id
          AND is_account_member(c.account_id) AND can_see_unit(c.account_id, c.unit_id))
);
CREATE POLICY contact_custom_values_modify ON contact_custom_values FOR ALL USING (
  EXISTS (SELECT 1 FROM contacts c WHERE c.id = contact_custom_values.contact_id
          AND is_account_member(c.account_id, 'agent') AND can_see_unit(c.account_id, c.unit_id))
) WITH CHECK (
  EXISTS (SELECT 1 FROM contacts c WHERE c.id = contact_custom_values.contact_id
          AND is_account_member(c.account_id, 'agent') AND can_see_unit(c.account_id, c.unit_id))
);

-- ---- contact_notes (carries account_id directly; also has contact_id) ----
DROP POLICY IF EXISTS contact_notes_select ON contact_notes;
DROP POLICY IF EXISTS contact_notes_insert ON contact_notes;
DROP POLICY IF EXISTS contact_notes_update ON contact_notes;
DROP POLICY IF EXISTS contact_notes_delete ON contact_notes;
CREATE POLICY contact_notes_select ON contact_notes FOR SELECT USING (
  EXISTS (SELECT 1 FROM contacts c WHERE c.id = contact_notes.contact_id
          AND is_account_member(c.account_id) AND can_see_unit(c.account_id, c.unit_id))
);
CREATE POLICY contact_notes_insert ON contact_notes FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM contacts c WHERE c.id = contact_notes.contact_id
          AND is_account_member(c.account_id, 'agent') AND can_see_unit(c.account_id, c.unit_id))
);
CREATE POLICY contact_notes_update ON contact_notes FOR UPDATE USING (
  EXISTS (SELECT 1 FROM contacts c WHERE c.id = contact_notes.contact_id
          AND is_account_member(c.account_id, 'agent') AND can_see_unit(c.account_id, c.unit_id))
);
CREATE POLICY contact_notes_delete ON contact_notes FOR DELETE USING (
  EXISTS (SELECT 1 FROM contacts c WHERE c.id = contact_notes.contact_id
          AND is_account_member(c.account_id, 'agent') AND can_see_unit(c.account_id, c.unit_id))
);

-- ---- broadcast_recipients (child of broadcasts) ----
DROP POLICY IF EXISTS broadcast_recipients_select ON broadcast_recipients;
DROP POLICY IF EXISTS broadcast_recipients_modify ON broadcast_recipients;
CREATE POLICY broadcast_recipients_select ON broadcast_recipients FOR SELECT USING (
  EXISTS (SELECT 1 FROM broadcasts b WHERE b.id = broadcast_recipients.broadcast_id
          AND is_account_member(b.account_id) AND can_see_unit(b.account_id, b.unit_id))
);
CREATE POLICY broadcast_recipients_modify ON broadcast_recipients FOR ALL USING (
  EXISTS (SELECT 1 FROM broadcasts b WHERE b.id = broadcast_recipients.broadcast_id
          AND is_account_member(b.account_id, 'agent') AND can_see_unit(b.account_id, b.unit_id))
) WITH CHECK (
  EXISTS (SELECT 1 FROM broadcasts b WHERE b.id = broadcast_recipients.broadcast_id
          AND is_account_member(b.account_id, 'agent') AND can_see_unit(b.account_id, b.unit_id))
);

-- ---- message_reactions (grandchild: reaction -> message -> conversation) ----
DROP POLICY IF EXISTS message_reactions_select ON message_reactions;
DROP POLICY IF EXISTS message_reactions_modify ON message_reactions;
CREATE POLICY message_reactions_select ON message_reactions FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE m.id = message_reactions.message_id
      AND is_account_member(c.account_id) AND can_see_unit(c.account_id, c.unit_id)
  )
);
CREATE POLICY message_reactions_modify ON message_reactions FOR ALL USING (
  EXISTS (
    SELECT 1 FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE m.id = message_reactions.message_id
      AND is_account_member(c.account_id, 'agent') AND can_see_unit(c.account_id, c.unit_id)
  )
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE m.id = message_reactions.message_id
      AND is_account_member(c.account_id, 'agent') AND can_see_unit(c.account_id, c.unit_id)
  )
);

-- ===================== 046_license_state.sql =====================
-- 046_license_state.sql — single-row local license state for this SILO instance.
-- The control plane (SP2) flips `status` via /api/license/apply. Fail-open: the
-- app reads the last known value; if the row is missing it treats the instance
-- as active. Idempotent.

CREATE TABLE IF NOT EXISTS license_state (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),   -- singleton row (id is always true)
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  reason TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO license_state (id, status) VALUES (true, 'active')
ON CONFLICT (id) DO NOTHING;

-- Only the service role touches this table (server routes). No client RLS policy.
ALTER TABLE license_state ENABLE ROW LEVEL SECURITY;

