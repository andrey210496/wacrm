-- ============================================================
-- 050 · BSUID / usernames em contacts.
--
-- A Meta está lançando usernames do WhatsApp (2026). Desde ~abril/2026 toda
-- webhook de mensagem traz `contacts[].user_id` (BSUID, formato "BR.xxxx",
-- escopo por portfólio) — SEMPRE presente — e o telefone (`wa_id`/`from`) só
-- aparece se houve interação nos últimos 30 dias ou o usuário está na agenda.
-- Um usuário com username que esconde o número manda inbound SEM telefone.
--
-- Para não perder esses leads nem perder a identidade:
--   1. `bsuid` (identidade estável do usuário-empresa) e `username` (opcional).
--   2. `phone` passa a ser NULLABLE (contato só-BSUID não tem telefone).
--   3. UNIQUE parcial por (account, unit, bsuid) quando há bsuid.
--
-- Idempotente / aditivo. A coluna gerada `phone_normalized` trata phone NULL
-- (vira NULL) e o índice unique dela é parcial (WHERE phone_normalized <> ''),
-- então contatos só-BSUID não colidem.
-- ============================================================

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS bsuid    TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS username TEXT;

-- Telefone opcional (usuário escondeu o número via username).
ALTER TABLE contacts ALTER COLUMN phone DROP NOT NULL;

-- Unicidade do BSUID por conta+unidade (só quando há bsuid — igual à carteira
-- por unidade do telefone, migration 044).
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_account_unit_bsuid
  ON contacts (account_id, unit_id, bsuid)
  WHERE bsuid IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_bsuid
  ON contacts (bsuid)
  WHERE bsuid IS NOT NULL;
