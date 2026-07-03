-- Add changed_by tracking to membership_history
ALTER TABLE membership_history
  ADD COLUMN IF NOT EXISTS changed_by UUID REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS changed_by_name VARCHAR;

-- Update admin_set_membership_status:
-- 1. Record who made the change
-- 2. Only insert history when status actually changes
-- 3. Cannot set 'active' if member has 0 completed shares
CREATE OR REPLACE FUNCTION admin_set_membership_status(
  p_user_id UUID,
  p_status VARCHAR,
  p_reason TEXT DEFAULT NULL
)
RETURNS VOID AS $$
DECLARE
  v_current_status  VARCHAR;
  v_changer_name    VARCHAR;
  v_completed_shares INT;
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin', 'staff') THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  -- Enforce share requirement for active status
  SELECT COUNT(*) INTO v_completed_shares
  FROM equity_shares
  WHERE user_id = p_user_id AND status = 'completed';

  IF p_status = 'active' AND v_completed_shares = 0 THEN
    RAISE EXCEPTION 'Cannot approve membership: member has no completed equity shares';
  END IF;

  SELECT full_name INTO v_changer_name FROM profiles WHERE id = auth.uid();
  SELECT status INTO v_current_status FROM membership_status WHERE user_id = p_user_id;

  IF v_current_status IS NULL THEN
    INSERT INTO membership_status (user_id, status, completed_shares, reason, last_evaluated_at)
    VALUES (p_user_id, p_status, v_completed_shares, p_reason, now());

    INSERT INTO membership_history (user_id, from_status, to_status, reason, changed_by, changed_by_name)
    VALUES (p_user_id, NULL, p_status, p_reason, auth.uid(), v_changer_name);
  ELSIF v_current_status != p_status THEN
    INSERT INTO membership_history (user_id, from_status, to_status, reason, changed_by, changed_by_name)
    VALUES (p_user_id, v_current_status, p_status, p_reason, auth.uid(), v_changer_name);

    UPDATE membership_status
    SET status = p_status,
        completed_shares = v_completed_shares,
        reason = p_reason,
        last_evaluated_at = now(),
        updated_at = now()
    WHERE user_id = p_user_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
