-- Deploy B+C — migrations 050 (BSUID/usernames) + 051 (cobrança).
-- Cole INTEIRO no SQL Editor do Supabase da Pure Pilates. Aditivo/idempotente.

-- ===== 050 =====
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

-- ===== 051 =====
-- ============================================================
-- 051 · Consciência de cobrança (Feature C).
--
-- A partir do per-message pricing (Meta, jul/2025), cada mensagem enviada tem
-- categoria (marketing/utility/authentication/service) e um flag de cobrável.
-- A Meta manda isso no webhook de STATUS (statuses[].pricing) — a fonte da
-- verdade do que é cobrado. Também: conversa iniciada por anúncio (referral)
-- abre janela grátis de 72h, e a janela de atendimento de 24h define quando dá
-- pra mandar free-form.
--
-- Guardamos: pricing por mensagem (do status), referral + last_inbound_at por
-- conversa, e uma tabela de TARIFAS configurável/versionada (o custo em R$ é
-- estimado = mensagens cobráveis × tarifa da categoria vigente; os números
-- exatos vêm do rate card da Meta e o operador mantém).
--
-- Idempotente / aditivo.
-- ============================================================

-- Pricing por mensagem (preenchido pelo webhook de status).
ALTER TABLE messages ADD COLUMN IF NOT EXISTS pricing_category TEXT;   -- marketing|utility|authentication|service|referral_conversion
ALTER TABLE messages ADD COLUMN IF NOT EXISTS pricing_billable BOOLEAN;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS pricing_model    TEXT;   -- ex.: PMP (per-message)
ALTER TABLE messages ADD COLUMN IF NOT EXISTS pricing_type     TEXT;   -- ex.: regular, free_customer_service, free_entry_point

CREATE INDEX IF NOT EXISTS idx_messages_pricing_category ON messages(pricing_category);

-- Referral (Click-to-WhatsApp) + janela de atendimento por conversa.
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS referral        JSONB;       -- source_type, source_id, headline, source_url, ctwa_clid...
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS referral_at     TIMESTAMPTZ; -- quando a conversa veio do anúncio (base da janela grátis de 72h)
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS last_inbound_at TIMESTAMPTZ; -- último inbound (base da janela de 24h)

-- Tabela de tarifas versionada (configurável pelo operador). O custo é estimado.
CREATE TABLE IF NOT EXISTS whatsapp_pricing_rates (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  category       TEXT NOT NULL CHECK (category IN ('marketing', 'utility', 'authentication')),
  currency       TEXT NOT NULL DEFAULT 'BRL',
  price          NUMERIC(12, 6) NOT NULL,       -- por mensagem
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to   DATE,                          -- NULL = vigente
  created_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pricing_rates_category ON whatsapp_pricing_rates(category, effective_from DESC);

-- Seed de PLACEHOLDER (o operador ajusta com o rate card real da Meta/BR). Valor
-- 0 propositalmente — o painel mostra "tarifa não configurada" até ser editado,
-- em vez de exibir um custo inventado.
INSERT INTO whatsapp_pricing_rates (category, currency, price, effective_from)
SELECT c, 'BRL', 0, CURRENT_DATE
FROM (VALUES ('marketing'), ('utility'), ('authentication')) AS t(c)
WHERE NOT EXISTS (
  SELECT 1 FROM whatsapp_pricing_rates r WHERE r.category = t.c
);

-- RLS: tarifas são config de conta; leitura por membro, escrita por admin+.
-- (Reusa o padrão de is_account_member se existir; senão RLS deny-all + rota
-- admin. Aqui deixamos deny-all — o painel lê/edita via rota admin server-side.)
ALTER TABLE whatsapp_pricing_rates ENABLE ROW LEVEL SECURITY;
