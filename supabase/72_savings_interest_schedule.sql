-- Configurable savings interest release schedule.
--
-- Instead of a hardcoded every-6-months cron, admins can configure which calendar
-- months interest is released (e.g. '6,12' = every June and December).
--
-- The cron job runs on the 1st of every month; the function self-gates by checking
-- whether the current month is in the configured list — UNLESS called with p_force=true
-- (used by the "Release Interest Now" button in the admin UI).

-- Add the config key (skip if already present)
INSERT INTO system_config (config_key, config_value, value_type, description)
VALUES (
  'savings_interest_release_months',
  '6,12',
  'string',
  'Comma-separated month numbers when interest is auto-released (1=Jan … 12=Dec). Default: 6,12 = June & December.'
)
ON CONFLICT (config_key) DO NOTHING;

-- Replace the function with one that accepts an optional p_force parameter.
-- When p_force = false (default, used by cron): only runs if today's month is in the configured list.
-- When p_force = true (used by admin button): always runs regardless of month.
CREATE OR REPLACE FUNCTION release_savings_interest(p_force BOOLEAN DEFAULT false)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rate              DECIMAL(5,2);
  v_release_months    TEXT;
  v_current_month     INT;
  v_period_start_ts   TIMESTAMPTZ;
  v_period_end_ts     TIMESTAMPTZ;
  v_period_days       DECIMAL(15,6);
  v_account           savings_accounts%ROWTYPE;
  v_balance_at_start  DECIMAL(15,2);
  v_adb               DECIMAL(15,2);
  v_interest          DECIMAL(15,2);
BEGIN
  -- Self-gate: if not forced, check whether this month is a release month
  IF NOT p_force THEN
    SELECT COALESCE(config_value, '6,12') INTO v_release_months
    FROM system_config WHERE config_key = 'savings_interest_release_months';

    v_current_month := EXTRACT(MONTH FROM now())::INT;

    -- If current month is not in the configured list, exit without doing anything
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
        CASE WHEN p_force THEN 'admin' ELSE 'system' END
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

GRANT EXECUTE ON FUNCTION release_savings_interest(BOOLEAN) TO authenticated;

-- Update the cron to run monthly (1st of every month at midnight).
-- The function's self-gate ensures it only does work in the configured months.
-- If pg_cron is not yet enabled, this will fail gracefully — just run it after enabling.
DO $$
BEGIN
  -- Remove the old every-6-months schedule if it exists
  PERFORM cron.unschedule('release-savings-interest');
EXCEPTION WHEN OTHERS THEN
  NULL; -- pg_cron not enabled or job doesn't exist — that's fine
END;
$$;

DO $$
BEGIN
  PERFORM cron.schedule(
    'release-savings-interest',
    '0 0 1 * *',  -- 1st of every month at midnight
    'SELECT release_savings_interest()'  -- called without p_force, so month-gating applies
  );
EXCEPTION WHEN OTHERS THEN
  NULL; -- pg_cron not enabled — admin can set this up separately
END;
$$;
