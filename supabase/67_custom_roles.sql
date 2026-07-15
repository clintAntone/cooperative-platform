-- Custom roles: admin-defined organizational labels for members
CREATE TABLE IF NOT EXISTS custom_roles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(50) NOT NULL UNIQUE,
  color       VARCHAR(20) NOT NULL DEFAULT 'gray',  -- tailwind color name: gray, blue, green, purple, red, yellow, orange, pink
  description TEXT,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- Each profile can have one custom role (organizational title, not access control)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS custom_role_id UUID REFERENCES custom_roles(id) ON DELETE SET NULL;

-- RLS
ALTER TABLE custom_roles ENABLE ROW LEVEL SECURITY;

-- Everyone authenticated can read custom roles
CREATE POLICY custom_roles_read ON custom_roles
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- Only admin/staff can manage custom roles
CREATE POLICY custom_roles_admin ON custom_roles
  FOR ALL USING (get_user_role(auth.uid()) IN ('admin', 'staff'));

-- Remove collector from the role constraint
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('admin', 'member', 'staff', 'board'));

-- Update any existing collector profiles to member
UPDATE profiles SET role = 'member' WHERE role = 'collector';

-- Update admin_update_user_role to not accept collector
CREATE OR REPLACE FUNCTION admin_update_user_role(
  p_target_user_id UUID,
  p_new_role        VARCHAR
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF get_user_role(auth.uid()) != 'admin' THEN
    RAISE EXCEPTION 'Only admins can change user roles';
  END IF;
  IF p_new_role NOT IN ('admin', 'staff', 'member', 'board') THEN
    RAISE EXCEPTION 'Invalid role: %', p_new_role;
  END IF;
  UPDATE profiles SET role = p_new_role, updated_at = now()
  WHERE id = p_target_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_update_user_role(UUID, VARCHAR) TO authenticated;

-- RPC: assign or clear custom role for a member
CREATE OR REPLACE FUNCTION admin_assign_custom_role(
  p_user_id UUID,
  p_custom_role_id UUID  -- pass NULL to clear
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin', 'staff') THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;
  UPDATE profiles SET custom_role_id = p_custom_role_id, updated_at = now()
  WHERE id = p_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_assign_custom_role(UUID, UUID) TO authenticated;
