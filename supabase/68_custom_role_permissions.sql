-- Custom role permissions
-- Stores configurable permission toggles for each custom role created by the admin.

CREATE TABLE IF NOT EXISTS custom_role_permissions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  custom_role_id UUID NOT NULL REFERENCES custom_roles(id) ON DELETE CASCADE,
  permission_key VARCHAR NOT NULL,
  enabled        BOOLEAN NOT NULL DEFAULT true,
  updated_by     UUID REFERENCES profiles(id),
  updated_at     TIMESTAMPTZ DEFAULT now(),
  UNIQUE (custom_role_id, permission_key)
);

-- RLS: admin can read and write; others can read (UI needs to check these)
ALTER TABLE custom_role_permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS crp_admin_all ON custom_role_permissions;
DROP POLICY IF EXISTS crp_read_all ON custom_role_permissions;

CREATE POLICY crp_admin_all ON custom_role_permissions
  FOR ALL
  USING (get_user_role(auth.uid()) = 'admin')
  WITH CHECK (get_user_role(auth.uid()) = 'admin');

CREATE POLICY crp_read_all ON custom_role_permissions
  FOR SELECT
  USING (get_user_role(auth.uid()) IN ('admin', 'staff', 'member', 'board'));
