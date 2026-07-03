-- Admin user management functions and view
-- Run this after 07_rls_policies.sql

-- Secure function to list all users (includes email from auth.users)
-- SECURITY DEFINER runs as the function owner (postgres), bypassing RLS on auth.users
CREATE OR REPLACE FUNCTION get_all_users_for_admin()
RETURNS TABLE (
  id              UUID,
  full_name       VARCHAR,
  phone           VARCHAR,
  role            VARCHAR,
  account_status  VARCHAR,
  email           VARCHAR,
  membership_status VARCHAR,
  completed_shares  INT,
  created_at      TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin', 'staff') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.full_name,
    p.phone,
    p.role,
    p.account_status,
    u.email::VARCHAR,
    ms.status::VARCHAR       AS membership_status,
    ms.completed_shares,
    p.created_at
  FROM profiles p
  LEFT JOIN auth.users u ON u.id = p.id
  LEFT JOIN membership_status ms ON ms.user_id = p.id
  ORDER BY p.created_at DESC;
END;
$$;

-- Grant execute to authenticated users (the function itself checks role internally)
GRANT EXECUTE ON FUNCTION get_all_users_for_admin() TO authenticated;

-- Secure function for admins to update a user's role
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

  IF p_new_role NOT IN ('admin', 'staff', 'member') THEN
    RAISE EXCEPTION 'Invalid role: %', p_new_role;
  END IF;

  UPDATE profiles
  SET role = p_new_role, updated_at = now()
  WHERE id = p_target_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_update_user_role(UUID, VARCHAR) TO authenticated;

-- Secure function for admins/staff to update a user's account status
CREATE OR REPLACE FUNCTION admin_update_user_status(
  p_target_user_id UUID,
  p_new_status      VARCHAR
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin', 'staff') THEN
    RAISE EXCEPTION 'Only admins or staff can change account status';
  END IF;

  IF p_new_status NOT IN ('active', 'suspended', 'inactive') THEN
    RAISE EXCEPTION 'Invalid status: %', p_new_status;
  END IF;

  UPDATE profiles
  SET account_status = p_new_status, updated_at = now()
  WHERE id = p_target_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_update_user_status(UUID, VARCHAR) TO authenticated;
