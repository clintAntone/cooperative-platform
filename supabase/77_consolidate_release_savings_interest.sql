-- Consolidate release_savings_interest into a single unambiguous function.
-- Drops both existing overloads (no-arg and BOOLEAN) then recreates one version
-- with p_force BOOLEAN DEFAULT false — callable as release_savings_interest() or
-- release_savings_interest(true).
--
-- Incorporates all fixes:
--   • Month-gating from migration 72 (cron runs monthly, self-gates by config)
--   • Period starts from first deposit, NOT account opening (migration 75 fix)
--   • Skip accounts with no deposits (nothing to credit)
--   • Idempotency: skip if already released today

DROP FUNCTION IF EXISTS release_savings_interest();
DROP FUNCTION IF EXISTS release_savings_interest(BOOLEAN);

CREATE OR REPLACE FUNCTION release_savings_interest(p_force BOOLEAN DEFAULT false)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rate               DECIMAL(5,2);
  v_release_months     TEXT;
  v_current_month      INT;
  v_period_end_ts      TIMESTAMPTZ;
  v_period_start_ts    TIMESTAMPTZ;
  v_period_days        DECIMAL(15,6);
  v_account            savings_accounts%ROWTYPE;
  v_had_prior_interest BOOLEAN;
  v_balance_at_start   DECIMAL(15,2);
  v_adb                DECIMAL(15,2);
  v_interest           DECIMAL(15,2);
BEGIN
  -- Self-gate: if not forced, only run in configured release months
  IF NOT p_force THEN
    SELECT COALESCE(config_value, '6,12') INTO v_release_months
    FROM system_config WHERE config_key = 'savings_interest_release_months';

    v_current_month := EXTRACT(MONTH FROM now())::INT;

    IF NOT (v_current_month = ANY(
      SELECT unnest(string_to_array(v_release_months, ','))::INT
    )) THEN
      RETURN;
    END IF;
  END IF;

  SELECT COALESCE(config_value::DECIMAL, 2.5) INTO v_rate
  FROM system_config WHERE config_key = 'savings_interest_rate';

  v_period_end_ts := now();

  FOR v_account IN
    SELECT * FROM savings_accounts WHERE status = 'active'
  LOOP
    -- Idempotency: skip if already released today for this account
    IF EXISTS (
      SELECT 1 FROM savings_interest_logs
      WHERE account_id = v_account.id
        AND period_end = v_period_end_ts::DATE
    ) THEN
      CONTINUE;
    END IF;

    -- Period start = last interest release, or the first deposit approval date.
    -- NEVER use account opened_at — the account had ₱0 before the first deposit.
    SELECT created_at INTO v_period_start_ts
    FROM savings_interest_logs
    WHERE account_id = v_account.id
    ORDER BY created_at DESC LIMIT 1;

    v_had_prior_interest := v_period_start_ts IS NOT NULL;

    IF NOT v_had_prior_interest THEN
      SELECT MIN(contributed_at) INTO v_period_start_ts
      FROM savings_contributions
      WHERE account_id = v_account.id;
    END IF;

    -- No deposits yet — nothing to credit
    IF v_period_start_ts IS NULL THEN
      CONTINUE;
    END IF;

    v_period_days := GREATEST(1, EXTRACT(EPOCH FROM (v_period_end_ts - v_period_start_ts)) / 86400.0);

    -- Balance at start of period
    IF v_had_prior_interest THEN
      SELECT GREATEST(0,
        v_account.balance
        - COALESCE((
            SELECT SUM(sc.amount) FROM savings_contributions sc
            WHERE sc.account_id = v_account.id AND sc.contributed_at > v_period_start_ts
          ), 0)
        + COALESCE((
            SELECT SUM(swr.amount) FROM savings_withdrawal_requests swr
            WHERE swr.account_id = v_account.id AND swr.status = 'approved'
              AND swr.reviewed_at > v_period_start_ts
          ), 0)
      ) INTO v_balance_at_start;
    ELSE
      v_balance_at_start := 0; -- account had ₱0 before first deposit
    END IF;

    -- ADB = balance_at_start + weighted deposits − weighted withdrawals
    SELECT GREATEST(0,
      v_balance_at_start
      + COALESCE((
          SELECT SUM(
            sc.amount
            * GREATEST(0, EXTRACT(EPOCH FROM (v_period_end_ts - sc.contributed_at)) / 86400.0)
            / v_period_days
          )
          FROM savings_contributions sc
          WHERE sc.account_id = v_account.id
            AND (NOT v_had_prior_interest OR sc.contributed_at > v_period_start_ts)
        ), 0)
      - COALESCE((
          SELECT SUM(
            swr.amount
            * GREATEST(0, EXTRACT(EPOCH FROM (v_period_end_ts - swr.reviewed_at)) / 86400.0)
            / v_period_days
          )
          FROM savings_withdrawal_requests swr
          WHERE swr.account_id = v_account.id AND swr.status = 'approved'
            AND (NOT v_had_prior_interest OR swr.reviewed_at > v_period_start_ts)
        ), 0)
    ) INTO v_adb;

    IF v_adb <= 0 THEN CONTINUE; END IF;

    v_interest := ROUND(v_adb * (v_rate / 100.0), 2);

    IF v_interest <= 0 THEN CONTINUE; END IF;

    -- Credit interest to balance
    UPDATE savings_accounts
    SET balance = balance + v_interest, updated_at = now()
    WHERE id = v_account.id;

    -- Log the release
    INSERT INTO savings_interest_logs (
      account_id, user_id, principal_at_time, interest_earned,
      period_start, period_end, released_by
    ) VALUES (
      v_account.id, v_account.user_id,
      v_adb, v_interest,
      v_period_start_ts::DATE, v_period_end_ts::DATE,
      CASE WHEN p_force THEN 'admin' ELSE 'system' END
    );

    -- Ledger entry
    INSERT INTO ledger_entries (
      user_id, entry_type, reference_id, reference_table, amount, direction, notes, created_by
    )
    SELECT
      v_account.user_id, 'savings_interest', sil.id, 'savings_interest_logs',
      v_interest, 'credit', 'Savings interest credited', NULL
    FROM savings_interest_logs sil
    WHERE sil.account_id = v_account.id
    ORDER BY sil.created_at DESC LIMIT 1;

  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION release_savings_interest(BOOLEAN) TO authenticated;
