-- ============================================================
-- 049 · Dead-letter de inbound do WhatsApp.
--
-- O webhook/relay SEMPRE responde 200 pra Meta (pra ela não re-tentar em loop),
-- então qualquer evento que o processamento descartava (`continue`) era perdido
-- de forma DEFINITIVA: erro transitório de banco, número sem config (provisão
-- quebrada), config duplicado, ou mensagem sem contato (BSUID/username).
--
-- Esta tabela guarda o evento cru + motivo ANTES do descarte, para não perder
-- nada e permitir reprocessamento idempotente (o dedup por message_id já existe)
-- e alerta no painel.
--
-- Idempotente — seguro rodar múltiplas vezes.
-- ============================================================

CREATE TABLE IF NOT EXISTS whatsapp_inbound_deadletter (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  -- Chave de idempotência: hash de (phone_number_id + ids das mensagens do
  -- evento). Impede duplicar a linha quando o MESMO evento cai na dead-letter
  -- de novo (Meta reenviando, ou um reprocesso que ainda falha). UNIQUE.
  idempotency_key TEXT NOT NULL UNIQUE,
  phone_number_id TEXT,
  raw_event       JSONB NOT NULL, -- o `value` da mudança (metadata + messages + contacts)
  reason          TEXT NOT NULL CHECK (
                    reason IN ('no_contacts', 'db_error', 'no_config', 'multiple_configs', 'parse_error')
                  ),
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (
                    status IN ('pending', 'reprocessed', 'failed', 'ignored')
                  ),
  attempts        INT NOT NULL DEFAULT 0,
  last_error      TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deadletter_status  ON whatsapp_inbound_deadletter(status);
CREATE INDEX IF NOT EXISTS idx_deadletter_created ON whatsapp_inbound_deadletter(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deadletter_pnid    ON whatsapp_inbound_deadletter(phone_number_id);

-- RLS ligada SEM policy = deny-all para anon/authenticated. O acesso é só via
-- service-role (o processamento do webhook e o worker de retry usam o admin
-- client, que ignora RLS) e via rota admin do servidor. Nunca exposto ao browser.
ALTER TABLE whatsapp_inbound_deadletter ENABLE ROW LEVEL SECURITY;
