-- Migration 53: SECURITY DEFINER RPC so members can fetch the active member list
-- for the share transfer recipient dropdown (direct profiles query is blocked by RLS).

CREATE OR REPLACE FUNCTION get_active_members_for_transfer()
RETURNS TABLE(id UUID, full_name VARCHAR, employee_id VARCHAR) AS $$
BEGIN
  RETURN QUERY
  SELECT p.id, p.full_name, p.employee_id
  FROM profiles p
  WHERE p.id != auth.uid()
    AND p.role = 'member'
    AND p.account_status = 'active'
  ORDER BY p.full_name;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_active_members_for_transfer() TO authenticated;
