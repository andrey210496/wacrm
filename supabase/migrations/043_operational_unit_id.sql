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
