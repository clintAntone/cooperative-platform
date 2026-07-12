-- Migration 58: RPC to read co-maker share values for loan collateral
--
-- Members cannot read other members' equity_shares due to RLS (equity_shares_self policy).
-- This SECURITY DEFINER function bypasses RLS and returns completed share totals
-- for a given list of user IDs — scoped to the caller being an authenticated member.

CREATE OR REPLACE FUNCTION get_completed_share_totals(p_user_ids UUID[])
RETURNS TABLE(user_id UUID, total_shares DECIMAL(15,2)) AS $$
BEGIN
  -- Only allow authenticated users to call this
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  RETURN QUERY
  SELECT
    es.user_id,
    COALESCE(SUM(es.target_amount), 0)::DECIMAL(15,2) AS total_shares
  FROM equity_shares es
  WHERE es.user_id = ANY(p_user_ids)
    AND es.status = 'completed'
  GROUP BY es.user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_completed_share_totals(UUID[]) TO authenticated;
