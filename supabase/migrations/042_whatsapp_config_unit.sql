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
