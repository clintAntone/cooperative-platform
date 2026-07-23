-- Migration 85: Bulk import support for admin bypass
-- 1. Make loans.application_id nullable (bulk-imported loans have no application)
-- 2. RPC to record a contribution directly and keep share balance in sync

ALTER TABLE loans ALTER COLUMN application_id DROP NOT NULL;

-- Direct contribution recorder: inserts contribution and syncs share paid_amount/status.
-- Used by the admin bulk-import tool to bypass the deposit-request approval flow.
CREATE OR REPLACE FUNCTION admin_record_contribution_direct(
  p_user_id       UUID,
  p_share_id      UUID,
  p_amount        DECIMAL(15,2),
  p_payment_method VARCHAR,
  p_reference     VARCHAR,
  p_date          TIMESTAMPTZ,
  p_recorded_by   UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_paid   DECIMAL(15,2);
  v_target DECIMAL(15,2);
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin', 'staff') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  INSERT INTO equity_contributions
    (user_id, share_id, amount, payment_method, reference, recorded_by, contribution_at)
  VALUES
    (p_user_id, p_share_id, p_amount, p_payment_method, p_reference, p_recorded_by, p_date);

  SELECT COALESCE(SUM(amount), 0) INTO v_paid
  FROM equity_contributions WHERE share_id = p_share_id;

  SELECT target_amount INTO v_target FROM equity_shares WHERE id = p_share_id;

  UPDATE equity_shares
  SET paid_amount  = v_paid,
      status       = CASE WHEN v_paid >= v_target THEN 'completed' ELSE status END,
      completed_at = CASE WHEN v_paid >= v_target AND completed_at IS NULL THEN now() ELSE completed_at END,
      updated_at   = now()
  WHERE id = p_share_id;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_record_contribution_direct(UUID, UUID, DECIMAL, VARCHAR, VARCHAR, TIMESTAMPTZ, UUID) TO authenticated;
