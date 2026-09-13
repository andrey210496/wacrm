-- ============================================================
-- 055 · Frente 5 (Fase C) — Autoagendamento público.
--
-- Estende scheduling_config com o link público (slug aleatório) + janelas.
-- Aditivo / idempotente.
-- ============================================================

ALTER TABLE scheduling_config ADD COLUMN IF NOT EXISTS public_booking_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE scheduling_config ADD COLUMN IF NOT EXISTS public_slug            TEXT;
ALTER TABLE scheduling_config ADD COLUMN IF NOT EXISTS public_lead_time_min   INT NOT NULL DEFAULT 120;
ALTER TABLE scheduling_config ADD COLUMN IF NOT EXISTS public_window_days     INT NOT NULL DEFAULT 30;

-- Slug único global (não enumerável) — usado na URL pública. NULL permitido
-- (só existe quando o autoagendamento é ligado).
CREATE UNIQUE INDEX IF NOT EXISTS idx_scheduling_public_slug
  ON scheduling_config(public_slug) WHERE public_slug IS NOT NULL;
