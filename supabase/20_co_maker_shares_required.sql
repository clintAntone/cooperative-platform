-- Co-makers must also have at least one completed equity share to be eligible

CREATE OR REPLACE FUNCTION get_eligible_co_makers()
RETURNS TABLE(id UUID, full_name VARCHAR) AS $$
BEGIN
  RETURN QUERY
  SELECT p.id, p.full_name
  FROM profiles p
  JOIN membership_status ms ON ms.user_id = p.id
  WHERE p.id != auth.uid()
    AND p.role = 'member'
    AND p.account_status = 'active'
    AND ms.status = 'active'
    -- Must have at least one completed equity share
    AND EXISTS (
      SELECT 1 FROM equity_shares es
      WHERE es.user_id = p.id AND es.status = 'completed'
    )
    -- Must not have an active loan
    AND NOT EXISTS (
      SELECT 1 FROM loans l
      WHERE l.user_id = p.id AND l.status = 'active'
    )
    -- Must not already be a co-maker on an active/pending application
    AND NOT EXISTS (
      SELECT 1 FROM loan_co_makers lcm
      JOIN loan_applications la ON la.id = lcm.application_id
      WHERE lcm.co_maker_user_id = p.id
        AND la.status IN ('draft', 'submitted', 'under_review')
    )
  ORDER BY p.full_name;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
