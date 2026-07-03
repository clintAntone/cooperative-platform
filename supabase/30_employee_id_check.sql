-- Allows unauthenticated users (the register page) to check whether an
-- employee_id is already taken without exposing any profile data.
-- Returns TRUE if the employee_id is available, FALSE if already registered.
CREATE OR REPLACE FUNCTION is_employee_id_available(p_employee_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM profiles WHERE employee_id = p_employee_id
  );
$$;

-- Allow the anon role to call this function (needed on the register page)
GRANT EXECUTE ON FUNCTION is_employee_id_available(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION is_employee_id_available(TEXT) TO authenticated;
