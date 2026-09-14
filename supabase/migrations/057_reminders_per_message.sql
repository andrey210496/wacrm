-- ============================================================
-- 057 · Mensagem por lembrete (Fase B.2).
--
-- scheduling_config.reminders = lista JSONB [{offset_min, text, enabled}]:
-- cada lembrete com a SUA antecedência e o SEU texto (e liga/desliga). Quando
-- vazio/null, o worker cai no modelo antigo (reminder_offsets_min + reminder_text).
--
-- Aditivo / idempotente.
-- ============================================================

ALTER TABLE scheduling_config ADD COLUMN IF NOT EXISTS reminders JSONB;
