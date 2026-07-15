-- Fix: interest period should start from first deposit, not account opening.
-- An account can sit at ₱0 for years before a member deposits; counting those
-- empty days as part of the period would make the ADB ≈ 0 even with a real balance.
-- If there are no contributions at all, skip the account (nothing to credit).

CREATE OR REPLACE FUNCTION release_savings_interest()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rate              DECIMAL(5,2);
  v_period_end_ts     TIMESTAMPTZ;
  v_period_start_ts   TIMESTAMPTZ;
  v_period_days       DECIMAL(15,6);
  v_account           savings_accounts%ROWTYPE;
  v_balance_at_start  DECIMAL(15,2);
  v_adb               DECIMAL(15,2);
  v_interest          DECIMAL(15,2);
  v_first_deposit_ts  TIMESTAMPTZ;
  v_log_id            UUID;
BEGIN
  SELECT COALESCE(config_value::DECIMAL, 2.5) INTO v_rate
  FROM system_config WHERE config_key = 'savings_interest_rate';

  v_period_end_ts := now();

  FOR v_account IN
    SELECT * FROM savings_accounts WHERE status = 'active'
  LOOP
    -- Idempotency: skip if this account already has an interest log for today
    IF EXISTS (
      SELECT 1 FROM savings_interest_logs
      WHERE account_id = v_account.id
        AND period_end = v_period_end_ts::DATE
    ) THEN
      CONTINUE;
    END IF;

    -- Period starts at last interest release, or the very first deposit.
    -- Never use account opening date — balance was ₱0 then.
    SELECT COALESCE(
      (SELECT created_at FROM savings_interest_logs
       WHERE account_id = v_account.id ORDER BY created_at DESC LIMIT 1),
      (SELECT MIN(contributed_at) FROM savings_contributions
       WHERE account_id = v_account.id)
    ) INTO v_period_start_ts;

    -- No contributions yet → nothing to credit, skip
    IF v_period_start_ts IS NULL THEN
      CONTINUE;
    END IF;

    v_period_days := GREATEST(1, EXTRACT(EPOCH FROM (v_period_end_ts - v_period_start_ts)) / 86400.0);

    -- Balance at start of period
    SELECT
      v_account.balance
      - COALESCE((
          SELECT SUM(sc.amount)
          FROM savings_contributions sc
          WHERE sc.account_id = v_account.id
            AND sc.contributed_at > v_period_start_ts
        ), 0)
      + COALESCE((
          SELECT SUM(swr.amount)
          FROM savings_withdrawal_requests swr
          WHERE swr.account_id = v_account.id
            AND swr.status = 'approved'
            AND swr.reviewed_at > v_period_start_ts
        ), 0)
    INTO v_balance_at_start;

    -- ADB calculation
    SELECT
      GREATEST(0,
        v_balance_at_start
        + COALESCE((
            SELECT SUM(
              sc.amount
              * GREATEST(0, EXTRACT(EPOCH FROM (v_period_end_ts - sc.contributed_at)) / 86400.0)
              / v_period_days
            )
            FROM savings_contributions sc
            WHERE sc.account_id = v_account.id
              AND sc.contributed_at > v_period_start_ts
          ), 0)
        - COALESCE((
            SELECT SUM(
              swr.amount
              * GREATEST(0, EXTRACT(EPOCH FROM (v_period_end_ts - swr.reviewed_at)) / 86400.0)
              / v_period_days
            )
            FROM savings_withdrawal_requests swr
            WHERE swr.account_id = v_account.id
              AND swr.status = 'approved'
              AND swr.reviewed_at > v_period_start_ts
          ), 0)
      )
    INTO v_adb;

    -- Skip if ADB is effectively zero (nothing earned)
    IF v_adb <= 0 THEN
      CONTINUE;
    END IF;

    v_interest := ROUND(v_adb * (v_rate / 100.0), 2);

    IF v_interest <= 0 THEN
      CONTINUE;
    END IF;

    -- Credit interest to the account
    UPDATE savings_accounts
    SET balance = balance + v_interest, updated_at = now()
    WHERE id = v_account.id;

    -- Log the interest release
    INSERT INTO savings_interest_logs (
      account_id, user_id, principal_at_time, interest_earned,
      period_start, period_end, released_by
    ) VALUES (
      v_account.id, v_account.user_id, v_adb, v_interest,
      v_period_start_ts::DATE, v_period_end_ts::DATE, 'system'
    )
    RETURNING id INTO v_log_id;

    -- Ledger entry
    INSERT INTO ledger_entries (
      user_id, entry_type, reference_id, reference_table,
      amount, direction, notes, created_by
    ) VALUES (
      v_account.user_id, 'savings_interest', v_log_id, 'savings_interest_logs',
      v_interest, 'credit', 'Savings interest credited', NULL
    );

  END LOOP;
END;
$$;
