-- Migration 86: Direct savings recorder for admin bulk import
-- Creates or reuses a member's savings_account, inserts a contribution,
-- and keeps savings_accounts.balance in sync.

CREATE OR REPLACE FUNCTION admin_record_savings_direct(
  p_user_id       UUID,
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
  v_account_id UUID;
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin', 'staff') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  -- Get or create savings account for the member
  SELECT id INTO v_account_id FROM savings_accounts WHERE user_id = p_user_id;

  IF v_account_id IS NULL THEN
    INSERT INTO savings_accounts (user_id, balance, status)
    VALUES (p_user_id, 0, 'active')
    RETURNING id INTO v_account_id;
  END IF;

  -- Record the contribution
  INSERT INTO savings_contributions
    (account_id, user_id, request_id, amount, payment_method, reference, recorded_by, contributed_at)
  VALUES
    (v_account_id, p_user_id, NULL, p_amount, p_payment_method, p_reference, p_recorded_by, p_date);

  -- Update account balance
  UPDATE savings_accounts
  SET balance     = balance + p_amount,
      updated_at  = now()
  WHERE id = v_account_id;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_record_savings_direct(UUID, DECIMAL, VARCHAR, VARCHAR, TIMESTAMPTZ, UUID) TO authenticated;
