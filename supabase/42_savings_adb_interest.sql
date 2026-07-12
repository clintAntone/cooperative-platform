-- Fix interest calculation to use Average Daily Balance (ADB).
--
-- ADB = balance_at_period_start
--       + SUM(each_deposit × days_remaining_in_period / total_period_days)
--       - SUM(each_withdrawal × days_remaining_in_period / total_period_days)
--
-- Effect: a member who saves consistently throughout the 6-month period earns
-- interest on the average balance they held. A member who dumps a large bulk
-- amount the day before interest release earns very little extra — that deposit
-- only contributes (1/180) of its value to the average.

-- Remove holdout config (replaced by ADB approach)
DELETE FROM system_config WHERE config_key = 'savings_interest_holdout_days';

CREATE OR REPLACE FUNCTION release_savings_interest()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rate              DECIMAL(5,2);
  v_period_start_ts   TIMESTAMPTZ;
  v_period_end_ts     TIMESTAMPTZ;
  v_period_days       DECIMAL(15,6);
  v_account           savings_accounts%ROWTYPE;
  v_balance_at_start  DECIMAL(15,2);
  v_adb               DECIMAL(15,2);
  v_interest          DECIMAL(15,2);
BEGIN
  SELECT COALESCE(config_value::DECIMAL, 2.5) INTO v_rate
  FROM system_config WHERE config_key = 'savings_interest_rate';

  v_period_end_ts := now();

  FOR v_account IN
    SELECT * FROM savings_accounts WHERE status = 'active'
  LOOP
    -- Period starts at the last interest release, or account opening if never released
    SELECT COALESCE(
      (SELECT created_at FROM savings_interest_logs
       WHERE account_id = v_account.id ORDER BY created_at DESC LIMIT 1),
      v_account.opened_at
    ) INTO v_period_start_ts;

    v_period_days := GREATEST(1, EXTRACT(EPOCH FROM (v_period_end_ts - v_period_start_ts)) / 86400.0);

    -- Balance at start of period:
    --   current balance
    --   minus contributions made during the period (those are "new")
    --   plus withdrawals approved during the period (those reduced the balance)
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

    -- ADB = balance_at_start
    --       + weighted contributions (each deposit × days it was held / total days)
    --       - weighted withdrawals  (each withdrawal × days balance was reduced / total days)
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

    v_interest := ROUND(v_adb * (v_rate / 100.0), 2);

    IF v_interest > 0 THEN
      -- Credit interest to balance
      UPDATE savings_accounts
      SET balance = balance + v_interest, updated_at = now()
      WHERE id = v_account.id;

      -- Log interest (principal_at_time = ADB, not raw current balance)
      INSERT INTO savings_interest_logs (
        account_id, user_id, principal_at_time, interest_earned,
        period_start, period_end, released_by
      )
      VALUES (
        v_account.id, v_account.user_id,
        v_adb,
        v_interest,
        v_period_start_ts::DATE, v_period_end_ts::DATE,
        'system'
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
