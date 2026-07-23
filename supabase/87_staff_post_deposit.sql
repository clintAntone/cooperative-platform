-- Migration 87: Staff direct deposit posting (rewritten flow)
-- Replaces the deposit-request → approval workflow.
-- Staff receives deposit slip from member, enters it here directly.
-- Business rules enforced:
--   1. Savings requires at least 1 completed share
--   2. If no completed share, destination is forced to 'shares'

CREATE OR REPLACE FUNCTION staff_post_deposit(
  p_user_id     UUID,
  p_amount      DECIMAL(15,2),
  p_destination VARCHAR,   -- 'shares' or 'savings'
  p_date        TIMESTAMPTZ,
  p_reference   VARCHAR,
  p_recorded_by UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_share_id      UUID;
  v_account_id    UUID;
  v_completed_ct  INT;
  v_dest          VARCHAR;
  v_paid          DECIMAL(15,2);
  v_target        DECIMAL(15,2);
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin', 'staff') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;

  -- Check how many completed shares the member has
  SELECT COUNT(*) INTO v_completed_ct
  FROM equity_shares
  WHERE user_id = p_user_id AND status = 'completed';

  -- Force to shares if no completed share
  v_dest := CASE
    WHEN p_destination = 'savings' AND v_completed_ct = 0 THEN 'shares'
    ELSE p_destination
  END;

  IF v_dest = 'shares' THEN
    -- Find the member's active (in_progress) share
    SELECT id INTO v_share_id
    FROM equity_shares
    WHERE user_id = p_user_id AND status = 'in_progress'
    ORDER BY created_at ASC
    LIMIT 1;

    IF v_share_id IS NULL THEN
      RAISE EXCEPTION 'Member has no active share to deposit into';
    END IF;

    -- Record contribution
    INSERT INTO equity_contributions
      (user_id, share_id, amount, payment_method, reference, recorded_by, contribution_at)
    VALUES
      (p_user_id, v_share_id, p_amount, 'bank_transfer', p_reference, p_recorded_by, p_date);

    -- Sync paid_amount and status on the share
    SELECT COALESCE(SUM(amount), 0) INTO v_paid
    FROM equity_contributions WHERE share_id = v_share_id;

    SELECT target_amount INTO v_target FROM equity_shares WHERE id = v_share_id;

    UPDATE equity_shares
    SET paid_amount  = v_paid,
        status       = CASE WHEN v_paid >= v_target THEN 'completed' ELSE status END,
        completed_at = CASE WHEN v_paid >= v_target AND completed_at IS NULL THEN now() ELSE completed_at END,
        updated_at   = now()
    WHERE id = v_share_id;

    RETURN jsonb_build_object('destination', 'shares', 'share_id', v_share_id, 'amount', p_amount);

  ELSE
    -- Savings: get or create account
    SELECT id INTO v_account_id FROM savings_accounts WHERE user_id = p_user_id;

    IF v_account_id IS NULL THEN
      INSERT INTO savings_accounts (user_id, balance, status)
      VALUES (p_user_id, 0, 'active')
      RETURNING id INTO v_account_id;
    END IF;

    INSERT INTO savings_contributions
      (account_id, user_id, request_id, amount, payment_method, reference, recorded_by, contributed_at)
    VALUES
      (v_account_id, p_user_id, NULL, p_amount, 'bank_transfer', p_reference, p_recorded_by, p_date);

    UPDATE savings_accounts
    SET balance    = balance + p_amount,
        updated_at = now()
    WHERE id = v_account_id;

    RETURN jsonb_build_object('destination', 'savings', 'account_id', v_account_id, 'amount', p_amount);
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION staff_post_deposit(UUID, DECIMAL, VARCHAR, TIMESTAMPTZ, VARCHAR, UUID) TO authenticated;
