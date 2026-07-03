-- Add updated_at to loans if missing
ALTER TABLE loans ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- Restructure an active loan: modify term/rate and regenerate future installments.
CREATE OR REPLACE FUNCTION restructure_loan(
  p_loan_id        UUID,
  p_new_term       INT,
  p_new_rate       DECIMAL,
  p_new_rate_period VARCHAR,  -- 'monthly' | 'annual'
  p_reason         TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_loan            loans%ROWTYPE;
  v_remaining       DECIMAL(15,2);
  v_r               DECIMAL;
  v_emi             DECIMAL;
  v_total_repayable DECIMAL;
  v_outstanding_bal DECIMAL;
  v_principal_pay   DECIMAL;
  v_interest_pay    DECIMAL;
  v_next_no         INT;
  i                 INT;
BEGIN
  IF get_user_role(auth.uid()) != 'admin' THEN
    RAISE EXCEPTION 'Permission denied: only admin can restructure loans';
  END IF;

  SELECT * INTO v_loan FROM loans WHERE id = p_loan_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Loan not found'; END IF;
  IF v_loan.status != 'active' THEN
    RAISE EXCEPTION 'Only active loans can be restructured';
  END IF;

  -- Remaining principal = current outstanding balance
  v_remaining := v_loan.outstanding;

  -- Highest installment number that is already paid or partial
  SELECT COALESCE(MAX(installment_no), 0) INTO v_next_no
  FROM loan_repayment_schedule
  WHERE loan_id = p_loan_id AND status IN ('paid', 'partial');

  -- Remove all future unpaid installments
  DELETE FROM loan_repayment_schedule
  WHERE loan_id = p_loan_id AND status NOT IN ('paid', 'partial');

  -- Normalise rate to monthly decimal
  IF p_new_rate_period = 'monthly' THEN
    v_r := p_new_rate / 100.0;
  ELSE
    v_r := p_new_rate / 100.0 / 12.0;
  END IF;

  -- Compute EMI based on calculation method
  IF v_loan.calculation_method = 'flat' THEN
    v_total_repayable := v_remaining + (v_remaining * v_r * p_new_term);
    v_emi             := v_total_repayable / p_new_term;
  ELSE
    IF v_r = 0 THEN
      v_emi := v_remaining / p_new_term;
    ELSE
      v_emi := v_remaining * v_r
        * POWER(1 + v_r, p_new_term)
        / (POWER(1 + v_r, p_new_term) - 1);
    END IF;
    v_total_repayable := v_emi * p_new_term;
  END IF;

  -- Generate new installments, continuing the sequence
  v_outstanding_bal := v_remaining;
  FOR i IN 1..p_new_term LOOP
    IF v_loan.calculation_method = 'flat' THEN
      v_interest_pay  := ROUND(v_remaining * v_r, 2);
      v_principal_pay := ROUND(v_remaining / p_new_term, 2);
    ELSE
      v_interest_pay := ROUND(v_outstanding_bal * v_r, 2);
      IF i = p_new_term THEN
        v_principal_pay := ROUND(v_outstanding_bal, 2);
      ELSE
        v_principal_pay := ROUND(v_emi - v_outstanding_bal * v_r, 2);
      END IF;
    END IF;

    INSERT INTO loan_repayment_schedule (
      loan_id, installment_no, due_date,
      principal_due, interest_due, total_due
    ) VALUES (
      p_loan_id,
      v_next_no + i,
      (now() + (i || ' months')::INTERVAL)::DATE,
      v_principal_pay,
      v_interest_pay,
      v_principal_pay + v_interest_pay
    );

    v_outstanding_bal := v_outstanding_bal - v_principal_pay;
  END LOOP;

  -- Update loan header
  UPDATE loans SET
    interest_rate   = p_new_rate,
    term_months     = v_next_no + p_new_term,
    total_repayable = v_loan.amount_paid + ROUND(v_total_repayable, 2),
    due_date        = (now() + (p_new_term || ' months')::INTERVAL)::DATE,
    updated_at      = now()
  WHERE id = p_loan_id;

  -- Audit
  INSERT INTO admin_audit_log (admin_id, action, metadata)
  VALUES (
    auth.uid(),
    'loan_restructured',
    jsonb_build_object(
      'loan_id',           p_loan_id,
      'new_term',          p_new_term,
      'new_rate',          p_new_rate,
      'new_rate_period',   p_new_rate_period,
      'reason',            p_reason,
      'remaining_balance', v_remaining
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION restructure_loan(UUID, INT, DECIMAL, VARCHAR, TEXT) TO authenticated;
