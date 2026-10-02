-- 059 · Coexistence self-service. Migration ADITIVA: marca como cada número foi
-- conectado. 'manual' = token colado no formulário; 'coex' = Embedded Signup
-- Coexistence (número segue no app WhatsApp Business + Cloud API). Default
-- 'manual' preserva as linhas existentes. Não toca em mais nada.

ALTER TABLE public.whatsapp_config
  ADD COLUMN IF NOT EXISTS connection_type text NOT NULL DEFAULT 'manual';

COMMENT ON COLUMN public.whatsapp_config.connection_type IS
  'Como o número foi conectado: manual (token) | coex (Embedded Signup Coexistence).';
