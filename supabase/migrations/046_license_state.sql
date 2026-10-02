-- 046_license_state.sql — single-row local license state for this SILO instance.
-- The control plane (SP2) flips `status` via /api/license/apply. Fail-open: the
-- app reads the last known value; if the row is missing it treats the instance
-- as active. Idempotent.

CREATE TABLE IF NOT EXISTS license_state (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),   -- singleton row (id is always true)
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  reason TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO license_state (id, status) VALUES (true, 'active')
ON CONFLICT (id) DO NOTHING;

-- Only the service role touches this table (server routes). No client RLS policy.
ALTER TABLE license_state ENABLE ROW LEVEL SECURITY;
