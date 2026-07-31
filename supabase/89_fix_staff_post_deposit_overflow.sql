-- Migration 89: Redefine staff_post_deposit with proper overflow cascade.
-- Previous version dumped the full amount onto the current share with no overflow
-- logic, causing overpayment on a single share instead of auto-opening new ones.

DROP FUNCTION IF EXISTS staff_post_deposit(UUID, DECIMAL, VARCHAR, TIMESTAMPTZ, VARCHAR, UUID);

CREATE OR REPLACE FUNCTION staff_post_deposit(
  p_user_id      UUID,
  p_amount       DECIMAL(15,2),
  p_destination  VARCHAR,   -- 'shares' or 'savings'
  p_date         TIMESTAMPTZ,
  p_reference    VARCHAR,
  p_recorded_by  UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_share        equity_shares%ROWTYPE;
  v_remaining    DECIMAL(15,2);
  v_to_credit    DECIMAL(15,2);
  v_leftover     DECIMAL(15,2);
  v_share_price  DECIMAL(15,2);
  v_max_shares   INT;
  v_share_count  INT;
  v_next_number  INT;
  v_new_share_id UUID;
  v_savings_id   UUID;
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin', 'staff') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;

  -- ── SAVINGS path ─────────────────────────────────────────────────────────────
  IF p_destination = 'savings' THEN
    SELECT id INTO v_savings_id
    FROM savings_accounts
    WHERE user_id = p_user_id
    LIMIT 1;

    IF v_savings_id IS NULL THEN
      RAISE EXCEPTION 'No savings account found for this member';
    END IF;

    INSERT INTO savings_deposit_requests
      (user_id, savings_account_id, amount, payment_method, reference, status,
       reviewed_by, reviewed_at, created_at, updated_at)
    VALUES
      (p_user_id, v_savings_id, p_amount, 'cash', p_reference, 'approved',
       p_recorded_by, p_date, p_date, p_date);

    RETURN;
  END IF;

  -- ── SHARES path with overflow cascade ────────────────────────────────────────
  v_leftover := p_amount;

  -- Walk existing in-progress shares in order
  FOR v_share IN
    SELECT * FROM equity_shares
    WHERE user_id = p_user_id
      AND status = 'in_progress'
    ORDER BY share_number ASC
  LOOP
    EXIT WHEN v_leftover <= 0;

    v_remaining := v_share.target_amount - v_share.paid_amount;
    v_to_credit := LEAST(v_leftover, v_remaining);

    INSERT INTO equity_contributions
      (user_id, share_id, amount, payment_method, reference, recorded_by, contribution_at)
    VALUES
      (p_user_id, v_share.id, v_to_credit, 'cash', p_reference, p_recorded_by, p_date);

    v_leftover := v_leftover - v_to_credit;
  END LOOP;

  -- Auto-open new shares for any remaining amount
  IF v_leftover > 0 THEN
    SELECT COALESCE(config_value::DECIMAL, 5000) INTO v_share_price
    FROM system_config WHERE config_key = 'share_price';

    SELECT COALESCE(config_value::INT, 10) INTO v_max_shares
    FROM system_config WHERE config_key = 'max_shares_per_member';

    LOOP
      EXIT WHEN v_leftover <= 0;

      SELECT COUNT(*) INTO v_share_count
      FROM equity_shares
      WHERE user_id = p_user_id AND status != 'cancelled';

      EXIT WHEN v_share_count >= v_max_shares;

      SELECT COALESCE(MAX(share_number), 0) + 1 INTO v_next_number
      FROM equity_shares WHERE user_id = p_user_id;

      INSERT INTO equity_shares (user_id, share_number, target_amount)
      VALUES (p_user_id, v_next_number, v_share_price)
      RETURNING id INTO v_new_share_id;

      v_to_credit := LEAST(v_leftover, v_share_price);

      INSERT INTO equity_contributions
        (user_id, share_id, amount, payment_method, reference, recorded_by, contribution_at)
      VALUES
        (p_user_id, v_new_share_id, v_to_credit, 'cash', p_reference, p_recorded_by, p_date);

      v_leftover := v_leftover - v_to_credit;
    END LOOP;

    -- Max shares reached: credit remainder to last share (accounting integrity)
    IF v_leftover > 0 THEN
      SELECT id INTO v_new_share_id
      FROM equity_shares
      WHERE user_id = p_user_id AND status != 'cancelled'
      ORDER BY share_number DESC
      LIMIT 1;

      INSERT INTO equity_contributions
        (user_id, share_id, amount, payment_method, reference, recorded_by, contribution_at)
      VALUES
        (p_user_id, v_new_share_id, v_leftover, 'cash', p_reference, p_recorded_by, p_date);
    END IF;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION staff_post_deposit(UUID, DECIMAL, VARCHAR, TIMESTAMPTZ, VARCHAR, UUID) TO authenticated;
