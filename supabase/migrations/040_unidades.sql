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
