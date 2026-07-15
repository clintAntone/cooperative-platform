-- Extend get_savings_adb to also return accrued_interest.
-- accrued_interest = ADB × rate% × (days_held / total_period_days)
-- This grows by ~₱2.05/day for ₱15,000 at 2.5% over 6 months.
-- The actual balance is never touched — this is display-only until the 6-month release.

DROP FUNCTION IF EXISTS get_savings_adb(UUID);

CREATE OR REPLACE FUNCTION get_savings_adb(p_account_id UUID)
RETURNS TABLE (adb DECIMAL(15,2), period_days INTEGER, accrued_interest DECIMAL(15,2))
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account             savings_accounts%ROWTYPE;
  v_period_start        TIMESTAMPTZ;
  v_had_prior_interest  BOOLEAN;
  v_period_days         INTEGER;
  v_balance_at_start    DECIMAL(15,2);
  v_adb                 DECIMAL(15,2);
  v_rate                DECIMAL(5,2);
  v_period_months       INT;
  v_total_period_days   DECIMAL(10,4);
  v_accrued             DECIMAL(15,2);
BEGIN
  SELECT * INTO v_account FROM savings_accounts WHERE id = p_account_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 0::DECIMAL(15,2), 0::INTEGER, 0::DECIMAL(15,2);
    RETURN;
  END IF;

  -- Period start = last interest release, or first deposit approval.
  SELECT created_at INTO v_period_start
  FROM savings_interest_logs
  WHERE account_id = p_account_id
  ORDER BY created_at DESC LIMIT 1;

  v_had_prior_interest := v_period_start IS NOT NULL;

  IF NOT v_had_prior_interest THEN
    SELECT MIN(contributed_at) INTO v_period_start
    FROM savings_contributions
    WHERE account_id = p_account_id;
  END IF;

  IF v_period_start IS NULL THEN
    RETURN QUERY SELECT 0::DECIMAL(15,2), 0::INTEGER, 0::DECIMAL(15,2);
    RETURN;
  END IF;

  -- Whole completed days only
  v_period_days := FLOOR(EXTRACT(EPOCH FROM (now() - v_period_start)) / 86400)::INTEGER;

  IF v_period_days = 0 THEN
    RETURN QUERY SELECT 0::DECIMAL(15,2), 0::INTEGER, 0::DECIMAL(15,2);
    RETURN;
  END IF;

  -- Balance at start of period
  IF v_had_prior_interest THEN
    SELECT GREATEST(0,
      v_account.balance
      - COALESCE((SELECT SUM(sc.amount) FROM savings_contributions sc
          WHERE sc.account_id = p_account_id AND sc.contributed_at > v_period_start), 0)
      + COALESCE((SELECT SUM(swr.amount) FROM savings_withdrawal_requests swr
          WHERE swr.account_id = p_account_id AND swr.status = 'approved'
            AND swr.reviewed_at > v_period_start), 0)
    ) INTO v_balance_at_start;
  ELSE
    v_balance_at_start := 0;
  END IF;

  -- ADB (whole days)
  SELECT GREATEST(0,
    v_balance_at_start
    + COALESCE((
        SELECT SUM(
          sc.amount
          * FLOOR(EXTRACT(EPOCH FROM (now() - sc.contributed_at)) / 86400)::DECIMAL
          / v_period_days
        )
        FROM savings_contributions sc
        WHERE sc.account_id = p_account_id
          AND (NOT v_had_prior_interest OR sc.contributed_at > v_period_start)
      ), 0)
    - COALESCE((
        SELECT SUM(
          swr.amount
          * FLOOR(EXTRACT(EPOCH FROM (now() - swr.reviewed_at)) / 86400)::DECIMAL
          / v_period_days
        )
        FROM savings_withdrawal_requests swr
        WHERE swr.account_id = p_account_id AND swr.status = 'approved'
          AND (NOT v_had_prior_interest OR swr.reviewed_at > v_period_start)
      ), 0)
  ) INTO v_adb;

  -- Interest rate and period length from config
  SELECT COALESCE(config_value::DECIMAL, 2.5) INTO v_rate
  FROM system_config WHERE config_key = 'savings_interest_rate';

  SELECT COALESCE(config_value::INT, 6) INTO v_period_months
  FROM system_config WHERE config_key = 'savings_interest_period_months';

  -- Total days in the interest period (e.g. 6 months = 182.5 days)
  v_total_period_days := v_period_months * (365.0 / 12.0);

  -- Accrued interest so far = ADB × rate% × (days_held / total_period_days)
  -- Grows linearly each day; reaches full interest (e.g. ₱375) at period end.
  v_accrued := ROUND(v_adb * (v_rate / 100.0) * (v_period_days::DECIMAL / v_total_period_days), 2);

  RETURN QUERY SELECT ROUND(COALESCE(v_adb, 0), 2), v_period_days, COALESCE(v_accrued, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION get_savings_adb(UUID) TO authenticated;
