-- RPC: get_savings_adb
-- Computes Average Daily Balance server-side using database now().
-- Client device time is never used, preventing manipulation.
--
-- Rules:
--   - Period starts from first deposit approval (contributed_at), not account opening.
--   - After an interest release, period restarts from the release date.
--   - Only WHOLE completed 24h days are counted (floor, not fractional hours).
--   - On the deposit day itself (< 24h since approval): ADB = 0, period_days = 0.
--   - Each deposit's days_held is also floored, so it starts contributing the day after approval.

CREATE OR REPLACE FUNCTION get_savings_adb(p_account_id UUID)
RETURNS TABLE (adb DECIMAL(15,2), period_days INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account           savings_accounts%ROWTYPE;
  v_period_start      TIMESTAMPTZ;
  v_had_prior_interest BOOLEAN;
  v_period_days       INTEGER;
  v_balance_at_start  DECIMAL(15,2);
  v_adb               DECIMAL(15,2);
BEGIN
  SELECT * INTO v_account FROM savings_accounts WHERE id = p_account_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 0::DECIMAL(15,2), 0::INTEGER;
    RETURN;
  END IF;

  -- Period start = last interest release, or the first deposit approval time.
  -- Account opening date is never used — balance was ₱0 before the first deposit.
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

  -- No deposits at all yet
  IF v_period_start IS NULL THEN
    RETURN QUERY SELECT 0::DECIMAL(15,2), 0::INTEGER;
    RETURN;
  END IF;

  -- Whole completed days since period start (floor — no fractional hours)
  v_period_days := FLOOR(EXTRACT(EPOCH FROM (now() - v_period_start)) / 86400)::INTEGER;

  -- Less than 24h since first deposit/last interest release
  IF v_period_days = 0 THEN
    RETURN QUERY SELECT 0::DECIMAL(15,2), 0::INTEGER;
    RETURN;
  END IF;

  -- Balance at start of period
  IF v_had_prior_interest THEN
    SELECT GREATEST(0,
      v_account.balance
      - COALESCE((
          SELECT SUM(sc.amount)
          FROM savings_contributions sc
          WHERE sc.account_id = p_account_id
            AND sc.contributed_at > v_period_start
        ), 0)
      + COALESCE((
          SELECT SUM(swr.amount)
          FROM savings_withdrawal_requests swr
          WHERE swr.account_id = p_account_id
            AND swr.status = 'approved'
            AND swr.reviewed_at > v_period_start
        ), 0)
    ) INTO v_balance_at_start;
  ELSE
    -- No prior interest: account had ₱0 before first deposit
    v_balance_at_start := 0;
  END IF;

  -- ADB = balance_at_start
  --     + SUM(deposit × floor_days_held / period_days)
  -- floor_days_held: whole days since each deposit was approved (server now())
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
        WHERE swr.account_id = p_account_id
          AND swr.status = 'approved'
          AND (NOT v_had_prior_interest OR swr.reviewed_at > v_period_start)
      ), 0)
  ) INTO v_adb;

  RETURN QUERY SELECT ROUND(COALESCE(v_adb, 0), 2), v_period_days;
END;
$$;

-- Grant execute to authenticated users (RLS on savings_accounts still applies)
GRANT EXECUTE ON FUNCTION get_savings_adb(UUID) TO authenticated;
