-- 041_profiles_unit_scope.sql — assign a user to a unit + the visibility helper.
-- owner/admin: unit_id irrelevant, they see ALL units (role >= admin).
-- agent/viewer: see ONLY rows whose unit_id == their profiles.unit_id.
-- An agent/viewer with NULL unit_id sees nothing until assigned (safe default).
-- Idempotent.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS unit_id UUID REFERENCES unidades(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_unit ON profiles(unit_id);

-- SECURITY DEFINER so RLS policy bodies can read profiles without recursion.
CREATE OR REPLACE FUNCTION can_see_unit(
  target_account_id UUID,
  target_unit_id UUID
) RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM profiles p
    WHERE p.user_id = auth.uid()
      AND p.account_id = target_account_id
      AND (
        CASE p.account_role
          WHEN 'owner'  THEN 4
          WHEN 'admin'  THEN 3
          WHEN 'agent'  THEN 2
          WHEN 'viewer' THEN 1
        END >= 3
        OR p.unit_id = target_unit_id
      )
  );
$$;

ALTER FUNCTION can_see_unit(UUID, UUID) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION can_see_unit(UUID, UUID) TO authenticated, service_role;
