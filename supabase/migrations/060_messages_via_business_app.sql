-- 060 · Coex Fase 2. Migration ADITIVA: marca mensagens que vieram do app
-- WhatsApp Business (Coexistence) — echoes (o negócio digitou no app) e history
-- do lado do negócio. sender_type segue 'customer'/'agent'; esta flag só permite
-- o inbox mostrar "enviada pelo app". Default false preserva as linhas atuais.

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS via_business_app boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.messages.via_business_app IS
  'true quando a mensagem veio do app WhatsApp Business (coex: echo ou history do negócio).';
