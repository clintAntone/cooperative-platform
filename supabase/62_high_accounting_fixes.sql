-- Migration 62: HIGH-priority accounting fixes
--
-- 5. Overdue/late payment tracking  — mark_overdue_installments() + cron
-- 6. Loan auto-completion           — record_loan_repayment() RPC checks outstanding
-- 7. Repayment principal/interest split — two ledger entries per payment
-- 8. Savings interest idempotency   — UNIQUE(account_id, period_end) guard

-- ─── Extend ledger entry_type ────────────────────────────────────────────────
-- Add principal/interest split types and drop the old combined trigger

ALTER TABLE ledger_entries DROP CONSTRAINT IF EXISTS ledger_entries_entry_type_check;
ALTER TABLE ledger_entries ADD CONSTRAINT ledger_entries_entry_type_check CHECK (entry_type IN (
  'equity_contribution','equity_reversal',
  'loan_disbursement','loan_disbursement_liability',
  'loan_repayment','loan_repayment_principal','loan_repayment_interest',
  'fee','adjustment',
  'savings_deposit','savings_withdrawal','savings_interest',
  'equity_dividend',
  'share_transfer_out','share_transfer_in',
  'rebate',
  'damayan_collection'
));

-- Drop the auto-trigger (logic moves into the RPC below for proper splits)
DROP TRIGGER IF EXISTS after_repayment_ledger ON loan_repayments;
DROP FUNCTION IF EXISTS ledger_on_repayment();

-- ─── Issue 6 & 7: record_loan_repayment() RPC ────────────────────────────────
-- Replaces: direct INSERT into loan_repayments from the frontend hook
-- Handles: schedule status, loans.amount_paid/outstanding, auto-completion, split ledger

CREATE OR REPLACE FUNCTION record_loan_repayment(
  p_loan_id       UUID,
  p_schedule_id   UUID DEFAULT NULL,
  p_amount        DECIMAL(15,2) DEFAULT NULL,
  p_payment_method VARCHAR DEFAULT 'cash',
  p_reference     VARCHAR DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_loan            loans%ROWTYPE;
  v_sched           loan_repayment_schedule%ROWTYPE;
  v_repayment_id    UUID;
  v_pay_amount      DECIMAL(15,2);
  v_principal_part  DECIMAL(15,2);
  v_interest_part   DECIMAL(15,2);
  v_new_outstanding DECIMAL(15,2);
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin', 'staff') THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  SELECT * INTO v_loan FROM loans WHERE id = p_loan_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Loan not found'; END IF;
  IF v_loan.status NOT IN ('active', 'defaulted') THEN
    RAISE EXCEPTION 'Cannot record payment on a % loan', v_loan.status;
  END IF;

  -- Determine schedule row (if provided)
  IF p_schedule_id IS NOT NULL THEN
    SELECT * INTO v_sched FROM loan_repayment_schedule
    WHERE id = p_schedule_id AND loan_id = p_loan_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Schedule installment not found for this loan'; END IF;
  END IF;

  -- Amount defaults to total_due on the selected installment
  v_pay_amount := COALESCE(p_amount, v_sched.total_due);
  IF v_pay_amount <= 0 THEN RAISE EXCEPTION 'Payment amount must be positive'; END IF;

  -- ── Insert repayment record ───────────────────────────────────────────────
  INSERT INTO loan_repayments (loan_id, schedule_id, amount, payment_method, reference, recorded_by)
  VALUES (p_loan_id, p_schedule_id, v_pay_amount, p_payment_method, p_reference, auth.uid())
  RETURNING id INTO v_repayment_id;

  -- ── Update schedule installment status ───────────────────────────────────
  IF p_schedule_id IS NOT NULL THEN
    UPDATE loan_repayment_schedule
    SET
      amount_paid = amount_paid + v_pay_amount,
      status = CASE
        WHEN amount_paid + v_pay_amount >= total_due THEN 'paid'
        ELSE 'partial'
      END,
      paid_at = CASE
        WHEN amount_paid + v_pay_amount >= total_due THEN now()
        ELSE paid_at
      END
    WHERE id = p_schedule_id;
  END IF;

  -- ── Update loan totals ────────────────────────────────────────────────────
  v_new_outstanding := GREATEST(0, v_loan.outstanding - v_pay_amount);

  UPDATE loans
  SET
    amount_paid = amount_paid + v_pay_amount,
    outstanding = v_new_outstanding,
    status = CASE WHEN v_new_outstanding = 0 THEN 'completed' ELSE status END
  WHERE id = p_loan_id;

  -- ── Split ledger entries (principal + interest) ───────────────────────────
  IF p_schedule_id IS NOT NULL THEN
    -- Derive the principal/interest split from this installment
    -- Cap at what was actually due (in case of partial payment)
    v_interest_part  := LEAST(v_pay_amount, v_sched.interest_due);
    v_principal_part := GREATEST(0, v_pay_amount - v_interest_part);
  ELSE
    -- No schedule context: treat as all-principal (conservative — no interest allocation)
    v_principal_part := v_pay_amount;
    v_interest_part  := 0;
  END IF;

  IF v_principal_part > 0 THEN
    INSERT INTO ledger_entries (user_id, entry_type, reference_id, reference_table, amount, direction, notes, created_by)
    VALUES (v_loan.user_id, 'loan_repayment_principal', v_repayment_id, 'loan_repayments',
            v_principal_part, 'debit', 'Loan repayment — principal', auth.uid());
  END IF;

  IF v_interest_part > 0 THEN
    INSERT INTO ledger_entries (user_id, entry_type, reference_id, reference_table, amount, direction, notes, created_by)
    VALUES (v_loan.user_id, 'loan_repayment_interest', v_repayment_id, 'loan_repayments',
            v_interest_part, 'debit', 'Loan repayment — interest income', auth.uid());
  END IF;

  RETURN v_repayment_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
GRANT EXECUTE ON FUNCTION record_loan_repayment(UUID, UUID, DECIMAL, VARCHAR, VARCHAR) TO authenticated;

-- ─── Issue 5: Overdue / default tracking ─────────────────────────────────────

CREATE OR REPLACE FUNCTION mark_overdue_installments()
RETURNS INT AS $$
DECLARE
  v_grace_days     INT;
  v_default_days   INT;
  v_overdue_count  INT;
BEGIN
  SELECT COALESCE(config_value::INT, 7)  INTO v_grace_days  FROM system_config WHERE config_key = 'grace_period_days';
  SELECT COALESCE(config_value::INT, 30) INTO v_default_days FROM system_config WHERE config_key = 'loan_default_threshold_days';

  -- Mark installments as overdue once grace period expires
  UPDATE loan_repayment_schedule
  SET status = 'overdue'
  WHERE status = 'pending'
    AND due_date < (CURRENT_DATE - v_grace_days);

  GET DIAGNOSTICS v_overdue_count = ROW_COUNT;

  -- Mark loans as defaulted when overdue beyond the default threshold
  UPDATE loans
  SET status = 'defaulted'
  WHERE status = 'active'
    AND id IN (
      SELECT DISTINCT loan_id
      FROM loan_repayment_schedule
      WHERE status = 'overdue'
        AND due_date < (CURRENT_DATE - v_default_days)
    );

  RETURN v_overdue_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
GRANT EXECUTE ON FUNCTION mark_overdue_installments() TO authenticated;

-- Schedule: run nightly at 01:00
-- (Requires pg_cron extension — run in Supabase SQL editor after enabling pg_cron)
-- SELECT cron.schedule('mark-overdue-installments', '0 1 * * *', 'SELECT mark_overdue_installments()');

-- ─── Issue 8: Savings interest idempotency guard ──────────────────────────────

-- Unique constraint prevents crediting the same account twice on the same end date
ALTER TABLE savings_interest_logs
  ADD CONSTRAINT savings_interest_logs_account_period_unique
  UNIQUE (account_id, period_end);

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

    -- Period starts at last interest release, or account opening
    SELECT COALESCE(
      (SELECT created_at FROM savings_interest_logs
       WHERE account_id = v_account.id ORDER BY created_at DESC LIMIT 1),
      v_account.opened_at
    ) INTO v_period_start_ts;

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

    v_interest := ROUND(v_adb * (v_rate / 100.0), 2);

    IF v_interest > 0 THEN
      UPDATE savings_accounts
      SET balance = balance + v_interest, updated_at = now()
      WHERE id = v_account.id;

      -- Insert with ON CONFLICT DO NOTHING as a second safety layer
      INSERT INTO savings_interest_logs (
        account_id, user_id, principal_at_time, interest_earned,
        period_start, period_end, released_by
      )
      VALUES (
        v_account.id, v_account.user_id,
        v_adb, v_interest,
        v_period_start_ts::DATE, v_period_end_ts::DATE,
        'system'
      )
      ON CONFLICT (account_id, period_end) DO NOTHING
      RETURNING id INTO v_log_id;

      -- Only write ledger entry if the log row was actually inserted
      IF v_log_id IS NOT NULL THEN
        INSERT INTO ledger_entries (
          user_id, entry_type, reference_id, reference_table, amount, direction, created_by
        )
        VALUES (v_account.user_id, 'savings_interest', v_log_id, 'savings_interest_logs', v_interest, 'credit', NULL);
      END IF;
    END IF;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION release_savings_interest() TO authenticated;
