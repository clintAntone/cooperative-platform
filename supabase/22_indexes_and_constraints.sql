-- ─── Performance indexes ─────────────────────────────────────────────────────
-- These cover the most common query patterns across the app.

CREATE INDEX IF NOT EXISTS idx_profiles_role_status
  ON profiles(role, account_status);

CREATE INDEX IF NOT EXISTS idx_equity_shares_user_status
  ON equity_shares(user_id, status);

CREATE INDEX IF NOT EXISTS idx_equity_contributions_user_created
  ON equity_contributions(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_loan_applications_status_created
  ON loan_applications(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_loan_applications_user_id
  ON loan_applications(user_id);

CREATE INDEX IF NOT EXISTS idx_loans_user_status
  ON loans(user_id, status);

CREATE INDEX IF NOT EXISTS idx_loans_status
  ON loans(status);

CREATE INDEX IF NOT EXISTS idx_loan_repayments_loan_created
  ON loan_repayments(loan_id, payment_at DESC);

CREATE INDEX IF NOT EXISTS idx_loan_co_makers_app_id
  ON loan_co_makers(application_id);

CREATE INDEX IF NOT EXISTS idx_loan_co_makers_user_status
  ON loan_co_makers(co_maker_user_id, status);

CREATE INDEX IF NOT EXISTS idx_deposit_requests_status_created
  ON deposit_requests(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_deposit_requests_user_id
  ON deposit_requests(user_id);

CREATE INDEX IF NOT EXISTS idx_ledger_user_created
  ON ledger_entries(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_membership_status_user
  ON membership_status(user_id);

CREATE INDEX IF NOT EXISTS idx_loan_repayment_schedule_loan
  ON loan_repayment_schedule(loan_id, installment_no ASC);

-- ─── Data integrity constraints ───────────────────────────────────────────────

-- Prevent paid_amount from exceeding target on equity shares
ALTER TABLE equity_shares
  DROP CONSTRAINT IF EXISTS chk_paid_not_exceed_target;

ALTER TABLE equity_shares
  ADD CONSTRAINT chk_paid_not_exceed_target
  CHECK (paid_amount >= 0 AND paid_amount <= target_amount * 1.01);
  -- 1% tolerance allows for rounding differences during overflow crediting

-- Prevent negative outstanding balance on loans
ALTER TABLE loans
  DROP CONSTRAINT IF EXISTS chk_outstanding_non_negative;

ALTER TABLE loans
  ADD CONSTRAINT chk_outstanding_non_negative
  CHECK (outstanding >= 0);

-- Ensure deposit request amounts are positive (belt-and-suspenders)
ALTER TABLE deposit_requests
  DROP CONSTRAINT IF EXISTS chk_deposit_amount_positive;

ALTER TABLE deposit_requests
  ADD CONSTRAINT chk_deposit_amount_positive
  CHECK (amount > 0);
