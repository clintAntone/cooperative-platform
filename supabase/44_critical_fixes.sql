-- Migration 44: Critical accounting & flow fixes
--
-- C1: Savings withdrawal enforces minimum balance (savings_min_balance config)
-- C2: Loan repayment applies payments to schedule installments (amount_paid / status)
-- C3: Loan auto-completes when outstanding reaches zero
-- C4: Loan approval validates amount against collateral formula
--     (borrower shares + savings + co-maker shares + savings)
-- P1: Loan approval enforces max_loan_term_months from system_config
-- O3: Confirmed — get_eligible_co_makers() already scoped to active applications
--     (no fix needed, migration 20 handles this correctly)

-- ─── C1: Savings withdrawal — enforce minimum balance ─────────────────────────

CREATE OR REPLACE FUNCTION approve_savings_withdrawal(p_request_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req         savings_withdrawal_requests%ROWTYPE;
  v_balance     DECIMAL(15,2);
  v_min_balance DECIMAL(15,2);
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin','staff') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT * INTO v_req FROM savings_withdrawal_requests WHERE id = p_request_id;

  IF v_req.status != 'pending' THEN
    RAISE EXCEPTION 'Request is not pending';
  END IF;

  SELECT balance INTO v_balance FROM savings_accounts WHERE id = v_req.account_id;

  SELECT COALESCE(config_value::DECIMAL, 500) INTO v_min_balance
  FROM system_config WHERE config_key = 'savings_min_balance';

  IF v_balance < v_req.amount THEN
    RAISE EXCEPTION 'Insufficient balance (balance: %, requested: %)', v_balance, v_req.amount;
  END IF;

  IF v_balance - v_req.amount < v_min_balance THEN
    RAISE EXCEPTION
      'Withdrawal would drop balance below the required minimum of %. Current balance: %, requested: %, minimum to keep: %',
      v_min_balance, v_balance, v_req.amount, v_min_balance;
  END IF;

  UPDATE savings_accounts
  SET balance = balance - v_req.amount, updated_at = now()
  WHERE id = v_req.account_id;

  INSERT INTO ledger_entries (user_id, entry_type, reference_id, reference_table, amount, direction, created_by)
  VALUES (v_req.user_id, 'savings_withdrawal', v_req.id, 'savings_withdrawal_requests', v_req.amount, 'debit', auth.uid());

  UPDATE savings_withdrawal_requests
  SET status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
  WHERE id = p_request_id;
END;
$$;

GRANT EXECUTE ON FUNCTION approve_savings_withdrawal(UUID) TO authenticated;


-- ─── C2 + C3: Loan repayment → update schedule + auto-complete ───────────────

CREATE OR REPLACE FUNCTION apply_loan_repayment_to_schedule()
RETURNS TRIGGER AS $$
DECLARE
  v_remaining       DECIMAL(15,2);
  v_sched_id        UUID;
  v_total_due       DECIMAL(15,2);
  v_paid_so_far     DECIMAL(15,2);
  v_apply           DECIMAL(15,2);
  v_new_outstanding DECIMAL(15,2);
  v_loan_user       UUID;
BEGIN
  v_remaining := NEW.amount;

  -- Apply payment to earliest unpaid installments in due-date order
  FOR v_sched_id, v_total_due, v_paid_so_far IN
    SELECT id, total_due, amount_paid
    FROM loan_repayment_schedule
    WHERE loan_id = NEW.loan_id
      AND status IN ('pending', 'partial', 'overdue')
    ORDER BY due_date ASC, installment_no ASC
  LOOP
    EXIT WHEN v_remaining <= 0;

    v_apply := LEAST(v_remaining, v_total_due - v_paid_so_far);

    UPDATE loan_repayment_schedule
    SET
      amount_paid = v_paid_so_far + v_apply,
      status  = CASE
                  WHEN v_paid_so_far + v_apply >= v_total_due THEN 'paid'
                  ELSE 'partial'
                END,
      paid_at = CASE
                  WHEN v_paid_so_far + v_apply >= v_total_due THEN now()
                  ELSE paid_at
                END
    WHERE id = v_sched_id;

    v_remaining := v_remaining - v_apply;
  END LOOP;

  -- Update loan-level totals
  UPDATE loans
  SET
    amount_paid = COALESCE(amount_paid, 0) + NEW.amount,
    outstanding = GREATEST(0, outstanding - NEW.amount),
    updated_at  = now()
  WHERE id = NEW.loan_id;

  -- Read updated values for completion check
  SELECT outstanding, user_id INTO v_new_outstanding, v_loan_user
  FROM loans WHERE id = NEW.loan_id;

  -- C3: Auto-complete when fully paid
  IF v_new_outstanding = 0 THEN
    UPDATE loans
    SET status = 'completed', updated_at = now()
    WHERE id = NEW.loan_id AND status = 'active';

    -- Re-evaluate membership — may restore loan eligibility
    PERFORM evaluate_membership(v_loan_user);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop existing trigger if present, then create fresh
DROP TRIGGER IF EXISTS after_repayment_apply_schedule ON loan_repayments;

CREATE TRIGGER after_repayment_apply_schedule
  AFTER INSERT ON loan_repayments
  FOR EACH ROW EXECUTE FUNCTION apply_loan_repayment_to_schedule();


-- ─── C4 + P1: Loan approval — collateral validation + term cap ───────────────

CREATE OR REPLACE FUNCTION admin_approve_loan_application(p_application_id UUID)
RETURNS UUID AS $$
DECLARE
  v_app              loan_applications%ROWTYPE;
  v_product          loan_products%ROWTYPE;
  v_loan_id          UUID;
  v_interest_rate    DECIMAL;
  v_calc_method      VARCHAR;
  v_rate_period      VARCHAR;
  v_r                DECIMAL;
  v_emi              DECIMAL;
  v_outstanding      DECIMAL;
  v_principal_pay    DECIMAL;
  v_interest_pay     DECIMAL;
  v_total_repayable  DECIMAL;
  v_co_maker_count   INT;
  v_pending_count    INT;
  v_declined_count   INT;
  -- Collateral validation
  v_max_term         INT;
  v_borrower_shares  DECIMAL(15,2);
  v_borrower_savings DECIMAL(15,2);
  v_comaker_shares   DECIMAL(15,2);
  v_comaker_savings  DECIMAL(15,2);
  v_max_loan         DECIMAL(15,2);
  i                  INT;
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin', 'staff') THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  SELECT * INTO v_app FROM loan_applications WHERE id = p_application_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Application not found'; END IF;
  IF v_app.status NOT IN ('submitted', 'under_review') THEN
    RAISE EXCEPTION 'Application is not in a reviewable state';
  END IF;

  -- ── P1: Enforce max loan term ─────────────────────────────────────────────
  SELECT COALESCE(config_value::INT, 6) INTO v_max_term
  FROM system_config WHERE config_key = 'max_loan_term_months';

  IF v_app.term_months > v_max_term THEN
    RAISE EXCEPTION 'Term of % months exceeds the maximum allowed term of % months',
      v_app.term_months, v_max_term;
  END IF;

  -- ── Co-maker checks ───────────────────────────────────────────────────────
  SELECT COUNT(*) INTO v_co_maker_count
  FROM loan_co_makers WHERE application_id = p_application_id;

  IF v_co_maker_count = 0 THEN
    RAISE EXCEPTION 'Cannot approve: application has no co-makers';
  END IF;

  SELECT COUNT(*) INTO v_pending_count FROM loan_co_makers
  WHERE application_id = p_application_id AND status = 'pending';
  IF v_pending_count > 0 THEN
    RAISE EXCEPTION 'Cannot approve: % co-maker(s) have not yet responded', v_pending_count;
  END IF;

  SELECT COUNT(*) INTO v_declined_count FROM loan_co_makers
  WHERE application_id = p_application_id AND status = 'declined';
  IF v_declined_count > 0 THEN
    RAISE EXCEPTION 'Cannot approve: % co-maker(s) have declined', v_declined_count;
  END IF;

  -- ── C4: Collateral-based max loan calculation ─────────────────────────────
  -- Borrower's completed shares value
  SELECT COALESCE(SUM(target_amount), 0) INTO v_borrower_shares
  FROM equity_shares
  WHERE user_id = v_app.user_id AND status = 'completed';

  -- Borrower's savings balance
  SELECT COALESCE(balance, 0) INTO v_borrower_savings
  FROM savings_accounts WHERE user_id = v_app.user_id;

  -- All confirmed co-makers' shares + savings
  SELECT
    COALESCE(SUM(es_total.share_val), 0),
    COALESCE(SUM(sa_total.sav_val), 0)
  INTO v_comaker_shares, v_comaker_savings
  FROM loan_co_makers lcm
  LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(target_amount), 0) AS share_val
    FROM equity_shares
    WHERE user_id = lcm.co_maker_user_id AND status = 'completed'
  ) es_total ON TRUE
  LEFT JOIN LATERAL (
    SELECT COALESCE(balance, 0) AS sav_val
    FROM savings_accounts
    WHERE user_id = lcm.co_maker_user_id
  ) sa_total ON TRUE
  WHERE lcm.application_id = p_application_id
    AND lcm.status = 'confirmed';

  v_max_loan := v_borrower_shares + v_borrower_savings + v_comaker_shares + v_comaker_savings;

  IF v_app.amount_requested > v_max_loan THEN
    RAISE EXCEPTION
      'Loan amount of % exceeds the maximum collateral of % '
      '(borrower shares: %, borrower savings: %, co-maker shares: %, co-maker savings: %)',
      v_app.amount_requested, v_max_loan,
      v_borrower_shares, v_borrower_savings,
      v_comaker_shares, v_comaker_savings;
  END IF;

  -- ── Interest rate & calculation method ────────────────────────────────────
  IF v_app.loan_product_id IS NOT NULL THEN
    SELECT * INTO v_product FROM loan_products WHERE id = v_app.loan_product_id;
    v_interest_rate := v_product.interest_rate;
    v_calc_method   := v_product.calculation_method;
    v_rate_period   := COALESCE(v_product.interest_rate_period, 'monthly');
  ELSE
    SELECT COALESCE(config_value::DECIMAL, 3.33) INTO v_interest_rate
    FROM system_config WHERE config_key = 'loan_interest_rate';
    SELECT COALESCE(config_value, 'flat') INTO v_calc_method
    FROM system_config WHERE config_key = 'interest_calculation_method';
    v_rate_period := 'monthly';
  END IF;

  -- Monthly rate decimal
  IF v_rate_period = 'monthly' THEN
    v_r := v_interest_rate / 100.0;
  ELSE
    v_r := v_interest_rate / 100.0 / 12.0;
  END IF;

  -- ── Schedule calculation ──────────────────────────────────────────────────
  IF v_calc_method = 'flat' THEN
    v_total_repayable := v_app.amount_requested
      + (v_app.amount_requested * v_r * v_app.term_months);
    v_emi := v_total_repayable / v_app.term_months;
  ELSE
    IF v_r = 0 THEN
      v_emi := v_app.amount_requested / v_app.term_months;
    ELSE
      v_emi := v_app.amount_requested * v_r
        * POWER(1 + v_r, v_app.term_months)
        / (POWER(1 + v_r, v_app.term_months) - 1);
    END IF;
    v_total_repayable := v_emi * v_app.term_months;
  END IF;

  -- ── Approve application ───────────────────────────────────────────────────
  UPDATE loan_applications
  SET status = 'approved', reviewed_by = auth.uid(), decision_at = now(), updated_at = now()
  WHERE id = p_application_id;

  -- ── Create loan record ────────────────────────────────────────────────────
  INSERT INTO loans (
    application_id, user_id, principal, interest_rate, term_months,
    calculation_method, total_repayable, outstanding, due_date
  ) VALUES (
    p_application_id, v_app.user_id, v_app.amount_requested,
    v_interest_rate, v_app.term_months, v_calc_method,
    ROUND(v_total_repayable, 2), ROUND(v_total_repayable, 2),
    (now() + (v_app.term_months || ' months')::INTERVAL)::DATE
  ) RETURNING id INTO v_loan_id;

  -- ── Generate repayment schedule ───────────────────────────────────────────
  v_outstanding := v_app.amount_requested;
  FOR i IN 1..v_app.term_months LOOP
    IF v_calc_method = 'flat' THEN
      v_interest_pay  := ROUND(v_app.amount_requested * v_r, 2);
      v_principal_pay := ROUND(v_app.amount_requested / v_app.term_months, 2);
    ELSE
      v_interest_pay  := ROUND(v_outstanding * v_r, 2);
      IF i = v_app.term_months THEN
        v_principal_pay := ROUND(v_outstanding, 2);
      ELSE
        v_principal_pay := ROUND(v_emi - v_outstanding * v_r, 2);
      END IF;
    END IF;

    INSERT INTO loan_repayment_schedule (
      loan_id, installment_no, due_date, principal_due, interest_due, total_due
    ) VALUES (
      v_loan_id, i,
      (now() + (i || ' months')::INTERVAL)::DATE,
      v_principal_pay,
      v_interest_pay,
      v_principal_pay + v_interest_pay
    );

    v_outstanding := v_outstanding - v_principal_pay;
  END LOOP;

  -- ── Ledger entry for disbursement ─────────────────────────────────────────
  INSERT INTO ledger_entries (
    user_id, entry_type, reference_id, reference_table, amount, direction, notes, created_by
  ) VALUES (
    v_app.user_id, 'loan_disbursement', v_loan_id, 'loans',
    v_app.amount_requested, 'debit', 'Loan disbursed', auth.uid()
  );

  RETURN v_loan_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ─── O1: Mark overdue installments function (run daily via pg_cron) ───────────

CREATE OR REPLACE FUNCTION mark_overdue_loan_installments()
RETURNS INT AS $$
DECLARE
  v_count INT;
BEGIN
  UPDATE loan_repayment_schedule
  SET status = 'overdue'
  WHERE status IN ('pending', 'partial')
    AND due_date < CURRENT_DATE;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION mark_overdue_loan_installments() TO authenticated;

-- Schedule overdue detection daily at midnight (run in Supabase dashboard if pg_cron is enabled):
-- SELECT cron.schedule('mark-overdue-installments', '0 0 * * *', 'SELECT mark_overdue_loan_installments()');


-- ─── O4: Post-default resolution RPC ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION admin_resolve_loan_default(p_loan_id UUID, p_reason TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin') THEN
    RAISE EXCEPTION 'Access denied — only admin can resolve defaults';
  END IF;

  SELECT user_id INTO v_user_id FROM loans WHERE id = p_loan_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Loan not found'; END IF;

  UPDATE loans
  SET status = 'written_off', updated_at = now()
  WHERE id = p_loan_id AND status = 'defaulted';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Loan is not in defaulted status';
  END IF;

  -- Re-evaluate membership — may restore active status if no other defaults
  PERFORM evaluate_membership(v_user_id);
END;
$$;

GRANT EXECUTE ON FUNCTION admin_resolve_loan_default(UUID, TEXT) TO authenticated;
