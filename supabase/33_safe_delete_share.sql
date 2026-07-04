-- Safe share deletion: block if any deposit_requests are pending or approved.
-- This prevents money from being lost when a share is removed.

CREATE OR REPLACE FUNCTION admin_delete_share(p_share_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT;
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin', 'staff') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  -- Block deletion if any deposit is pending or approved against this share
  SELECT COUNT(*) INTO v_count
  FROM deposit_requests
  WHERE share_id = p_share_id
    AND status IN ('pending', 'approved');

  IF v_count > 0 THEN
    RAISE EXCEPTION 'This share has % deposit request(s) that are pending or approved and cannot be removed.', v_count;
  END IF;

  -- Also block if paid_amount > 0 (extra safety)
  IF EXISTS (SELECT 1 FROM equity_shares WHERE id = p_share_id AND paid_amount > 0) THEN
    RAISE EXCEPTION 'This share has recorded contributions and cannot be removed.';
  END IF;

  DELETE FROM equity_shares WHERE id = p_share_id;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_delete_share(UUID) TO authenticated;
