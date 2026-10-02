-- 062 · Marca de mensagem EDITADA. Migration ADITIVA: quando o negócio edita
-- uma mensagem já enviada pelo app WhatsApp Business (Coexistence, echo
-- type='edit'), atualizamos o conteúdo da mensagem original e carimbamos
-- `edited_at` — a bolha do inbox mostra o rótulo "editada". NULL = não editada
-- (preserva as mensagens atuais).

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS edited_at timestamptz;

COMMENT ON COLUMN public.messages.edited_at IS
  'Quando a mensagem foi editada (coex edit echo). NULL = nunca editada; dirige o rótulo "editada" na bolha do inbox.';
