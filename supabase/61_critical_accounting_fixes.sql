-- Migration 61: Critical accounting fixes
--
-- Fixes four CRITICAL issues identified in the senior accountant audit:
--
-- 1. Dividend double-release guard  — UNIQUE constraint + idempotency check
-- 2. Rebate double-release guard    — UNIQUE constraint + idempotency check
-- 3. Damayan GL integration         — ledger entries on payment recording
-- 4. Loan disbursement double-entry — add missing CREDIT side ledger entry

-- ─── 1. Dividend double-release guard ────────────────────────────────────────

ALTER TABLE equity_dividend_logs
  ADD CONSTRAINT equity_dividend_logs_share_period_unique
  UNIQUE (share_id, period_start, period_end);

CREATE OR REPLACE FUNCTION release_equity_dividend()
RETURNS INT AS $$
DECLARE
  v_rate         DECIMAL;
  v_period_end   DATE := CURRENT_DATE;
  v_period_start DATE;
  v_count        INT := 0;
  v_dividend     DECIMAL(15,2);
  v_already_run  BOOLEAN;
  r              RECORD;
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin') THEN
    RAISE EXCEPTION 'Access denied — only admin can release dividends';
  END IF;

  SELECT COALESCE(config_value::DECIMAL, 5) INTO v_rate
  FROM system_config WHERE config_key = 'equity_dividend_rate';

  FOR r IN
    SELECT es.id AS share_id, es.user_id, es.target_amount
    FROM equity_shares es
    WHERE es.status = 'completed'
  LOOP
    -- Period start: last dividend for this share, or 1 year ago
    SELECT COALESCE(MAX(period_end), v_period_end - INTERVAL '1 year')
    INTO v_period_start
    FROM equity_dividend_logs WHERE share_id = r.share_id;

    -- Idempotency: skip if this share has already been credited for this exact period
    SELECT EXISTS (
      SELECT 1 FROM equity_dividend_logs
      WHERE share_id = r.share_id
        AND period_start = v_period_start::DATE
        AND period_end   = v_period_end
    ) INTO v_already_run;

    IF v_already_run THEN
      CONTINUE;
    END IF;

    v_dividend := ROUND(r.target_amount * v_rate / 100.0, 2);

    INSERT INTO equity_dividend_logs (share_id, user_id, share_value, dividend_earned, period_start, period_end, released_by)
    VALUES (r.share_id, r.user_id, r.target_amount, v_dividend, v_period_start::DATE, v_period_end, auth.uid());

    -- Credit to savings account if exists
    UPDATE savings_accounts
    SET balance = balance + v_dividend, updated_at = now()
    WHERE user_id = r.user_id AND status = 'active';

    -- Ledger entry
    INSERT INTO ledger_entries (user_id, entry_type, reference_id, reference_table, amount, direction, notes, created_by)
    VALUES (r.user_id, 'equity_dividend', r.share_id, 'equity_shares', v_dividend, 'credit', 'Equity share dividend', auth.uid());

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
GRANT EXECUTE ON FUNCTION release_equity_dividend() TO authenticated;

-- ─── 2. Rebate double-release guard ──────────────────────────────────────────

ALTER TABLE rebate_releases
  ADD CONSTRAINT rebate_releases_period_unique
  UNIQUE (period_start, period_end);

CREATE OR REPLACE FUNCTION release_rebates(p_period_start DATE, p_period_end DATE)
RETURNS UUID AS $$
DECLARE
  v_rate       DECIMAL;
  v_release_id UUID;
  v_total      DECIMAL(15,2) := 0;
  v_rebate     DECIMAL(15,2);
  v_existing   UUID;
  r            RECORD;
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin') THEN RAISE EXCEPTION 'Access denied'; END IF;

  -- Idempotency: reject if this period has already been released
  SELECT id INTO v_existing
  FROM rebate_releases
  WHERE period_start = p_period_start AND period_end = p_period_end;

  IF FOUND THEN
    RAISE EXCEPTION 'Rebates for period % – % have already been released (release id: %)',
      p_period_start, p_period_end, v_existing;
  END IF;

  SELECT COALESCE(config_value::DECIMAL, 10) INTO v_rate
  FROM system_config WHERE config_key = 'rebate_rate';

  -- Create release record
  INSERT INTO rebate_releases (period_start, period_end, rebate_rate, released_by, notes)
  VALUES (p_period_start, p_period_end, v_rate, auth.uid(), 'Loan interest rebate')
  RETURNING id INTO v_release_id;

  FOR r IN
    SELECT
      l.user_id,
      COALESCE(SUM(lrs.interest_due), 0) AS interest_paid
    FROM loan_repayment_schedule lrs
    JOIN loans l ON l.id = lrs.loan_id
    WHERE lrs.status = 'paid'
      AND lrs.paid_at >= p_period_start::TIMESTAMPTZ
      AND lrs.paid_at < (p_period_end + INTERVAL '1 day')::TIMESTAMPTZ
    GROUP BY l.user_id
    HAVING SUM(lrs.interest_due) > 0
  LOOP
    v_rebate := ROUND(r.interest_paid * v_rate / 100.0, 2);

    INSERT INTO rebate_logs (release_id, user_id, interest_paid, rebate_rate, rebate_amount)
    VALUES (v_release_id, r.user_id, r.interest_paid, v_rate, v_rebate);

    -- Credit to savings if exists
    UPDATE savings_accounts SET balance = balance + v_rebate, updated_at = now()
    WHERE user_id = r.user_id AND status = 'active';

    -- Ledger entry
    INSERT INTO ledger_entries (user_id, entry_type, reference_id, reference_table, amount, direction, notes, created_by)
    VALUES (r.user_id, 'rebate', v_release_id, 'rebate_releases', v_rebate, 'credit', 'Loan interest rebate', auth.uid());

    v_total := v_total + v_rebate;
  END LOOP;

  UPDATE rebate_releases SET total_amount = v_total WHERE id = v_release_id;

  RETURN v_release_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
GRANT EXECUTE ON FUNCTION release_rebates(DATE, DATE) TO authenticated;

-- ─── 3. Damayan GL integration ────────────────────────────────────────────────

-- Extend ledger entry_type to include damayan entries
ALTER TABLE ledger_entries DROP CONSTRAINT IF EXISTS ledger_entries_entry_type_check;
ALTER TABLE ledger_entries ADD CONSTRAINT ledger_entries_entry_type_check CHECK (entry_type IN (
  'equity_contribution','equity_reversal',
  'loan_disbursement','loan_disbursement_liability','loan_repayment',
  'fee','adjustment',
  'savings_deposit','savings_withdrawal','savings_interest',
  'equity_dividend',
  'share_transfer_out','share_transfer_in',
  'rebate',
  'damayan_collection'
));

-- record_damayan_payment: now also writes a ledger entry
CREATE OR REPLACE FUNCTION record_damayan_payment(p_assessment_id UUID, p_notes TEXT DEFAULT NULL)
RETURNS VOID AS $$
DECLARE
  v_assessment damayan_assessments%ROWTYPE;
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin','staff') THEN RAISE EXCEPTION 'Access denied'; END IF;

  SELECT * INTO v_assessment FROM damayan_assessments WHERE id = p_assessment_id AND status = 'pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'Assessment not found or already processed'; END IF;

  UPDATE damayan_assessments
  SET status = 'paid', amount_paid = amount_due, paid_at = now(), notes = p_notes, updated_at = now()
  WHERE id = p_assessment_id;

  -- Ledger entry: debit the member (they paid into the mutual-aid fund)
  INSERT INTO ledger_entries (user_id, entry_type, reference_id, reference_table, amount, direction, notes, created_by)
  VALUES (
    v_assessment.user_id,
    'damayan_collection',
    v_assessment.id,
    'damayan_assessments',
    v_assessment.amount_due,
    'debit',
    'Damayan mutual-aid fund contribution',
    auth.uid()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
GRANT EXECUTE ON FUNCTION record_damayan_payment(UUID, TEXT) TO authenticated;

-- ─── 4. Loan disbursement — add missing CREDIT side ──────────────────────────
--
-- Double-entry for loan disbursement:
--   DR  Loans Receivable (member account) — 'loan_disbursement' / 'debit'   [already exists]
--   CR  Cash / Funds Payable              — 'loan_disbursement_liability' / 'credit'  [NEW]
--
-- The credit entry is recorded against the coop's internal account (user_id = approver).
-- This mirrors the cash leaving the fund when the loan is paid out.

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

  -- ── Double-entry ledger for disbursement ──────────────────────────────────
  -- DR  Member loans receivable (asset increases — money owed to coop)
  INSERT INTO ledger_entries (
    user_id, entry_type, reference_id, reference_table, amount, direction, notes, created_by
  ) VALUES (
    v_app.user_id, 'loan_disbursement', v_loan_id, 'loans',
    v_app.amount_requested, 'debit', 'Loan disbursed — receivable', auth.uid()
  );

  -- CR  Cash / fund payable (liability increases — cash left the fund)
  INSERT INTO ledger_entries (
    user_id, entry_type, reference_id, reference_table, amount, direction, notes, created_by
  ) VALUES (
    v_app.user_id, 'loan_disbursement_liability', v_loan_id, 'loans',
    v_app.amount_requested, 'credit', 'Loan disbursed — cash out', auth.uid()
  );

  RETURN v_loan_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
