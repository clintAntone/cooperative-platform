-- Fix savings interest calculation and remove weekly deposit cap.
--
-- Interest is now calculated on the "qualifying balance":
--   current balance MINUS deposits made within the last savings_interest_holdout_days days.
-- This prevents members from making bulk deposits right before the interest release
-- date just to inflate their interest payout.
--
-- Example: with a 30-day holdout, a deposit made on Jun 29 for a Jun 30 release
-- does NOT count toward the current period — it qualifies next period.

-- ─── Add holdout config key, remove weekly cap ───────────────────────────────

DELETE FROM system_config WHERE config_key = 'savings_weekly_cap';

INSERT INTO system_config (config_key, config_value, value_type, description) VALUES
  ('savings_interest_holdout_days', '30', 'number',
   'Minimum days a deposit must be held before it counts toward interest calculation')
ON CONFLICT (config_key) DO NOTHING;

-- ─── Replace approve_savings_deposit (remove weekly cap enforcement) ──────────

CREATE OR REPLACE FUNCTION approve_savings_deposit(p_request_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req savings_deposit_requests%ROWTYPE;
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin','staff') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT * INTO v_req FROM savings_deposit_requests WHERE id = p_request_id;

  IF v_req.status != 'pending' THEN
    RAISE EXCEPTION 'Request is not pending';
  END IF;

  -- Create contribution (trigger handles balance update + ledger)
  INSERT INTO savings_contributions (
    account_id, user_id, request_id, amount, payment_method, reference, recorded_by
  )
  VALUES (
    v_req.account_id, v_req.user_id, v_req.id,
    v_req.amount, v_req.payment_method, v_req.reference, auth.uid()
  );

  -- Mark approved
  UPDATE savings_deposit_requests
  SET status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
  WHERE id = p_request_id;
END;
$$;

GRANT EXECUTE ON FUNCTION approve_savings_deposit(UUID) TO authenticated;

-- ─── Replace release_savings_interest (use qualifying balance) ────────────────

CREATE OR REPLACE FUNCTION release_savings_interest()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rate          DECIMAL(5,2);
  v_holdout_days  INT;
  v_period_start  DATE;
  v_period_end    DATE;
  v_account       savings_accounts%ROWTYPE;
  v_recent_deposits DECIMAL(15,2);
  v_qualifying    DECIMAL(15,2);
  v_interest      DECIMAL(15,2);
BEGIN
  -- Read configuration
  SELECT COALESCE(config_value::DECIMAL, 2.5) INTO v_rate
  FROM system_config WHERE config_key = 'savings_interest_rate';

  SELECT COALESCE(config_value::INT, 30) INTO v_holdout_days
  FROM system_config WHERE config_key = 'savings_interest_holdout_days';

  v_period_start := (now() - INTERVAL '6 months')::DATE;
  v_period_end   := now()::DATE;

  FOR v_account IN
    SELECT * FROM savings_accounts WHERE status = 'active' AND balance > 0
  LOOP
    -- Qualifying balance = current balance minus deposits made within the holdout window.
    -- Deposits older than holdout_days have "seasoned" and earn interest;
    -- recent bulk deposits do not inflate the payout.
    SELECT COALESCE(SUM(sc.amount), 0) INTO v_recent_deposits
    FROM savings_contributions sc
    WHERE sc.account_id = v_account.id
      AND sc.contributed_at > now() - (v_holdout_days || ' days')::INTERVAL;

    v_qualifying := GREATEST(0, v_account.balance - v_recent_deposits);
    v_interest   := ROUND(v_qualifying * (v_rate / 100), 2);

    IF v_interest > 0 THEN
      -- Credit interest to balance
      UPDATE savings_accounts
      SET balance = balance + v_interest, updated_at = now()
      WHERE id = v_account.id;

      -- Log interest (principal_at_time reflects the qualifying balance, not raw balance)
      INSERT INTO savings_interest_logs (
        account_id, user_id, principal_at_time, interest_earned,
        period_start, period_end, released_by
      )
      VALUES (
        v_account.id, v_account.user_id, v_qualifying,
        v_interest, v_period_start, v_period_end, 'system'
      );

      -- Append ledger entry
      INSERT INTO ledger_entries (
        user_id, entry_type, reference_id, reference_table, amount, direction, created_by
      )
      SELECT v_account.user_id, 'savings_interest', sil.id, 'savings_interest_logs', v_interest, 'credit', NULL
      FROM savings_interest_logs sil
      WHERE sil.account_id = v_account.id
      ORDER BY sil.created_at DESC
      LIMIT 1;
    END IF;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION release_savings_interest() TO authenticated;
