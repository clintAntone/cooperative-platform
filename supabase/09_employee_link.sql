-- Employee link functions
-- employee_id column is defined in 02_users_and_roles.sql
-- Run this after 08_admin_user_view.sql

-- Allow admins/staff to link a profile to an employee_id
CREATE OR REPLACE FUNCTION admin_link_employee(
  p_profile_id  UUID,
  p_employee_id VARCHAR
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin', 'staff') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  UPDATE profiles
  SET employee_id = p_employee_id, updated_at = now()
  WHERE id = p_profile_id;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_link_employee(UUID, VARCHAR) TO authenticated;
