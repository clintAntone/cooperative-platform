-- Migration 57: Fix co-maker collateral formula
--
-- Old rule: max loan = borrower_shares + borrower_savings + co_maker_shares + co_maker_savings
-- New rule: max loan = borrower_shares + borrower_savings + co_maker_shares
--           Co-maker savings are NOT part of the collateral pool.

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
  v_borrower_only    DECIMAL(15,2);
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

  -- ── Borrower's collateral ─────────────────────────────────────────────────
  SELECT COALESCE(SUM(target_amount), 0) INTO v_borrower_shares
  FROM equity_shares
  WHERE user_id = v_app.user_id AND status = 'completed';

  SELECT COALESCE(balance, 0) INTO v_borrower_savings
  FROM savings_accounts WHERE user_id = v_app.user_id;

  v_borrower_only := v_borrower_shares + v_borrower_savings;

  -- ── Co-maker checks ───────────────────────────────────────────────────────
  SELECT COUNT(*) INTO v_co_maker_count
  FROM loan_co_makers WHERE application_id = p_application_id;

  -- Co-maker required only when loan amount exceeds borrower's own collateral
  IF v_app.amount_requested > v_borrower_only AND v_co_maker_count = 0 THEN
    RAISE EXCEPTION
      'A co-maker is required: loan amount of % exceeds borrower collateral of % (shares: %, savings: %)',
      v_app.amount_requested, v_borrower_only, v_borrower_shares, v_borrower_savings;
  END IF;

  -- All attached co-makers must have responded
  IF v_co_maker_count > 0 THEN
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
  END IF;

  -- ── Collateral-based max loan calculation ──────────────────────────────────
  -- Co-maker collateral = their completed shares only (savings excluded)
  SELECT COALESCE(SUM(es_total.share_val), 0)
  INTO v_comaker_shares
  FROM loan_co_makers lcm
  LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(target_amount), 0) AS share_val
    FROM equity_shares
    WHERE user_id = lcm.co_maker_user_id AND status = 'completed'
  ) es_total ON TRUE
  WHERE lcm.application_id = p_application_id
    AND lcm.status = 'confirmed';

  v_max_loan := v_borrower_only + v_comaker_shares;

  IF v_app.amount_requested > v_max_loan THEN
    RAISE EXCEPTION
      'Loan amount of % exceeds the maximum collateral of % '
      '(borrower shares: %, borrower savings: %, co-maker shares: %)',
      v_app.amount_requested, v_max_loan,
      v_borrower_shares, v_borrower_savings, v_comaker_shares;
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
