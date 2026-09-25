-- 044_contacts_unit_dedup.sql — the same phone can be a lead in two different
-- unidades (each keeps its own carteira), so dedup is now per (account, unit, phone).
-- Replaces the (account_id, phone_normalized) index from migration 022. Idempotent.

DROP INDEX IF EXISTS idx_contacts_account_phone_normalized;

CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_account_unit_phone_normalized
  ON contacts (account_id, unit_id, phone_normalized)
  WHERE phone_normalized <> '';
