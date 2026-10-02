-- ============================================================
-- 052 · Frente 2: canal híbrido "Conexão redezap" (por unidade) + marca de canal.
--
-- Entrada sempre oficial; uma % das mensagens COBRÁVEIS vai pela uazapi (R$0
-- Meta), intercalada a cada 100. Config por unidade + contador de interleave.
-- `messages.channel` marca por onde a mensagem saiu (alimenta o painel de consumo).
--
-- Aditivo / idempotente. Default DESLIGADO — comportamento atual intacto.
-- ============================================================

CREATE TABLE IF NOT EXISTS channel_hybrid_config (
  unit_id            UUID PRIMARY KEY REFERENCES unidades(id) ON DELETE CASCADE,
  account_id         UUID NOT NULL,
  hybrid_enabled     BOOLEAN NOT NULL DEFAULT false,
  uazapi_pct         INT NOT NULL DEFAULT 0 CHECK (uazapi_pct BETWEEN 0 AND 100),
  billable_mode      TEXT NOT NULL DEFAULT 'auto' CHECK (billable_mode IN ('auto','always','template_only')),
  interleave_counter BIGINT NOT NULL DEFAULT 0,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS deny-all: acesso via rota admin server-side + supabaseAdmin (padrão das
-- tarifas da 051). O envio lê a config via service-role.
ALTER TABLE channel_hybrid_config ENABLE ROW LEVEL SECURITY;

-- Marca de canal na mensagem (default oficial mantém o comportamento atual).
ALTER TABLE messages ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'official';

-- Incremento ATÔMICO do contador de interleave. Devolve o valor PRÉ-incremento
-- (0-based). Se a unidade ainda não tem config, devolve 0.
CREATE OR REPLACE FUNCTION next_interleave_counter(p_unit UUID)
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
  n BIGINT;
BEGIN
  UPDATE channel_hybrid_config
     SET interleave_counter = interleave_counter + 1
   WHERE unit_id = p_unit
   RETURNING interleave_counter - 1 INTO n;
  RETURN COALESCE(n, 0);
END;
$$;
