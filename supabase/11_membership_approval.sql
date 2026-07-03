-- Allow staff/admin to manually set a member's membership status
-- Also ensures a membership_status record exists when a user is made a member

CREATE OR REPLACE FUNCTION admin_set_membership_status(
  p_user_id UUID,
  p_status VARCHAR,
  p_reason TEXT DEFAULT NULL
)
RETURNS VOID AS $$
DECLARE
  v_current_status VARCHAR;
BEGIN
  -- Verify caller is admin or staff
  IF get_user_role(auth.uid()) NOT IN ('admin', 'staff') THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  SELECT status INTO v_current_status
  FROM membership_status WHERE user_id = p_user_id;

  IF v_current_status IS NULL THEN
    INSERT INTO membership_status (user_id, status, completed_shares, reason, last_evaluated_at)
    VALUES (p_user_id, p_status, 0, p_reason, now());
  ELSE
    INSERT INTO membership_history (user_id, from_status, to_status, reason)
    VALUES (p_user_id, v_current_status, p_status, p_reason);

    UPDATE membership_status
    SET status = p_status,
        reason = p_reason,
        last_evaluated_at = now(),
        updated_at = now()
    WHERE user_id = p_user_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
