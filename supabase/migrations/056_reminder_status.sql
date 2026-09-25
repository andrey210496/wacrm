-- ============================================================
-- 056 · Status visível do lembrete (Fase B.1).
--
-- appointment_reminders_sent passa a registrar TAMBÉM as falhas (antes só o
-- sucesso). Assim o atendente vê no card se o lembrete foi enviado ou falhou.
--   status: 'sent' (enviado) | 'failed' (falhou) | 'pending' (reivindicado, enviando)
--   error:  motivo da falha (quando failed)
-- Linhas antigas eram sempre sucesso → default 'sent'.
--
-- Aditivo / idempotente.
-- ============================================================

ALTER TABLE appointment_reminders_sent ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'sent'
  CHECK (status IN ('sent', 'failed', 'pending'));
ALTER TABLE appointment_reminders_sent ADD COLUMN IF NOT EXISTS error TEXT;
ALTER TABLE appointment_reminders_sent ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
