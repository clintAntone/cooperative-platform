-- Make co-makers optional for loan approval.
-- Add savings balance requirement check.
-- Add loan_min_savings_balance to system_config.

INSERT INTO system_config (config_key, config_value, value_type, description)
VALUES ('loan_min_savings_balance', '500', 'number', 'Minimum savings balance required before a loan can be approved')
ON CONFLICT (config_key) DO NOTHING;

-- ─── Updated approval function ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION admin_approve_loan_application(p_application_id UUID)
RETURNS UUID AS $$
DECLARE
  v_app             loan_applications%ROWTYPE;
  v_product         loan_products%ROWTYPE;
  v_loan_id         UUID;
  v_interest_rate   DECIMAL;
  v_calc_method     VARCHAR;
  v_frequency       TEXT;
  v_n_periods       INT;
  v_periods_per_yr  DECIMAL;
  v_r               DECIMAL;
  v_emi             DECIMAL;
  v_outstanding     DECIMAL;
  v_principal_pay   DECIMAL;
  v_interest_pay    DECIMAL;
  v_total_repayable DECIMAL;
  v_interval        INTERVAL;
  v_co_maker_count  INT;
  v_pending_count   INT;
  v_declined_count  INT;
  v_savings_balance DECIMAL;
  v_min_savings     DECIMAL;
  i                 INT;
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin', 'staff') THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  SELECT * INTO v_app FROM loan_applications WHERE id = p_application_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Application not found'; END IF;
  IF v_app.status NOT IN ('submitted', 'under_review') THEN
    RAISE EXCEPTION 'Application is not in a reviewable state';
  END IF;

  -- Co-maker enforcement (co-makers are optional, but if present all must confirm)
  SELECT COUNT(*) INTO v_co_maker_count FROM loan_co_makers WHERE application_id = p_application_id;
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

  -- Savings balance requirement
  SELECT COALESCE(config_value::DECIMAL, 500) INTO v_min_savings
    FROM system_config WHERE config_key = 'loan_min_savings_balance';
  SELECT COALESCE(balance, 0) INTO v_savings_balance
    FROM savings_accounts WHERE user_id = v_app.user_id AND status = 'active';
  IF v_savings_balance < v_min_savings THEN
    RAISE EXCEPTION 'Cannot approve: member savings balance (%) is below the required minimum of %',
      v_savings_balance, v_min_savings;
  END IF;

  -- Load loan product
  SELECT * INTO v_product FROM loan_products WHERE id = v_app.loan_product_id;

  -- Determine interest rate, method, frequency
  IF v_product.id IS NOT NULL THEN
    v_interest_rate := v_product.interest_rate;
    IF (v_product.interest_rate_period = 'monthly') THEN
      v_interest_rate := v_interest_rate * 12;
    END IF;
    v_calc_method := v_product.calculation_method;
    v_frequency   := v_product.repayment_frequency;
  ELSE
    SELECT COALESCE(config_value::DECIMAL, 12) INTO v_interest_rate
      FROM system_config WHERE config_key = 'loan_interest_rate';
    SELECT COALESCE(config_value, 'reducing_balance') INTO v_calc_method
      FROM system_config WHERE config_key = 'interest_calculation_method';
    v_frequency := 'monthly';
  END IF;

  -- Map frequency → periods per year / installment count / interval
  CASE v_frequency
    WHEN 'weekly'      THEN
      v_periods_per_yr := 52;
      v_n_periods      := v_app.term_months * 4;
      v_interval       := '7 days'::INTERVAL;
    WHEN 'bi_weekly'   THEN
      v_periods_per_yr := 26;
      v_n_periods      := v_app.term_months * 2;
      v_interval       := '14 days'::INTERVAL;
    WHEN 'semi_monthly' THEN
      v_periods_per_yr := 24;
      v_n_periods      := v_app.term_months * 2;
      v_interval       := '15 days'::INTERVAL;
    ELSE  -- monthly
      v_periods_per_yr := 12;
      v_n_periods      := v_app.term_months;
      v_interval       := '1 month'::INTERVAL;
  END CASE;

  v_r := v_interest_rate / 100.0 / v_periods_per_yr;

  -- EMI / total repayable
  IF v_calc_method = 'flat' THEN
    v_total_repayable := v_app.amount_requested
      + (v_app.amount_requested * v_interest_rate / 100.0 * v_app.term_months / 12.0);
    v_emi := v_total_repayable / v_n_periods;
  ELSIF v_calc_method = 'equal_principal' THEN
    v_principal_pay   := ROUND(v_app.amount_requested / v_n_periods, 2);
    v_total_repayable := v_app.amount_requested;
  ELSE
    IF v_r = 0 THEN
      v_emi := v_app.amount_requested / v_n_periods;
    ELSE
      v_emi := v_app.amount_requested * v_r
        * POWER(1 + v_r, v_n_periods)
        / (POWER(1 + v_r, v_n_periods) - 1);
    END IF;
    v_total_repayable := v_emi * v_n_periods;
  END IF;

  -- Approve application
  UPDATE loan_applications
  SET status = 'approved', reviewed_by = auth.uid(), decision_at = now(), updated_at = now()
  WHERE id = p_application_id;

  -- Create loan record
  INSERT INTO loans (
    application_id, user_id, principal, interest_rate, term_months,
    calculation_method, repayment_frequency, total_repayable, outstanding, due_date
  ) VALUES (
    p_application_id, v_app.user_id, v_app.amount_requested,
    v_interest_rate, v_app.term_months,
    v_calc_method, v_frequency,
    ROUND(v_total_repayable, 2), ROUND(v_total_repayable, 2),
    (now() + v_interval * v_n_periods)::DATE
  ) RETURNING id INTO v_loan_id;

  -- Generate repayment schedule
  v_outstanding := v_app.amount_requested;
  FOR i IN 1..v_n_periods LOOP
    IF v_calc_method = 'flat' THEN
      v_interest_pay  := ROUND(v_app.amount_requested * v_interest_rate / 100.0 / v_periods_per_yr, 2);
      v_principal_pay := ROUND(v_app.amount_requested / v_n_periods, 2);
    ELSIF v_calc_method = 'equal_principal' THEN
      v_principal_pay := ROUND(v_app.amount_requested / v_n_periods, 2);
      v_interest_pay  := ROUND(v_outstanding * v_r, 2);
    ELSE
      v_interest_pay  := ROUND(v_outstanding * v_r, 2);
      IF i = v_n_periods THEN
        v_principal_pay := ROUND(v_outstanding, 2);
      ELSE
        v_principal_pay := ROUND(v_emi - v_outstanding * v_r, 2);
      END IF;
    END IF;

    INSERT INTO loan_repayment_schedule (
      loan_id, installment_no, due_date, principal_due, interest_due, total_due
    ) VALUES (
      v_loan_id, i,
      (now() + v_interval * i)::DATE,
      v_principal_pay,
      v_interest_pay,
      v_principal_pay + v_interest_pay
    );

    v_outstanding := v_outstanding - v_principal_pay;
  END LOOP;

  -- Ledger entry for disbursement
  INSERT INTO ledger_entries (
    user_id, entry_type, reference_id, reference_table, amount, direction, notes, created_by
  ) VALUES (
    v_app.user_id, 'loan_disbursement', v_loan_id, 'loans',
    v_app.amount_requested, 'debit', 'Loan disbursed', auth.uid()
  );

  RETURN v_loan_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
