-- Admin approve loan application
-- Enforces: all co-makers must have confirmed, no pending/declined
-- Creates: loan record + full repayment schedule (flat or reducing balance) + ledger entry
CREATE OR REPLACE FUNCTION admin_approve_loan_application(p_application_id UUID)
RETURNS UUID AS $$
DECLARE
  v_app             loan_applications%ROWTYPE;
  v_loan_id         UUID;
  v_interest_rate   DECIMAL;
  v_calc_method     VARCHAR;
  v_r               DECIMAL;
  v_emi             DECIMAL;
  v_outstanding     DECIMAL;
  v_principal_pay   DECIMAL;
  v_interest_pay    DECIMAL;
  v_total_repayable DECIMAL;
  v_co_maker_count  INT;
  v_pending_count   INT;
  v_declined_count  INT;
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

  -- Co-maker enforcement
  SELECT COUNT(*) INTO v_co_maker_count FROM loan_co_makers WHERE application_id = p_application_id;
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

  -- Read config
  SELECT COALESCE(config_value::DECIMAL, 12) INTO v_interest_rate
    FROM system_config WHERE config_key = 'loan_interest_rate';
  SELECT COALESCE(config_value, 'reducing_balance') INTO v_calc_method
    FROM system_config WHERE config_key = 'interest_calculation_method';

  -- Calculate schedule
  IF v_calc_method = 'flat' THEN
    v_total_repayable := v_app.amount_requested
      + (v_app.amount_requested * v_interest_rate / 100 * v_app.term_months / 12);
    v_emi := v_total_repayable / v_app.term_months;
  ELSE
    v_r := v_interest_rate / 100.0 / 12.0;
    IF v_r = 0 THEN
      v_emi := v_app.amount_requested / v_app.term_months;
    ELSE
      v_emi := v_app.amount_requested * v_r
        * POWER(1 + v_r, v_app.term_months)
        / (POWER(1 + v_r, v_app.term_months) - 1);
    END IF;
    v_total_repayable := v_emi * v_app.term_months;
  END IF;

  -- Approve application
  UPDATE loan_applications
  SET status = 'approved', reviewed_by = auth.uid(), decision_at = now(), updated_at = now()
  WHERE id = p_application_id;

  -- Create loan
  INSERT INTO loans (
    application_id, user_id, principal, interest_rate, term_months,
    calculation_method, total_repayable, outstanding, due_date
  ) VALUES (
    p_application_id, v_app.user_id, v_app.amount_requested,
    v_interest_rate, v_app.term_months, v_calc_method,
    ROUND(v_total_repayable, 2), ROUND(v_total_repayable, 2),
    (now() + (v_app.term_months || ' months')::INTERVAL)::DATE
  ) RETURNING id INTO v_loan_id;

  -- Generate repayment schedule
  v_outstanding := v_app.amount_requested;
  FOR i IN 1..v_app.term_months LOOP
    IF v_calc_method = 'flat' THEN
      v_interest_pay  := ROUND(v_app.amount_requested * v_interest_rate / 100.0 / 12.0, 2);
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

-- Admin reject loan application
CREATE OR REPLACE FUNCTION admin_reject_loan_application(
  p_application_id UUID,
  p_reason         TEXT DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin', 'staff') THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  UPDATE loan_applications
  SET status = 'rejected',
      reviewed_by = auth.uid(),
      decision_at = now(),
      rejection_reason = p_reason,
      updated_at = now()
  WHERE id = p_application_id
    AND status IN ('submitted', 'under_review');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Application not found or not in a reviewable state';
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Admin mark loan as under review
CREATE OR REPLACE FUNCTION admin_set_loan_under_review(p_application_id UUID)
RETURNS VOID AS $$
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin', 'staff') THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  UPDATE loan_applications
  SET status = 'under_review', updated_at = now()
  WHERE id = p_application_id AND status = 'submitted';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Admin mark loan as defaulted (triggers membership suspension via existing trigger)
CREATE OR REPLACE FUNCTION admin_mark_loan_defaulted(p_loan_id UUID)
RETURNS VOID AS $$
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin', 'staff') THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  UPDATE loans SET status = 'defaulted' WHERE id = p_loan_id AND status = 'active';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Loan not found or not active';
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
