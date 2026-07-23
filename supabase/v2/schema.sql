-- ============================================================
-- COOPERATIVE PLATFORM — COMPLETE SCHEMA (v2, fresh install)
-- Paste this entire file into the Supabase SQL Editor and run.
-- No incremental migrations needed — this is the final state.
-- ============================================================

-- ─── PART 1: TABLES ───────────────────────────────────────────────────────────

-- System config
CREATE TABLE system_config (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_key   VARCHAR UNIQUE NOT NULL,
  config_value VARCHAR NOT NULL,
  value_type   VARCHAR CHECK (value_type IN ('string','number','boolean','enum')) NOT NULL,
  description  TEXT,
  updated_by   UUID REFERENCES auth.users(id),
  updated_at   TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE system_config_history (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_key VARCHAR NOT NULL,
  old_value  VARCHAR,
  new_value  VARCHAR NOT NULL,
  changed_by UUID REFERENCES auth.users(id),
  changed_at TIMESTAMPTZ DEFAULT now()
);

-- Profiles (extends auth.users)
CREATE TABLE profiles (
  id                      UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name               VARCHAR NOT NULL,
  phone                   VARCHAR,
  role                    VARCHAR CHECK (role IN ('admin','member','staff','board')) NOT NULL DEFAULT 'member',
  account_status          VARCHAR CHECK (account_status IN ('active','suspended','inactive')) NOT NULL DEFAULT 'active',
  employee_id             VARCHAR UNIQUE,
  avatar_url              TEXT,
  date_of_birth           DATE,
  address                 TEXT,
  civil_status            VARCHAR(20) CHECK (civil_status IN ('single','married','widowed','separated','divorced')),
  emergency_contact_name  VARCHAR(255),
  emergency_contact_phone VARCHAR(50),
  profile_completed_at    TIMESTAMPTZ,
  deleted_at              TIMESTAMPTZ,
  created_at              TIMESTAMPTZ DEFAULT now(),
  updated_at              TIMESTAMPTZ DEFAULT now()
);

-- Equity shares
CREATE TABLE equity_shares (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  share_number  INT NOT NULL,
  target_amount DECIMAL(15,2) NOT NULL,
  paid_amount   DECIMAL(15,2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  status        VARCHAR CHECK (status IN ('in_progress','completed','cancelled')) NOT NULL DEFAULT 'in_progress',
  completed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, share_number)
);

-- Equity contributions (payments against a share)
CREATE TABLE equity_contributions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES profiles(id),
  share_id        UUID NOT NULL REFERENCES equity_shares(id),
  amount          DECIMAL(15,2) NOT NULL CHECK (amount > 0),
  payment_method  VARCHAR CHECK (payment_method IN ('cash','bank_transfer','mobile_money')) NOT NULL,
  reference       VARCHAR,
  recorded_by     UUID REFERENCES profiles(id),
  contribution_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- Equity deposit requests (member submits, admin approves)
CREATE TABLE equity_deposit_requests (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES profiles(id),
  share_id         UUID NOT NULL REFERENCES equity_shares(id),
  amount           DECIMAL(15,2) NOT NULL CHECK (amount > 0),
  payment_method   VARCHAR CHECK (payment_method IN ('cash','bank_transfer','mobile_money')) NOT NULL,
  reference        VARCHAR,
  receipt_url      VARCHAR,
  notes            TEXT,
  status           VARCHAR CHECK (status IN ('pending','approved','rejected')) NOT NULL DEFAULT 'pending',
  reviewed_by      UUID REFERENCES profiles(id),
  reviewed_at      TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);

-- Membership
CREATE TABLE membership_status (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES profiles(id) UNIQUE,
  status            VARCHAR CHECK (status IN ('pending','active','suspended','inactive')) NOT NULL DEFAULT 'pending',
  completed_shares  INT NOT NULL DEFAULT 0,
  reason            VARCHAR,
  last_evaluated_at TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE membership_history (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES profiles(id),
  from_status VARCHAR,
  to_status   VARCHAR NOT NULL,
  reason      TEXT,
  changed_at  TIMESTAMPTZ DEFAULT now()
);

-- Loan products (templates defined by admin)
CREATE TABLE loan_products (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  TEXT NOT NULL,
  description           TEXT,
  interest_rate         NUMERIC(5,2) NOT NULL,
  interest_rate_period  TEXT NOT NULL DEFAULT 'annual' CHECK (interest_rate_period IN ('monthly','annual')),
  min_amount            NUMERIC(12,2) NOT NULL DEFAULT 0,
  max_amount            NUMERIC(12,2),
  min_term_months       INT NOT NULL DEFAULT 1,
  max_term_months       INT NOT NULL DEFAULT 36,
  calculation_method    TEXT NOT NULL DEFAULT 'reducing_balance'
                          CHECK (calculation_method IN ('flat','reducing_balance','equal_principal')),
  repayment_frequency   TEXT NOT NULL DEFAULT 'monthly'
                          CHECK (repayment_frequency IN ('weekly','bi_weekly','semi_monthly','monthly')),
  processing_fee_type   TEXT CHECK (processing_fee_type IN ('fixed','percentage')),
  processing_fee_value  NUMERIC,
  insurance_type        TEXT CHECK (insurance_type IN ('fixed','percentage')),
  insurance_value       NUMERIC,
  service_fee_type      TEXT CHECK (service_fee_type IN ('fixed','percentage')),
  service_fee_value     NUMERIC,
  cbu_type              TEXT CHECK (cbu_type IN ('fixed','percentage')),
  cbu_value             NUMERIC,
  is_active             BOOLEAN NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by            UUID REFERENCES auth.users(id)
);

-- Loan applications
CREATE TABLE loan_applications (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES profiles(id),
  loan_product_id  UUID REFERENCES loan_products(id),
  amount_requested DECIMAL(15,2) NOT NULL CHECK (amount_requested > 0),
  purpose          TEXT,
  term_months      INT NOT NULL,
  status           VARCHAR CHECK (status IN ('draft','submitted','under_review','approved','rejected','cancelled')) NOT NULL DEFAULT 'draft',
  reviewed_by      UUID REFERENCES profiles(id),
  decision_at      TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);

-- Loan co-makers
CREATE TABLE loan_co_makers (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id   UUID NOT NULL REFERENCES loan_applications(id) ON DELETE CASCADE,
  co_maker_user_id UUID NOT NULL REFERENCES profiles(id),
  status           VARCHAR CHECK (status IN ('pending','confirmed','declined')) NOT NULL DEFAULT 'pending',
  responded_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT now(),
  UNIQUE(application_id, co_maker_user_id)
);

-- Loans (approved & disbursed)
CREATE TABLE loans (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id       UUID REFERENCES loan_applications(id), -- nullable for bulk imports
  user_id              UUID NOT NULL REFERENCES profiles(id),
  principal            DECIMAL(15,2) NOT NULL,
  interest_rate        DECIMAL(5,2) NOT NULL,
  term_months          INT NOT NULL,
  calculation_method   VARCHAR CHECK (calculation_method IN ('flat','reducing_balance','equal_principal')) NOT NULL,
  repayment_frequency  TEXT NOT NULL DEFAULT 'monthly'
                         CHECK (repayment_frequency IN ('weekly','bi_weekly','semi_monthly','monthly')),
  total_repayable      DECIMAL(15,2) NOT NULL,
  amount_paid          DECIMAL(15,2) NOT NULL DEFAULT 0,
  outstanding          DECIMAL(15,2) NOT NULL CHECK (outstanding >= 0),
  status               VARCHAR CHECK (status IN ('active','completed','defaulted','written_off')) NOT NULL DEFAULT 'active',
  disbursed_at         TIMESTAMPTZ DEFAULT now(),
  due_date             DATE NOT NULL,
  created_at           TIMESTAMPTZ DEFAULT now(),
  updated_at           TIMESTAMPTZ DEFAULT now()
);

-- Loan repayment schedules
CREATE TABLE loan_repayment_schedules (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id         UUID NOT NULL REFERENCES loans(id),
  installment_no  INT NOT NULL,
  due_date        DATE NOT NULL,
  principal_due   DECIMAL(15,2) NOT NULL,
  interest_due    DECIMAL(15,2) NOT NULL,
  total_due       DECIMAL(15,2) NOT NULL,
  amount_paid     DECIMAL(15,2) NOT NULL DEFAULT 0,
  status          VARCHAR CHECK (status IN ('pending','partial','paid','overdue','waived')) NOT NULL DEFAULT 'pending',
  paid_at         TIMESTAMPTZ,
  UNIQUE(loan_id, installment_no)
);

-- Loan repayments
CREATE TABLE loan_repayments (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id        UUID NOT NULL REFERENCES loans(id),
  schedule_id    UUID REFERENCES loan_repayment_schedules(id),
  amount         DECIMAL(15,2) NOT NULL CHECK (amount > 0),
  payment_method VARCHAR CHECK (payment_method IN ('cash','bank_transfer','mobile_money')) NOT NULL,
  reference      VARCHAR,
  recorded_by    UUID REFERENCES profiles(id),
  payment_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at     TIMESTAMPTZ DEFAULT now()
);

-- Ledger
CREATE TABLE ledger_entries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES profiles(id),
  entry_type      VARCHAR CHECK (entry_type IN (
                    'equity_contribution','equity_reversal',
                    'loan_disbursement','loan_repayment',
                    'fee','adjustment',
                    'savings_deposit','savings_withdrawal','savings_interest',
                    'equity_dividend',
                    'share_transfer_out','share_transfer_in',
                    'savings_withdrawal','damayan_payment','rebate'
                  )) NOT NULL,
  reference_id    UUID NOT NULL,
  reference_table VARCHAR NOT NULL,
  amount          DECIMAL(15,2) NOT NULL,
  direction       VARCHAR CHECK (direction IN ('debit','credit')) NOT NULL,
  notes           TEXT,
  created_by      UUID REFERENCES profiles(id),
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- Admin audit log
CREATE TABLE admin_audit_log (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id       UUID NOT NULL REFERENCES auth.users(id),
  action         TEXT NOT NULL,
  target_user_id UUID REFERENCES auth.users(id),
  metadata       JSONB,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Savings
CREATE TABLE savings_accounts (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL UNIQUE REFERENCES profiles(id),
  balance    DECIMAL(15,2) NOT NULL DEFAULT 0 CHECK (balance >= 0),
  status     VARCHAR CHECK (status IN ('active','closed','dormant')) NOT NULL DEFAULT 'active',
  opened_at  TIMESTAMPTZ DEFAULT now(),
  closed_at  TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE savings_deposit_requests (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES profiles(id),
  account_id       UUID NOT NULL REFERENCES savings_accounts(id),
  amount           DECIMAL(15,2) NOT NULL CHECK (amount > 0),
  payment_method   VARCHAR CHECK (payment_method IN ('cash','bank_transfer','mobile_money')) NOT NULL,
  reference        VARCHAR,
  receipt_url      VARCHAR,
  notes            TEXT,
  status           VARCHAR CHECK (status IN ('pending','approved','rejected')) NOT NULL DEFAULT 'pending',
  reviewed_by      UUID REFERENCES profiles(id),
  reviewed_at      TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE savings_contributions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     UUID NOT NULL REFERENCES savings_accounts(id),
  user_id        UUID NOT NULL REFERENCES profiles(id),
  request_id     UUID REFERENCES savings_deposit_requests(id),
  amount         DECIMAL(15,2) NOT NULL CHECK (amount > 0),
  payment_method VARCHAR NOT NULL,
  reference      VARCHAR,
  recorded_by    UUID REFERENCES profiles(id),
  contributed_at TIMESTAMPTZ DEFAULT now(),
  created_at     TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE savings_withdrawal_requests (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES profiles(id),
  account_id       UUID NOT NULL REFERENCES savings_accounts(id),
  amount           DECIMAL(15,2) NOT NULL CHECK (amount > 0),
  reason           TEXT,
  status           VARCHAR CHECK (status IN ('pending','approved','rejected')) NOT NULL DEFAULT 'pending',
  reviewed_by      UUID REFERENCES profiles(id),
  reviewed_at      TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE savings_interest_logs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     UUID NOT NULL REFERENCES savings_accounts(id),
  user_id        UUID NOT NULL REFERENCES profiles(id),
  period_start   TIMESTAMPTZ NOT NULL,
  period_end     TIMESTAMPTZ NOT NULL,
  average_daily_balance DECIMAL(15,2),
  interest_rate  DECIMAL(5,4),
  interest_amount DECIMAL(15,2) NOT NULL,
  released_by    UUID REFERENCES profiles(id),
  created_at     TIMESTAMPTZ DEFAULT now(),
  UNIQUE(account_id, period_start, period_end)
);

-- Batch deposits
CREATE TABLE batch_deposits (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference        VARCHAR,
  payment_method   VARCHAR CHECK (payment_method IN ('cash','bank_transfer','mobile_money')) NOT NULL,
  receipt_url      VARCHAR,
  notes            TEXT,
  total_amount     DECIMAL(15,2) NOT NULL CHECK (total_amount > 0),
  status           VARCHAR CHECK (status IN ('pending','approved','rejected')) NOT NULL DEFAULT 'pending',
  submitted_by     UUID NOT NULL REFERENCES profiles(id),
  reviewed_by      UUID REFERENCES profiles(id),
  reviewed_at      TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE batch_deposit_items (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id           UUID NOT NULL REFERENCES batch_deposits(id) ON DELETE CASCADE,
  user_id            UUID NOT NULL REFERENCES profiles(id),
  amount             DECIMAL(15,2) NOT NULL CHECK (amount > 0),
  deposit_request_id UUID REFERENCES equity_deposit_requests(id),
  created_at         TIMESTAMPTZ DEFAULT now()
);

-- Member documents & notes
CREATE TABLE member_documents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  document_type VARCHAR CHECK (document_type IN ('government_id','proof_of_address','other')) NOT NULL,
  file_name     TEXT NOT NULL,
  file_url      TEXT NOT NULL,
  uploaded_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE member_notes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  author_id  UUID NOT NULL REFERENCES profiles(id),
  note       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Equity dividends
CREATE TABLE equity_dividend_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  share_id        UUID NOT NULL REFERENCES equity_shares(id),
  user_id         UUID NOT NULL REFERENCES profiles(id),
  share_value     DECIMAL(15,2) NOT NULL,
  dividend_earned DECIMAL(15,2) NOT NULL,
  period_start    DATE NOT NULL,
  period_end      DATE NOT NULL,
  released_by     UUID REFERENCES profiles(id),
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(share_id, period_start, period_end)
);

-- Share transfers
CREATE TABLE equity_share_transfers (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  share_id         UUID NOT NULL REFERENCES equity_shares(id),
  from_user_id     UUID NOT NULL REFERENCES profiles(id),
  to_user_id       UUID NOT NULL REFERENCES profiles(id),
  reason           TEXT,
  status           VARCHAR CHECK (status IN ('pending','approved','rejected')) NOT NULL DEFAULT 'pending',
  reviewed_by      UUID REFERENCES profiles(id),
  reviewed_at      TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);

-- Damayan (mutual aid)
CREATE TABLE damayan_events (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title              VARCHAR NOT NULL,
  description        TEXT,
  affected_member_id UUID REFERENCES profiles(id),
  event_date         DATE NOT NULL,
  assessment_amount  DECIMAL(15,2) NOT NULL CHECK (assessment_amount > 0),
  status             VARCHAR CHECK (status IN ('active','closed')) NOT NULL DEFAULT 'active',
  created_by         UUID NOT NULL REFERENCES profiles(id),
  created_at         TIMESTAMPTZ DEFAULT now(),
  updated_at         TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE damayan_assessments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    UUID NOT NULL REFERENCES damayan_events(id),
  user_id     UUID NOT NULL REFERENCES profiles(id),
  amount_due  DECIMAL(15,2) NOT NULL,
  amount_paid DECIMAL(15,2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  status      VARCHAR CHECK (status IN ('pending','paid','waived')) NOT NULL DEFAULT 'pending',
  paid_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE(event_id, user_id)
);

-- Branches
CREATE TABLE branches (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              VARCHAR NOT NULL,
  code              VARCHAR UNIQUE,
  location          TEXT,
  report_cutoff_day INT DEFAULT 25 CHECK (report_cutoff_day BETWEEN 1 AND 28),
  is_active         BOOLEAN DEFAULT true,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE branch_income (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id   UUID NOT NULL REFERENCES branches(id),
  recorded_by UUID NOT NULL REFERENCES profiles(id),
  amount      DECIMAL(15,2) NOT NULL CHECK (amount > 0),
  category    VARCHAR NOT NULL DEFAULT 'sales',
  description TEXT,
  income_date DATE NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE branch_income_breakdown (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_income_id UUID NOT NULL REFERENCES branch_income(id) ON DELETE CASCADE,
  label            VARCHAR NOT NULL,
  amount           DECIMAL(15,2) NOT NULL CHECK (amount >= 0),
  created_at       TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE branch_expenses (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id    UUID NOT NULL REFERENCES branches(id),
  recorded_by  UUID NOT NULL REFERENCES profiles(id),
  amount       DECIMAL(15,2) NOT NULL CHECK (amount > 0),
  category     VARCHAR NOT NULL DEFAULT 'operational',
  description  TEXT,
  expense_date DATE NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now()
);

-- Rebates
CREATE TABLE rebate_releases (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_start DATE NOT NULL,
  period_end   DATE NOT NULL,
  rate         DECIMAL(5,2) NOT NULL,
  released_by  UUID REFERENCES profiles(id),
  released_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE(period_start, period_end)
);

CREATE TABLE rebate_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  release_id  UUID NOT NULL REFERENCES rebate_releases(id),
  user_id     UUID NOT NULL REFERENCES profiles(id),
  loan_id     UUID NOT NULL REFERENCES loans(id),
  interest_paid DECIMAL(15,2) NOT NULL,
  rebate_amount DECIMAL(15,2) NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE(release_id, loan_id)
);

-- Role permissions
CREATE TABLE role_permissions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role           TEXT NOT NULL CHECK (role IN ('staff','member')),
  permission_key TEXT NOT NULL,
  enabled        BOOLEAN NOT NULL DEFAULT false,
  updated_by     UUID REFERENCES auth.users(id),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(role, permission_key)
);

-- Custom roles
CREATE TABLE custom_roles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL UNIQUE,
  description TEXT,
  created_by  UUID REFERENCES profiles(id),
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE custom_role_permissions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  custom_role_id UUID NOT NULL REFERENCES custom_roles(id) ON DELETE CASCADE,
  permission_key TEXT NOT NULL,
  enabled        BOOLEAN NOT NULL DEFAULT true,
  UNIQUE(custom_role_id, permission_key)
);

CREATE TABLE profile_custom_roles (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  custom_role_id UUID NOT NULL REFERENCES custom_roles(id) ON DELETE CASCADE,
  assigned_by    UUID REFERENCES profiles(id),
  assigned_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE(profile_id, custom_role_id)
);

-- ─── PART 2: INDEXES ──────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_profiles_role_status ON profiles(role, account_status);
CREATE INDEX IF NOT EXISTS idx_equity_shares_user_status ON equity_shares(user_id, status);
CREATE INDEX IF NOT EXISTS idx_equity_contributions_user_created ON equity_contributions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_equity_deposit_requests_status ON equity_deposit_requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_equity_deposit_requests_user ON equity_deposit_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_loan_applications_status ON loan_applications(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_loan_applications_user ON loan_applications(user_id);
CREATE INDEX IF NOT EXISTS idx_loans_user_status ON loans(user_id, status);
CREATE INDEX IF NOT EXISTS idx_loan_repayment_schedules_loan ON loan_repayment_schedules(loan_id, installment_no ASC);
CREATE INDEX IF NOT EXISTS idx_loan_repayments_loan ON loan_repayments(loan_id, payment_at DESC);
CREATE INDEX IF NOT EXISTS idx_loan_co_makers_app ON loan_co_makers(application_id);
CREATE INDEX IF NOT EXISTS idx_loan_co_makers_user ON loan_co_makers(co_maker_user_id, status);
CREATE INDEX IF NOT EXISTS idx_ledger_user ON ledger_entries(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_membership_user ON membership_status(user_id);
CREATE INDEX IF NOT EXISTS idx_savings_contributions_account ON savings_contributions(account_id, contributed_at DESC);
CREATE INDEX IF NOT EXISTS idx_member_notes_member ON member_notes(member_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_member_documents_user ON member_documents(user_id, uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_admin ON admin_audit_log(admin_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_target ON admin_audit_log(target_user_id, created_at DESC);

-- ─── PART 3: ROW LEVEL SECURITY ───────────────────────────────────────────────

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE equity_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE equity_contributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE equity_deposit_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE membership_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE membership_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE loan_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE loan_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE loan_co_makers ENABLE ROW LEVEL SECURITY;
ALTER TABLE loans ENABLE ROW LEVEL SECURITY;
ALTER TABLE loan_repayment_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE loan_repayments ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_config_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE savings_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE savings_deposit_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE savings_contributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE savings_withdrawal_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE savings_interest_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE batch_deposits ENABLE ROW LEVEL SECURITY;
ALTER TABLE batch_deposit_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE equity_dividend_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE equity_share_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE damayan_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE damayan_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE branch_income ENABLE ROW LEVEL SECURITY;
ALTER TABLE branch_income_breakdown ENABLE ROW LEVEL SECURITY;
ALTER TABLE branch_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE rebate_releases ENABLE ROW LEVEL SECURITY;
ALTER TABLE rebate_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE profile_custom_roles ENABLE ROW LEVEL SECURITY;

-- Helper: get caller's role
CREATE OR REPLACE FUNCTION get_user_role(p_user_id UUID)
RETURNS VARCHAR AS $$
  SELECT role FROM profiles WHERE id = p_user_id;
$$ LANGUAGE sql SECURITY DEFINER;

-- Profiles
CREATE POLICY profiles_self ON profiles FOR SELECT USING (id = auth.uid());
CREATE POLICY profiles_self_update ON profiles FOR UPDATE USING (id = auth.uid()) WITH CHECK (id = auth.uid());
CREATE POLICY profiles_admin ON profiles FOR ALL USING (get_user_role(auth.uid()) IN ('admin','staff'));
CREATE POLICY profiles_board ON profiles FOR SELECT USING (get_user_role(auth.uid()) = 'board');

-- Equity
CREATE POLICY equity_shares_self ON equity_shares FOR SELECT USING (user_id = auth.uid());
CREATE POLICY equity_shares_admin ON equity_shares FOR ALL USING (get_user_role(auth.uid()) IN ('admin','staff'));
CREATE POLICY equity_shares_board ON equity_shares FOR SELECT USING (get_user_role(auth.uid()) = 'board');

CREATE POLICY equity_contributions_self ON equity_contributions FOR SELECT USING (user_id = auth.uid());
CREATE POLICY equity_contributions_admin ON equity_contributions FOR ALL USING (get_user_role(auth.uid()) IN ('admin','staff'));

CREATE POLICY equity_deposit_requests_member ON equity_deposit_requests FOR ALL USING (user_id = auth.uid());
CREATE POLICY equity_deposit_requests_admin ON equity_deposit_requests FOR ALL USING (get_user_role(auth.uid()) IN ('admin','staff'));

-- Membership
CREATE POLICY membership_self ON membership_status FOR SELECT USING (user_id = auth.uid());
CREATE POLICY membership_admin ON membership_status FOR ALL USING (get_user_role(auth.uid()) IN ('admin','staff'));
CREATE POLICY membership_history_self ON membership_history FOR SELECT USING (user_id = auth.uid());
CREATE POLICY membership_history_admin ON membership_history FOR ALL USING (get_user_role(auth.uid()) IN ('admin','staff'));

-- Loans
CREATE POLICY loan_products_select ON loan_products FOR SELECT TO authenticated
  USING (is_active = true OR get_user_role(auth.uid()) IN ('admin','staff'));
CREATE POLICY loan_products_write ON loan_products FOR ALL TO authenticated
  USING (get_user_role(auth.uid()) IN ('admin','staff'));

CREATE POLICY loan_applications_self ON loan_applications FOR SELECT USING (user_id = auth.uid());
CREATE POLICY loan_applications_insert ON loan_applications FOR INSERT WITH CHECK (
  user_id = auth.uid()
  AND (SELECT COUNT(*) FROM equity_shares WHERE user_id = auth.uid() AND status = 'completed') > 0
  AND (SELECT COUNT(*) FROM loans WHERE user_id = auth.uid() AND status = 'active') = 0
  AND (SELECT COUNT(*) FROM loan_applications WHERE user_id = auth.uid() AND status IN ('draft','submitted','under_review')) = 0
);
CREATE POLICY loan_applications_admin ON loan_applications FOR ALL USING (get_user_role(auth.uid()) IN ('admin','staff','board'));

CREATE POLICY co_makers_select ON loan_co_makers FOR SELECT USING (
  co_maker_user_id = auth.uid()
  OR application_id IN (SELECT id FROM loan_applications WHERE user_id = auth.uid())
);
CREATE POLICY co_makers_insert ON loan_co_makers FOR INSERT WITH CHECK (
  application_id IN (SELECT id FROM loan_applications WHERE user_id = auth.uid())
);
CREATE POLICY co_makers_respond ON loan_co_makers FOR UPDATE
  USING (co_maker_user_id = auth.uid()) WITH CHECK (co_maker_user_id = auth.uid());
CREATE POLICY co_makers_admin ON loan_co_makers FOR ALL USING (get_user_role(auth.uid()) IN ('admin','staff'));

CREATE POLICY loans_self ON loans FOR SELECT USING (user_id = auth.uid());
CREATE POLICY loans_admin ON loans FOR ALL USING (get_user_role(auth.uid()) IN ('admin','staff','board'));

CREATE POLICY loan_schedules_self ON loan_repayment_schedules FOR SELECT
  USING (loan_id IN (SELECT id FROM loans WHERE user_id = auth.uid()));
CREATE POLICY loan_schedules_admin ON loan_repayment_schedules FOR ALL
  USING (get_user_role(auth.uid()) IN ('admin','staff'));

CREATE POLICY loan_repayments_self ON loan_repayments FOR SELECT
  USING (loan_id IN (SELECT id FROM loans WHERE user_id = auth.uid()));
CREATE POLICY loan_repayments_admin ON loan_repayments FOR ALL
  USING (get_user_role(auth.uid()) IN ('admin','staff'));

-- Ledger
CREATE POLICY ledger_self ON ledger_entries FOR SELECT USING (user_id = auth.uid());
CREATE POLICY ledger_admin ON ledger_entries FOR SELECT USING (get_user_role(auth.uid()) IN ('admin','staff'));
CREATE POLICY ledger_insert ON ledger_entries FOR INSERT WITH CHECK (get_user_role(auth.uid()) IN ('admin','staff'));

-- System config
CREATE POLICY config_admin ON system_config FOR ALL USING (get_user_role(auth.uid()) = 'admin');
CREATE POLICY config_read ON system_config FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY config_public_branding ON system_config FOR SELECT
  USING (config_key IN ('app_name','app_logo_url'));

-- Admin audit log
CREATE POLICY audit_log_admin ON admin_audit_log FOR SELECT USING (get_user_role(auth.uid()) = 'admin');

-- Savings
CREATE POLICY savings_accounts_self ON savings_accounts FOR SELECT USING (user_id = auth.uid());
CREATE POLICY savings_accounts_admin ON savings_accounts FOR ALL USING (get_user_role(auth.uid()) IN ('admin','staff'));

CREATE POLICY savings_deposit_requests_self ON savings_deposit_requests FOR ALL USING (user_id = auth.uid());
CREATE POLICY savings_deposit_requests_admin ON savings_deposit_requests FOR ALL
  USING (get_user_role(auth.uid()) IN ('admin','staff'));

CREATE POLICY savings_contributions_self ON savings_contributions FOR SELECT USING (user_id = auth.uid());
CREATE POLICY savings_contributions_admin ON savings_contributions FOR ALL
  USING (get_user_role(auth.uid()) IN ('admin','staff'));

CREATE POLICY savings_withdrawals_self ON savings_withdrawal_requests FOR ALL USING (user_id = auth.uid());
CREATE POLICY savings_withdrawals_admin ON savings_withdrawal_requests FOR ALL
  USING (get_user_role(auth.uid()) IN ('admin','staff'));

CREATE POLICY savings_interest_self ON savings_interest_logs FOR SELECT USING (user_id = auth.uid());
CREATE POLICY savings_interest_admin ON savings_interest_logs FOR ALL
  USING (get_user_role(auth.uid()) IN ('admin','staff'));

-- Batch deposits
CREATE POLICY batch_deposits_submitter ON batch_deposits FOR ALL USING (submitted_by = auth.uid());
CREATE POLICY batch_deposits_admin ON batch_deposits FOR ALL USING (get_user_role(auth.uid()) IN ('admin','staff'));
CREATE POLICY batch_items_submitter ON batch_deposit_items FOR ALL
  USING (batch_id IN (SELECT id FROM batch_deposits WHERE submitted_by = auth.uid()));
CREATE POLICY batch_items_member ON batch_deposit_items FOR SELECT USING (user_id = auth.uid());
CREATE POLICY batch_items_admin ON batch_deposit_items FOR ALL USING (get_user_role(auth.uid()) IN ('admin','staff'));

-- Member docs & notes
CREATE POLICY member_documents_self ON member_documents FOR ALL USING (user_id = auth.uid());
CREATE POLICY member_documents_admin ON member_documents FOR SELECT USING (get_user_role(auth.uid()) IN ('admin','staff'));
CREATE POLICY member_notes_admin ON member_notes FOR ALL USING (get_user_role(auth.uid()) IN ('admin','staff'));

-- Dividends & share transfers
CREATE POLICY dividend_logs_self ON equity_dividend_logs FOR SELECT USING (user_id = auth.uid());
CREATE POLICY dividend_logs_admin ON equity_dividend_logs FOR ALL USING (get_user_role(auth.uid()) IN ('admin','staff'));

CREATE POLICY share_transfers_self ON equity_share_transfers FOR SELECT
  USING (from_user_id = auth.uid() OR to_user_id = auth.uid());
CREATE POLICY share_transfers_insert ON equity_share_transfers FOR INSERT WITH CHECK (from_user_id = auth.uid());
CREATE POLICY share_transfers_admin ON equity_share_transfers FOR ALL USING (get_user_role(auth.uid()) IN ('admin','staff'));

-- Damayan
CREATE POLICY damayan_events_read ON damayan_events FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY damayan_events_admin ON damayan_events FOR ALL USING (get_user_role(auth.uid()) IN ('admin','staff'));
CREATE POLICY damayan_assessments_self ON damayan_assessments FOR SELECT USING (user_id = auth.uid());
CREATE POLICY damayan_assessments_admin ON damayan_assessments FOR ALL USING (get_user_role(auth.uid()) IN ('admin','staff'));

-- Branches
CREATE POLICY branches_read ON branches FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY branches_admin ON branches FOR ALL USING (get_user_role(auth.uid()) IN ('admin','staff'));
CREATE POLICY branch_income_read ON branch_income FOR SELECT USING (get_user_role(auth.uid()) IN ('admin','staff','board'));
CREATE POLICY branch_income_write ON branch_income FOR ALL USING (get_user_role(auth.uid()) IN ('admin','staff'));
CREATE POLICY branch_income_breakdown_read ON branch_income_breakdown FOR SELECT
  USING (get_user_role(auth.uid()) IN ('admin','staff','board'));
CREATE POLICY branch_income_breakdown_admin ON branch_income_breakdown FOR ALL
  USING (get_user_role(auth.uid()) IN ('admin','staff'));
CREATE POLICY branch_expenses_read ON branch_expenses FOR SELECT USING (get_user_role(auth.uid()) IN ('admin','staff','board'));
CREATE POLICY branch_expenses_write ON branch_expenses FOR ALL USING (get_user_role(auth.uid()) IN ('admin','staff'));

-- Rebates
CREATE POLICY rebate_releases_admin ON rebate_releases FOR ALL USING (get_user_role(auth.uid()) IN ('admin','staff'));
CREATE POLICY rebate_logs_self ON rebate_logs FOR SELECT USING (user_id = auth.uid());
CREATE POLICY rebate_logs_admin ON rebate_logs FOR ALL USING (get_user_role(auth.uid()) IN ('admin','staff'));

-- Role permissions & custom roles
CREATE POLICY role_permissions_read ON role_permissions FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY role_permissions_admin ON role_permissions FOR ALL USING (get_user_role(auth.uid()) = 'admin');
CREATE POLICY custom_roles_read ON custom_roles FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY custom_roles_admin ON custom_roles FOR ALL USING (get_user_role(auth.uid()) = 'admin');
CREATE POLICY custom_role_permissions_read ON custom_role_permissions FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY custom_role_permissions_admin ON custom_role_permissions FOR ALL USING (get_user_role(auth.uid()) = 'admin');
CREATE POLICY profile_custom_roles_read ON profile_custom_roles FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY profile_custom_roles_admin ON profile_custom_roles FOR ALL USING (get_user_role(auth.uid()) = 'admin');

-- ─── PART 4: FUNCTIONS & TRIGGERS ─────────────────────────────────────────────

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, phone, role, account_status, employee_id)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', 'Unknown'),
    NEW.raw_user_meta_data->>'phone',
    'member',
    'active',
    NEW.raw_user_meta_data->>'employee_id'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Auto-create equity share when member registers or is assigned member role
CREATE OR REPLACE FUNCTION auto_create_share_for_member()
RETURNS TRIGGER AS $$
DECLARE
  v_target DECIMAL(15,2);
  v_max_num INT;
BEGIN
  IF NEW.role = 'member' AND (TG_OP = 'INSERT' OR OLD.role IS DISTINCT FROM 'member') THEN
    SELECT COALESCE(config_value::DECIMAL, 5000) INTO v_target
    FROM system_config WHERE config_key = 'share_price';

    SELECT COALESCE(MAX(share_number), 0) INTO v_max_num
    FROM equity_shares WHERE user_id = NEW.id;

    IF v_max_num = 0 THEN
      INSERT INTO equity_shares (user_id, share_number, target_amount, paid_amount, status)
      VALUES (NEW.id, 1, v_target, 0, 'in_progress');
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_member_profile_created
  AFTER INSERT ON profiles
  FOR EACH ROW EXECUTE FUNCTION auto_create_share_for_member();

CREATE TRIGGER on_member_role_assigned
  AFTER UPDATE OF role ON profiles
  FOR EACH ROW EXECUTE FUNCTION auto_create_share_for_member();

-- Check employee ID availability (used on register page, anon accessible)
CREATE OR REPLACE FUNCTION is_employee_id_available(p_employee_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT NOT EXISTS (SELECT 1 FROM profiles WHERE employee_id = p_employee_id);
$$;
GRANT EXECUTE ON FUNCTION is_employee_id_available(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION is_employee_id_available(TEXT) TO authenticated;

-- Evaluate membership status for a member
CREATE OR REPLACE FUNCTION evaluate_membership(p_user_id UUID)
RETURNS VOID AS $$
DECLARE
  v_completed_shares INT;
  v_current_status   VARCHAR;
  v_new_status       VARCHAR;
  v_has_default      BOOLEAN;
  v_lapse_on_default BOOLEAN;
BEGIN
  SELECT COUNT(*) INTO v_completed_shares
  FROM equity_shares WHERE user_id = p_user_id AND status = 'completed';

  SELECT (config_value = 'true') INTO v_lapse_on_default
  FROM system_config WHERE config_key = 'membership_lapse_on_default';

  SELECT EXISTS(SELECT 1 FROM loans WHERE user_id = p_user_id AND status = 'defaulted')
  INTO v_has_default;

  IF v_completed_shares = 0 THEN v_new_status := 'pending';
  ELSIF v_lapse_on_default AND v_has_default THEN v_new_status := 'suspended';
  ELSE v_new_status := 'active';
  END IF;

  SELECT status INTO v_current_status FROM membership_status WHERE user_id = p_user_id;

  IF v_current_status IS NULL THEN
    INSERT INTO membership_status (user_id, status, completed_shares, last_evaluated_at)
    VALUES (p_user_id, v_new_status, v_completed_shares, now());
  ELSIF v_current_status != v_new_status THEN
    INSERT INTO membership_history (user_id, from_status, to_status)
    VALUES (p_user_id, v_current_status, v_new_status);
    UPDATE membership_status SET status = v_new_status, completed_shares = v_completed_shares,
      last_evaluated_at = now(), updated_at = now() WHERE user_id = p_user_id;
  ELSE
    UPDATE membership_status SET completed_shares = v_completed_shares,
      last_evaluated_at = now(), updated_at = now() WHERE user_id = p_user_id;
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION trigger_membership_evaluation()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'completed' AND (OLD.status IS DISTINCT FROM 'completed') THEN
    PERFORM evaluate_membership(NEW.user_id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER on_share_completed
  AFTER UPDATE ON equity_shares
  FOR EACH ROW EXECUTE FUNCTION trigger_membership_evaluation();

-- Suspend member on loan default
CREATE OR REPLACE FUNCTION suspend_member_on_loan_default()
RETURNS TRIGGER AS $$
DECLARE v_current_status VARCHAR;
BEGIN
  IF NEW.status = 'defaulted' AND OLD.status != 'defaulted' THEN
    SELECT status INTO v_current_status FROM membership_status WHERE user_id = NEW.user_id;
    IF v_current_status IS NOT NULL AND v_current_status != 'suspended' THEN
      INSERT INTO membership_history (user_id, from_status, to_status, reason)
      VALUES (NEW.user_id, v_current_status, 'suspended', 'Loan defaulted: ' || NEW.id);
      UPDATE membership_status SET status = 'suspended', reason = 'Loan defaulted',
        last_evaluated_at = now(), updated_at = now() WHERE user_id = NEW.user_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_loan_default
  AFTER UPDATE OF status ON loans
  FOR EACH ROW EXECUTE FUNCTION suspend_member_on_loan_default();

-- Ledger triggers
CREATE OR REPLACE FUNCTION ledger_on_contribution()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO ledger_entries (user_id, entry_type, reference_id, reference_table, amount, direction, created_by)
  VALUES (NEW.user_id, 'equity_contribution', NEW.id, 'equity_contributions', NEW.amount, 'credit', NEW.recorded_by);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER after_contribution_ledger
  AFTER INSERT ON equity_contributions
  FOR EACH ROW EXECUTE FUNCTION ledger_on_contribution();

CREATE OR REPLACE FUNCTION ledger_on_repayment()
RETURNS TRIGGER AS $$
DECLARE v_user_id UUID;
BEGIN
  SELECT user_id INTO v_user_id FROM loans WHERE id = NEW.loan_id;
  INSERT INTO ledger_entries (user_id, entry_type, reference_id, reference_table, amount, direction, created_by)
  VALUES (v_user_id, 'loan_repayment', NEW.id, 'loan_repayments', NEW.amount, 'debit', NEW.recorded_by);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER after_repayment_ledger
  AFTER INSERT ON loan_repayments
  FOR EACH ROW EXECUTE FUNCTION ledger_on_repayment();

-- Apply loan repayment to schedule + auto-complete loan
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
  FOR v_sched_id, v_total_due, v_paid_so_far IN
    SELECT id, total_due, amount_paid FROM loan_repayment_schedules
    WHERE loan_id = NEW.loan_id AND status IN ('pending','partial','overdue')
    ORDER BY due_date ASC, installment_no ASC
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_apply := LEAST(v_remaining, v_total_due - v_paid_so_far);
    UPDATE loan_repayment_schedules SET
      amount_paid = v_paid_so_far + v_apply,
      status = CASE WHEN v_paid_so_far + v_apply >= v_total_due THEN 'paid' ELSE 'partial' END,
      paid_at = CASE WHEN v_paid_so_far + v_apply >= v_total_due THEN now() ELSE paid_at END
    WHERE id = v_sched_id;
    v_remaining := v_remaining - v_apply;
  END LOOP;

  UPDATE loans SET
    amount_paid = COALESCE(amount_paid, 0) + NEW.amount,
    outstanding = GREATEST(0, outstanding - NEW.amount),
    updated_at  = now()
  WHERE id = NEW.loan_id;

  SELECT outstanding, user_id INTO v_new_outstanding, v_loan_user FROM loans WHERE id = NEW.loan_id;
  IF v_new_outstanding <= 0 THEN
    UPDATE loans SET status = 'completed', updated_at = now() WHERE id = NEW.loan_id;
    PERFORM evaluate_membership(v_loan_user);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_loan_repayment_schedule
  AFTER INSERT ON loan_repayments
  FOR EACH ROW EXECUTE FUNCTION apply_loan_repayment_to_schedule();

-- ─── PART 5: ADMIN RPCs ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_all_users_for_admin()
RETURNS TABLE (
  id UUID, full_name VARCHAR, phone VARCHAR, role VARCHAR, account_status VARCHAR,
  email VARCHAR, employee_id VARCHAR, membership_status VARCHAR, completed_shares INT,
  created_at TIMESTAMPTZ, profile_completed_at TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin','staff') THEN RAISE EXCEPTION 'Access denied'; END IF;
  RETURN QUERY
  SELECT p.id, p.full_name, p.phone, p.role, p.account_status, u.email::VARCHAR, p.employee_id,
    ms.status::VARCHAR, ms.completed_shares, p.created_at, p.profile_completed_at
  FROM profiles p
  LEFT JOIN auth.users u ON u.id = p.id
  LEFT JOIN membership_status ms ON ms.user_id = p.id
  WHERE p.deleted_at IS NULL
  ORDER BY p.created_at DESC;
END;
$$;
GRANT EXECUTE ON FUNCTION get_all_users_for_admin() TO authenticated;

CREATE OR REPLACE FUNCTION get_user_for_admin(p_user_id UUID)
RETURNS TABLE (
  id UUID, full_name VARCHAR, phone VARCHAR, role VARCHAR, account_status VARCHAR,
  email VARCHAR, employee_id VARCHAR, avatar_url TEXT, date_of_birth DATE, address TEXT,
  civil_status VARCHAR, emergency_contact_name VARCHAR, emergency_contact_phone VARCHAR,
  profile_completed_at TIMESTAMPTZ, membership_status VARCHAR, completed_shares INT, created_at TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin','staff') THEN RAISE EXCEPTION 'Access denied'; END IF;
  RETURN QUERY
  SELECT p.id, p.full_name, p.phone, p.role, p.account_status, u.email::VARCHAR, p.employee_id,
    p.avatar_url, p.date_of_birth, p.address, p.civil_status,
    p.emergency_contact_name, p.emergency_contact_phone, p.profile_completed_at,
    ms.status::VARCHAR, ms.completed_shares, p.created_at
  FROM profiles p
  LEFT JOIN auth.users u ON u.id = p.id
  LEFT JOIN membership_status ms ON ms.user_id = p.id
  WHERE p.id = p_user_id;
END;
$$;
GRANT EXECUTE ON FUNCTION get_user_for_admin(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION admin_update_user_role(p_target_user_id UUID, p_new_role VARCHAR)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF get_user_role(auth.uid()) != 'admin' THEN RAISE EXCEPTION 'Only admins can change user roles'; END IF;
  IF p_new_role NOT IN ('admin','staff','member','board') THEN RAISE EXCEPTION 'Invalid role: %', p_new_role; END IF;
  UPDATE profiles SET role = p_new_role, updated_at = now() WHERE id = p_target_user_id;
END;
$$;
GRANT EXECUTE ON FUNCTION admin_update_user_role(UUID, VARCHAR) TO authenticated;

CREATE OR REPLACE FUNCTION admin_update_user_status(p_target_user_id UUID, p_new_status VARCHAR)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin','staff') THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF p_new_status NOT IN ('active','suspended','inactive') THEN RAISE EXCEPTION 'Invalid status: %', p_new_status; END IF;
  UPDATE profiles SET account_status = p_new_status, updated_at = now() WHERE id = p_target_user_id;
END;
$$;
GRANT EXECUTE ON FUNCTION admin_update_user_status(UUID, VARCHAR) TO authenticated;

CREATE OR REPLACE FUNCTION admin_soft_delete_user(p_user_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF get_user_role(auth.uid()) != 'admin' THEN RAISE EXCEPTION 'Access denied'; END IF;
  UPDATE profiles SET deleted_at = now(), updated_at = now() WHERE id = p_user_id;
END;
$$;
GRANT EXECUTE ON FUNCTION admin_soft_delete_user(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION admin_restore_user(p_user_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF get_user_role(auth.uid()) != 'admin' THEN RAISE EXCEPTION 'Access denied'; END IF;
  UPDATE profiles SET deleted_at = NULL, updated_at = now() WHERE id = p_user_id;
END;
$$;
GRANT EXECUTE ON FUNCTION admin_restore_user(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION admin_set_membership_status(p_user_id UUID, p_status VARCHAR, p_reason TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_current_status VARCHAR;
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin','staff') THEN RAISE EXCEPTION 'Permission denied'; END IF;
  SELECT status INTO v_current_status FROM membership_status WHERE user_id = p_user_id;
  IF v_current_status IS NULL THEN
    INSERT INTO membership_status (user_id, status, completed_shares, reason, last_evaluated_at)
    VALUES (p_user_id, p_status, 0, p_reason, now());
  ELSE
    INSERT INTO membership_history (user_id, from_status, to_status, reason)
    VALUES (p_user_id, v_current_status, p_status, p_reason);
    UPDATE membership_status SET status = p_status, reason = p_reason,
      last_evaluated_at = now(), updated_at = now() WHERE user_id = p_user_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION admin_link_employee(p_profile_id UUID, p_employee_id VARCHAR)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin','staff') THEN RAISE EXCEPTION 'Access denied'; END IF;
  UPDATE profiles SET employee_id = p_employee_id, updated_at = now() WHERE id = p_profile_id;
END;
$$;
GRANT EXECUTE ON FUNCTION admin_link_employee(UUID, VARCHAR) TO authenticated;

CREATE OR REPLACE FUNCTION log_admin_action(p_action TEXT, p_target_user_id UUID DEFAULT NULL, p_metadata JSONB DEFAULT NULL)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id UUID;
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin','staff') THEN RAISE EXCEPTION 'Access denied'; END IF;
  INSERT INTO admin_audit_log (admin_id, action, target_user_id, metadata)
  VALUES (auth.uid(), p_action, p_target_user_id, p_metadata) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION log_admin_action(TEXT, UUID, JSONB) TO authenticated;

-- ─── PART 6: EQUITY RPCs ───────────────────────────────────────────────────────

-- Approve equity deposit request (with overflow into next share)
CREATE OR REPLACE FUNCTION approve_deposit_request(p_request_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_req       equity_deposit_requests%ROWTYPE;
  v_share     equity_shares%ROWTYPE;
  v_leftover  DECIMAL(15,2);
  v_to_credit DECIMAL(15,2);
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin','staff') THEN RAISE EXCEPTION 'Access denied'; END IF;
  SELECT * INTO v_req FROM equity_deposit_requests WHERE id = p_request_id;
  IF v_req.status != 'pending' THEN RAISE EXCEPTION 'Request is not pending'; END IF;

  v_leftover := v_req.amount;
  FOR v_share IN
    SELECT * FROM equity_shares
    WHERE user_id = v_req.user_id AND status = 'in_progress'
      AND (id = v_req.share_id OR share_number > (
        SELECT share_number FROM equity_shares WHERE id = v_req.share_id
      ))
    ORDER BY CASE WHEN id = v_req.share_id THEN 0 ELSE 1 END, share_number ASC
  LOOP
    EXIT WHEN v_leftover <= 0;
    v_to_credit := LEAST(v_leftover, v_share.target_amount - v_share.paid_amount);
    INSERT INTO equity_contributions (user_id, share_id, amount, payment_method, reference, recorded_by)
    VALUES (v_req.user_id, v_share.id, v_to_credit, v_req.payment_method, v_req.reference, auth.uid());
    v_leftover := v_leftover - v_to_credit;
  END LOOP;
  IF v_leftover > 0 THEN
    INSERT INTO equity_contributions (user_id, share_id, amount, payment_method, reference, recorded_by)
    VALUES (v_req.user_id, v_req.share_id, v_leftover, v_req.payment_method, v_req.reference, auth.uid());
  END IF;

  UPDATE equity_deposit_requests
  SET status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
  WHERE id = p_request_id;
END;
$$;
GRANT EXECUTE ON FUNCTION approve_deposit_request(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION reject_deposit_request(p_request_id UUID, p_reason TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin','staff') THEN RAISE EXCEPTION 'Access denied'; END IF;
  UPDATE equity_deposit_requests
  SET status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(),
      rejection_reason = p_reason, updated_at = now()
  WHERE id = p_request_id AND status = 'pending';
END;
$$;
GRANT EXECUTE ON FUNCTION reject_deposit_request(UUID, TEXT) TO authenticated;

-- Safe share deletion
CREATE OR REPLACE FUNCTION admin_delete_share(p_share_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count INT;
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin','staff') THEN RAISE EXCEPTION 'Access denied'; END IF;
  SELECT COUNT(*) INTO v_count FROM equity_deposit_requests
  WHERE share_id = p_share_id AND status IN ('pending','approved');
  IF v_count > 0 THEN
    RAISE EXCEPTION 'This share has % pending/approved deposit request(s) and cannot be removed.', v_count;
  END IF;
  IF EXISTS (SELECT 1 FROM equity_shares WHERE id = p_share_id AND paid_amount > 0) THEN
    RAISE EXCEPTION 'This share has recorded contributions and cannot be removed.';
  END IF;
  DELETE FROM equity_contributions WHERE share_id = p_share_id;
  DELETE FROM equity_shares WHERE id = p_share_id;
END;
$$;
GRANT EXECUTE ON FUNCTION admin_delete_share(UUID) TO authenticated;

-- Direct contribution (bulk import bypass)
CREATE OR REPLACE FUNCTION admin_record_contribution_direct(
  p_user_id UUID, p_share_id UUID, p_amount DECIMAL(15,2),
  p_payment_method VARCHAR, p_reference VARCHAR, p_date TIMESTAMPTZ, p_recorded_by UUID
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_paid DECIMAL(15,2); v_target DECIMAL(15,2);
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin','staff') THEN RAISE EXCEPTION 'Access denied'; END IF;
  INSERT INTO equity_contributions (user_id, share_id, amount, payment_method, reference, recorded_by, contribution_at)
  VALUES (p_user_id, p_share_id, p_amount, p_payment_method, p_reference, p_recorded_by, p_date);
  SELECT COALESCE(SUM(amount), 0) INTO v_paid FROM equity_contributions WHERE share_id = p_share_id;
  SELECT target_amount INTO v_target FROM equity_shares WHERE id = p_share_id;
  UPDATE equity_shares SET paid_amount = v_paid,
    status = CASE WHEN v_paid >= v_target THEN 'completed' ELSE status END,
    completed_at = CASE WHEN v_paid >= v_target AND completed_at IS NULL THEN now() ELSE completed_at END,
    updated_at = now()
  WHERE id = p_share_id;
END;
$$;
GRANT EXECUTE ON FUNCTION admin_record_contribution_direct(UUID, UUID, DECIMAL, VARCHAR, VARCHAR, TIMESTAMPTZ, UUID) TO authenticated;

-- Share transfers
CREATE OR REPLACE FUNCTION request_share_transfer(p_share_id UUID, p_to_user_id UUID, p_reason TEXT DEFAULT NULL)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_share equity_shares%ROWTYPE; v_transfer_id UUID;
BEGIN
  SELECT * INTO v_share FROM equity_shares WHERE id = p_share_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Share not found'; END IF;
  IF v_share.user_id != auth.uid() THEN RAISE EXCEPTION 'You do not own this share'; END IF;
  IF v_share.status != 'completed' THEN RAISE EXCEPTION 'Only completed shares can be transferred'; END IF;
  IF EXISTS (SELECT 1 FROM equity_share_transfers WHERE share_id = p_share_id AND status = 'pending') THEN
    RAISE EXCEPTION 'A pending transfer already exists for this share';
  END IF;
  IF p_to_user_id = auth.uid() THEN RAISE EXCEPTION 'Cannot transfer share to yourself'; END IF;
  INSERT INTO equity_share_transfers (share_id, from_user_id, to_user_id, reason)
  VALUES (p_share_id, auth.uid(), p_to_user_id, p_reason) RETURNING id INTO v_transfer_id;
  RETURN v_transfer_id;
END;
$$;
GRANT EXECUTE ON FUNCTION request_share_transfer(UUID, UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION admin_approve_share_transfer(p_transfer_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_t equity_share_transfers%ROWTYPE;
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin','staff') THEN RAISE EXCEPTION 'Access denied'; END IF;
  SELECT * INTO v_t FROM equity_share_transfers WHERE id = p_transfer_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transfer not found'; END IF;
  IF v_t.status != 'pending' THEN RAISE EXCEPTION 'Transfer is not pending'; END IF;
  UPDATE equity_shares SET user_id = v_t.to_user_id, updated_at = now() WHERE id = v_t.share_id;
  INSERT INTO ledger_entries (user_id, entry_type, reference_id, reference_table, amount, direction, notes, created_by)
  SELECT v_t.from_user_id, 'share_transfer_out', v_t.id, 'equity_share_transfers', es.target_amount, 'debit', 'Share transferred out', auth.uid()
  FROM equity_shares es WHERE es.id = v_t.share_id;
  INSERT INTO ledger_entries (user_id, entry_type, reference_id, reference_table, amount, direction, notes, created_by)
  SELECT v_t.to_user_id, 'share_transfer_in', v_t.id, 'equity_share_transfers', es.target_amount, 'credit', 'Share received via transfer', auth.uid()
  FROM equity_shares es WHERE es.id = v_t.share_id;
  UPDATE equity_share_transfers SET status = 'approved', reviewed_by = auth.uid(),
    reviewed_at = now(), updated_at = now() WHERE id = p_transfer_id;
END;
$$;
GRANT EXECUTE ON FUNCTION admin_approve_share_transfer(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION admin_reject_share_transfer(p_transfer_id UUID, p_reason TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin','staff') THEN RAISE EXCEPTION 'Access denied'; END IF;
  UPDATE equity_share_transfers SET status = 'rejected', reviewed_by = auth.uid(),
    reviewed_at = now(), rejection_reason = p_reason, updated_at = now()
  WHERE id = p_transfer_id AND status = 'pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'Transfer not found or not pending'; END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION admin_reject_share_transfer(UUID, TEXT) TO authenticated;

-- ─── PART 7: LOAN RPCs ─────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_eligible_co_makers()
RETURNS TABLE(id UUID, full_name VARCHAR) LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT p.id, p.full_name FROM profiles p
  JOIN membership_status ms ON ms.user_id = p.id
  WHERE p.id != auth.uid() AND p.role = 'member' AND p.account_status = 'active'
    AND ms.status = 'active'
    AND NOT EXISTS (SELECT 1 FROM loans l WHERE l.user_id = p.id AND l.status = 'active')
    AND NOT EXISTS (
      SELECT 1 FROM loan_co_makers lcm
      JOIN loan_applications la ON la.id = lcm.application_id
      WHERE lcm.co_maker_user_id = p.id AND la.status IN ('submitted','under_review','approved')
    )
  ORDER BY p.full_name;
END;
$$;

CREATE OR REPLACE FUNCTION respond_to_co_maker_request(p_application_id UUID, p_status VARCHAR)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_remaining_pending INT;
BEGIN
  IF p_status NOT IN ('confirmed','declined') THEN RAISE EXCEPTION 'Invalid status'; END IF;
  UPDATE loan_co_makers SET status = p_status, responded_at = now()
  WHERE application_id = p_application_id AND co_maker_user_id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'Co-maker request not found'; END IF;
  IF p_status = 'confirmed' THEN
    SELECT COUNT(*) INTO v_remaining_pending FROM loan_co_makers
    WHERE application_id = p_application_id AND status != 'confirmed';
    IF v_remaining_pending = 0 THEN
      UPDATE loan_applications SET status = 'submitted', updated_at = now()
      WHERE id = p_application_id AND status = 'draft';
    END IF;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION get_my_co_maker_requests()
RETURNS TABLE(
  id UUID, application_id UUID, status VARCHAR, responded_at TIMESTAMPTZ, created_at TIMESTAMPTZ,
  applicant_name VARCHAR, amount_requested DECIMAL, term_months INT, purpose TEXT, application_status VARCHAR
) LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT lcm.id, lcm.application_id, lcm.status, lcm.responded_at, lcm.created_at,
    p.full_name, la.amount_requested, la.term_months, la.purpose, la.status
  FROM loan_co_makers lcm
  JOIN loan_applications la ON la.id = lcm.application_id
  JOIN profiles p ON p.id = la.user_id
  WHERE lcm.co_maker_user_id = auth.uid()
  ORDER BY lcm.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION get_my_application_co_makers()
RETURNS TABLE(
  application_id UUID, co_maker_user_id UUID, full_name VARCHAR, status VARCHAR, responded_at TIMESTAMPTZ
) LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT lcm.application_id, lcm.co_maker_user_id, p.full_name, lcm.status, lcm.responded_at
  FROM loan_co_makers lcm
  JOIN loan_applications la ON la.id = lcm.application_id
  JOIN profiles p ON p.id = lcm.co_maker_user_id
  WHERE la.user_id = auth.uid()
  ORDER BY lcm.created_at;
END;
$$;

-- Admin approve loan application (final version with savings gate)
CREATE OR REPLACE FUNCTION admin_approve_loan_application(p_application_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_app              loan_applications%ROWTYPE;
  v_product          loan_products%ROWTYPE;
  v_loan_id          UUID;
  v_interest_rate    DECIMAL;
  v_calc_method      VARCHAR;
  v_frequency        TEXT;
  v_n_periods        INT;
  v_periods_per_yr   DECIMAL;
  v_r                DECIMAL;
  v_emi              DECIMAL;
  v_outstanding      DECIMAL;
  v_principal_pay    DECIMAL;
  v_interest_pay     DECIMAL;
  v_total_repayable  DECIMAL;
  v_interval         INTERVAL;
  v_co_maker_count   INT;
  v_pending_count    INT;
  v_declined_count   INT;
  v_savings_required BOOLEAN;
  v_savings_balance  DECIMAL;
  v_min_savings      DECIMAL;
  i                  INT;
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin','staff') THEN RAISE EXCEPTION 'Permission denied'; END IF;
  SELECT * INTO v_app FROM loan_applications WHERE id = p_application_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Application not found'; END IF;
  IF v_app.status NOT IN ('submitted','under_review') THEN
    RAISE EXCEPTION 'Application is not in a reviewable state';
  END IF;

  -- Co-maker check (optional; if any present, all must respond and confirm)
  SELECT COUNT(*) INTO v_co_maker_count FROM loan_co_makers WHERE application_id = p_application_id;
  IF v_co_maker_count > 0 THEN
    SELECT COUNT(*) INTO v_pending_count FROM loan_co_makers WHERE application_id = p_application_id AND status = 'pending';
    IF v_pending_count > 0 THEN RAISE EXCEPTION 'Cannot approve: % co-maker(s) have not yet responded', v_pending_count; END IF;
    SELECT COUNT(*) INTO v_declined_count FROM loan_co_makers WHERE application_id = p_application_id AND status = 'declined';
    IF v_declined_count > 0 THEN RAISE EXCEPTION 'Cannot approve: % co-maker(s) have declined', v_declined_count; END IF;
  END IF;

  -- Savings balance gate
  SELECT COALESCE(config_value,'false') = 'true' INTO v_savings_required
    FROM system_config WHERE config_key = 'savings_required_for_loan';
  IF v_savings_required THEN
    SELECT COALESCE(config_value::DECIMAL, 500) INTO v_min_savings
      FROM system_config WHERE config_key = 'loan_min_savings_balance';
    SELECT COALESCE(balance, 0) INTO v_savings_balance
      FROM savings_accounts WHERE user_id = v_app.user_id AND status = 'active';
    IF v_savings_balance < v_min_savings THEN
      RAISE EXCEPTION 'Member savings balance (%) is below required minimum (%)', v_savings_balance, v_min_savings;
    END IF;
  END IF;

  -- Load product
  SELECT * INTO v_product FROM loan_products WHERE id = v_app.loan_product_id;

  IF v_product.id IS NOT NULL THEN
    v_interest_rate := v_product.interest_rate;
    IF v_product.interest_rate_period = 'monthly' THEN v_interest_rate := v_interest_rate * 12; END IF;
    v_calc_method := v_product.calculation_method;
    v_frequency   := v_product.repayment_frequency;
  ELSE
    SELECT COALESCE(config_value::DECIMAL, 12) INTO v_interest_rate FROM system_config WHERE config_key = 'loan_interest_rate';
    SELECT COALESCE(config_value,'reducing_balance') INTO v_calc_method FROM system_config WHERE config_key = 'interest_calculation_method';
    v_frequency := 'monthly';
  END IF;

  CASE v_frequency
    WHEN 'weekly'      THEN v_periods_per_yr := 52;  v_n_periods := v_app.term_months * 4; v_interval := '7 days'::INTERVAL;
    WHEN 'bi_weekly'   THEN v_periods_per_yr := 26;  v_n_periods := v_app.term_months * 2; v_interval := '14 days'::INTERVAL;
    WHEN 'semi_monthly' THEN v_periods_per_yr := 24; v_n_periods := v_app.term_months * 2; v_interval := '15 days'::INTERVAL;
    ELSE                    v_periods_per_yr := 12;  v_n_periods := v_app.term_months;     v_interval := '1 month'::INTERVAL;
  END CASE;

  v_r := v_interest_rate / 100.0 / v_periods_per_yr;

  IF v_calc_method = 'flat' THEN
    v_total_repayable := v_app.amount_requested + (v_app.amount_requested * v_interest_rate / 100.0 * v_app.term_months / 12.0);
    v_emi := v_total_repayable / v_n_periods;
  ELSIF v_calc_method = 'equal_principal' THEN
    v_principal_pay := ROUND(v_app.amount_requested / v_n_periods, 2);
    v_total_repayable := v_app.amount_requested;
  ELSE
    IF v_r = 0 THEN v_emi := v_app.amount_requested / v_n_periods;
    ELSE v_emi := v_app.amount_requested * v_r * POWER(1+v_r, v_n_periods) / (POWER(1+v_r, v_n_periods)-1);
    END IF;
    v_total_repayable := v_emi * v_n_periods;
  END IF;

  UPDATE loan_applications SET status = 'approved', reviewed_by = auth.uid(),
    decision_at = now(), updated_at = now() WHERE id = p_application_id;

  INSERT INTO loans (application_id, user_id, principal, interest_rate, term_months,
    calculation_method, repayment_frequency, total_repayable, outstanding, due_date)
  VALUES (p_application_id, v_app.user_id, v_app.amount_requested, v_interest_rate,
    v_app.term_months, v_calc_method, v_frequency,
    ROUND(v_total_repayable, 2), ROUND(v_total_repayable, 2),
    (now() + v_interval * v_n_periods)::DATE)
  RETURNING id INTO v_loan_id;

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
      IF i = v_n_periods THEN v_principal_pay := ROUND(v_outstanding, 2);
      ELSE v_principal_pay := ROUND(v_emi - v_outstanding * v_r, 2);
      END IF;
    END IF;
    INSERT INTO loan_repayment_schedules (loan_id, installment_no, due_date, principal_due, interest_due, total_due)
    VALUES (v_loan_id, i, (now() + v_interval * i)::DATE, v_principal_pay, v_interest_pay, v_principal_pay + v_interest_pay);
    v_outstanding := v_outstanding - v_principal_pay;
  END LOOP;

  INSERT INTO ledger_entries (user_id, entry_type, reference_id, reference_table, amount, direction, notes, created_by)
  VALUES (v_app.user_id, 'loan_disbursement', v_loan_id, 'loans', v_app.amount_requested, 'debit', 'Loan disbursed', auth.uid());

  RETURN v_loan_id;
END;
$$;
GRANT EXECUTE ON FUNCTION admin_approve_loan_application(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION admin_reject_loan_application(p_application_id UUID, p_reason TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin','staff') THEN RAISE EXCEPTION 'Access denied'; END IF;
  UPDATE loan_applications SET status = 'rejected', reviewed_by = auth.uid(),
    decision_at = now(), rejection_reason = p_reason, updated_at = now()
  WHERE id = p_application_id AND status IN ('submitted','under_review');
  IF NOT FOUND THEN RAISE EXCEPTION 'Application not found or not reviewable'; END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION admin_reject_loan_application(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION admin_set_loan_under_review(p_application_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin','staff') THEN RAISE EXCEPTION 'Access denied'; END IF;
  UPDATE loan_applications SET status = 'under_review', updated_at = now()
  WHERE id = p_application_id AND status = 'submitted';
  IF NOT FOUND THEN RAISE EXCEPTION 'Application not found or not submitted'; END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION admin_set_loan_under_review(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION cancel_loan_application(p_application_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE loan_applications SET status = 'cancelled', updated_at = now()
  WHERE id = p_application_id AND user_id = auth.uid() AND status IN ('draft','submitted');
  IF NOT FOUND THEN RAISE EXCEPTION 'Application not found or cannot be cancelled'; END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION cancel_loan_application(UUID) TO authenticated;

-- ─── PART 8: SAVINGS RPCs ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION approve_savings_deposit(p_request_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_req savings_deposit_requests%ROWTYPE;
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin','staff') THEN RAISE EXCEPTION 'Access denied'; END IF;
  SELECT * INTO v_req FROM savings_deposit_requests WHERE id = p_request_id;
  IF v_req.status != 'pending' THEN RAISE EXCEPTION 'Request is not pending'; END IF;
  INSERT INTO savings_contributions (account_id, user_id, request_id, amount, payment_method, reference, recorded_by)
  VALUES (v_req.account_id, v_req.user_id, v_req.id, v_req.amount, v_req.payment_method, v_req.reference, auth.uid());
  UPDATE savings_accounts SET balance = balance + v_req.amount, updated_at = now() WHERE id = v_req.account_id;
  UPDATE savings_deposit_requests SET status = 'approved', reviewed_by = auth.uid(),
    reviewed_at = now(), updated_at = now() WHERE id = p_request_id;
END;
$$;
GRANT EXECUTE ON FUNCTION approve_savings_deposit(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION reject_savings_deposit(p_request_id UUID, p_reason TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin','staff') THEN RAISE EXCEPTION 'Access denied'; END IF;
  UPDATE savings_deposit_requests SET status = 'rejected', reviewed_by = auth.uid(),
    reviewed_at = now(), rejection_reason = p_reason, updated_at = now()
  WHERE id = p_request_id AND status = 'pending';
END;
$$;
GRANT EXECUTE ON FUNCTION reject_savings_deposit(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION approve_savings_withdrawal(p_request_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_req         savings_withdrawal_requests%ROWTYPE;
  v_balance     DECIMAL(15,2);
  v_min_balance DECIMAL(15,2);
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin','staff') THEN RAISE EXCEPTION 'Access denied'; END IF;
  SELECT * INTO v_req FROM savings_withdrawal_requests WHERE id = p_request_id;
  IF v_req.status != 'pending' THEN RAISE EXCEPTION 'Request is not pending'; END IF;
  SELECT balance INTO v_balance FROM savings_accounts WHERE id = v_req.account_id;
  SELECT COALESCE(config_value::DECIMAL, 500) INTO v_min_balance
    FROM system_config WHERE config_key = 'savings_min_balance';
  IF v_balance < v_req.amount THEN
    RAISE EXCEPTION 'Insufficient balance (balance: %, requested: %)', v_balance, v_req.amount;
  END IF;
  IF v_balance - v_req.amount < v_min_balance THEN
    RAISE EXCEPTION 'Withdrawal would drop balance below minimum of %', v_min_balance;
  END IF;
  UPDATE savings_accounts SET balance = balance - v_req.amount, updated_at = now() WHERE id = v_req.account_id;
  INSERT INTO ledger_entries (user_id, entry_type, reference_id, reference_table, amount, direction, created_by)
  VALUES (v_req.user_id, 'savings_withdrawal', v_req.id, 'savings_withdrawal_requests', v_req.amount, 'debit', auth.uid());
  UPDATE savings_withdrawal_requests SET status = 'approved', reviewed_by = auth.uid(),
    reviewed_at = now(), updated_at = now() WHERE id = p_request_id;
END;
$$;
GRANT EXECUTE ON FUNCTION approve_savings_withdrawal(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION reject_savings_withdrawal(p_request_id UUID, p_reason TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin','staff') THEN RAISE EXCEPTION 'Access denied'; END IF;
  UPDATE savings_withdrawal_requests SET status = 'rejected', reviewed_by = auth.uid(),
    reviewed_at = now(), rejection_reason = p_reason, updated_at = now()
  WHERE id = p_request_id AND status = 'pending';
END;
$$;
GRANT EXECUTE ON FUNCTION reject_savings_withdrawal(UUID, TEXT) TO authenticated;

-- Direct savings recording (bulk import)
CREATE OR REPLACE FUNCTION admin_record_savings_direct(
  p_user_id UUID, p_amount DECIMAL(15,2), p_payment_method VARCHAR,
  p_reference VARCHAR, p_date TIMESTAMPTZ, p_recorded_by UUID
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_account_id UUID;
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin','staff') THEN RAISE EXCEPTION 'Access denied'; END IF;
  SELECT id INTO v_account_id FROM savings_accounts WHERE user_id = p_user_id;
  IF v_account_id IS NULL THEN
    INSERT INTO savings_accounts (user_id, balance, status) VALUES (p_user_id, 0, 'active') RETURNING id INTO v_account_id;
  END IF;
  INSERT INTO savings_contributions (account_id, user_id, request_id, amount, payment_method, reference, recorded_by, contributed_at)
  VALUES (v_account_id, p_user_id, NULL, p_amount, p_payment_method, p_reference, p_recorded_by, p_date);
  UPDATE savings_accounts SET balance = balance + p_amount, updated_at = now() WHERE id = v_account_id;
END;
$$;
GRANT EXECUTE ON FUNCTION admin_record_savings_direct(UUID, DECIMAL, VARCHAR, VARCHAR, TIMESTAMPTZ, UUID) TO authenticated;

-- Staff post deposit (weekly posting — the main operational flow)
CREATE OR REPLACE FUNCTION staff_post_deposit(
  p_user_id UUID, p_amount DECIMAL(15,2), p_destination VARCHAR,
  p_date TIMESTAMPTZ, p_reference VARCHAR, p_recorded_by UUID
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_share_id     UUID;
  v_account_id   UUID;
  v_completed_ct INT;
  v_dest         VARCHAR;
  v_paid         DECIMAL(15,2);
  v_target       DECIMAL(15,2);
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin','staff') THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF p_amount <= 0 THEN RAISE EXCEPTION 'Amount must be positive'; END IF;

  SELECT COUNT(*) INTO v_completed_ct FROM equity_shares WHERE user_id = p_user_id AND status = 'completed';
  v_dest := CASE WHEN p_destination = 'savings' AND v_completed_ct = 0 THEN 'shares' ELSE p_destination END;

  IF v_dest = 'shares' THEN
    SELECT id INTO v_share_id FROM equity_shares
    WHERE user_id = p_user_id AND status = 'in_progress' ORDER BY created_at ASC LIMIT 1;
    IF v_share_id IS NULL THEN RAISE EXCEPTION 'Member has no active share to deposit into'; END IF;

    INSERT INTO equity_contributions (user_id, share_id, amount, payment_method, reference, recorded_by, contribution_at)
    VALUES (p_user_id, v_share_id, p_amount, 'bank_transfer', p_reference, p_recorded_by, p_date);

    SELECT COALESCE(SUM(amount), 0) INTO v_paid FROM equity_contributions WHERE share_id = v_share_id;
    SELECT target_amount INTO v_target FROM equity_shares WHERE id = v_share_id;
    UPDATE equity_shares SET paid_amount = v_paid,
      status = CASE WHEN v_paid >= v_target THEN 'completed' ELSE status END,
      completed_at = CASE WHEN v_paid >= v_target AND completed_at IS NULL THEN now() ELSE completed_at END,
      updated_at = now()
    WHERE id = v_share_id;

    RETURN jsonb_build_object('destination', 'shares', 'share_id', v_share_id, 'amount', p_amount);
  ELSE
    SELECT id INTO v_account_id FROM savings_accounts WHERE user_id = p_user_id;
    IF v_account_id IS NULL THEN
      INSERT INTO savings_accounts (user_id, balance, status) VALUES (p_user_id, 0, 'active') RETURNING id INTO v_account_id;
    END IF;
    INSERT INTO savings_contributions (account_id, user_id, request_id, amount, payment_method, reference, recorded_by, contributed_at)
    VALUES (v_account_id, p_user_id, NULL, p_amount, 'bank_transfer', p_reference, p_recorded_by, p_date);
    UPDATE savings_accounts SET balance = balance + p_amount, updated_at = now() WHERE id = v_account_id;
    RETURN jsonb_build_object('destination', 'savings', 'account_id', v_account_id, 'amount', p_amount);
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION staff_post_deposit(UUID, DECIMAL, VARCHAR, TIMESTAMPTZ, VARCHAR, UUID) TO authenticated;

-- Release savings interest (admin-triggered)
CREATE OR REPLACE FUNCTION release_savings_interest(p_force BOOLEAN DEFAULT false)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rate             DECIMAL(5,2);
  v_release_months   TEXT;
  v_current_month    INT;
  v_period_start_ts  TIMESTAMPTZ;
  v_period_end_ts    TIMESTAMPTZ;
  v_account          savings_accounts%ROWTYPE;
  v_adb              DECIMAL(15,2);
  v_interest         DECIMAL(15,2);
BEGIN
  IF NOT p_force THEN
    SELECT COALESCE(config_value,'6,12') INTO v_release_months
      FROM system_config WHERE config_key = 'savings_interest_release_months';
    v_current_month := EXTRACT(MONTH FROM now())::INT;
    IF NOT (v_current_month = ANY(SELECT unnest(string_to_array(v_release_months,','))::INT)) THEN
      RETURN;
    END IF;
  END IF;

  SELECT COALESCE(config_value::DECIMAL, 2.5) INTO v_rate
    FROM system_config WHERE config_key = 'savings_interest_rate';

  v_period_end_ts := now();

  FOR v_account IN SELECT * FROM savings_accounts WHERE status = 'active' LOOP
    SELECT COALESCE(MAX(period_end), v_period_end_ts - INTERVAL '6 months')
    INTO v_period_start_ts
    FROM savings_interest_logs WHERE account_id = v_account.id;

    IF EXISTS (SELECT 1 FROM savings_interest_logs WHERE account_id = v_account.id
      AND period_start = v_period_start_ts AND period_end = v_period_end_ts) THEN
      CONTINUE;
    END IF;

    -- Simple average: use current balance as proxy
    v_adb := v_account.balance;
    v_interest := ROUND(v_adb * (v_rate / 100.0) / 2, 2); -- semi-annual

    IF v_interest <= 0 THEN CONTINUE; END IF;

    UPDATE savings_accounts SET balance = balance + v_interest, updated_at = now() WHERE id = v_account.id;

    INSERT INTO savings_interest_logs (account_id, user_id, period_start, period_end,
      average_daily_balance, interest_rate, interest_amount, released_by)
    VALUES (v_account.id, v_account.user_id, v_period_start_ts, v_period_end_ts,
      v_adb, v_rate / 100.0, v_interest, auth.uid());

    INSERT INTO ledger_entries (user_id, entry_type, reference_id, reference_table, amount, direction, notes, created_by)
    VALUES (v_account.user_id, 'savings_interest', v_account.id, 'savings_accounts',
      v_interest, 'credit', 'Savings interest released', auth.uid());
  END LOOP;
END;
$$;
GRANT EXECUTE ON FUNCTION release_savings_interest(BOOLEAN) TO authenticated;

-- Release equity dividends
CREATE OR REPLACE FUNCTION release_equity_dividend()
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_rate         DECIMAL;
  v_period_end   DATE := CURRENT_DATE;
  v_count        INT := 0;
  v_period_start DATE;
  v_dividend     DECIMAL(15,2);
  v_already_run  BOOLEAN;
  r              RECORD;
BEGIN
  IF get_user_role(auth.uid()) != 'admin' THEN RAISE EXCEPTION 'Access denied — only admin can release dividends'; END IF;
  SELECT COALESCE(config_value::DECIMAL, 5) INTO v_rate FROM system_config WHERE config_key = 'equity_dividend_rate';

  FOR r IN SELECT es.id AS share_id, es.user_id, es.target_amount FROM equity_shares es WHERE es.status = 'completed' LOOP
    SELECT COALESCE(MAX(period_end), v_period_end - INTERVAL '1 year') INTO v_period_start
      FROM equity_dividend_logs WHERE share_id = r.share_id;
    SELECT EXISTS (SELECT 1 FROM equity_dividend_logs WHERE share_id = r.share_id
      AND period_start = v_period_start::DATE AND period_end = v_period_end) INTO v_already_run;
    IF v_already_run THEN CONTINUE; END IF;
    v_dividend := ROUND(r.target_amount * v_rate / 100.0, 2);
    INSERT INTO equity_dividend_logs (share_id, user_id, share_value, dividend_earned, period_start, period_end, released_by)
    VALUES (r.share_id, r.user_id, r.target_amount, v_dividend, v_period_start::DATE, v_period_end, auth.uid());
    UPDATE savings_accounts SET balance = balance + v_dividend, updated_at = now()
      WHERE user_id = r.user_id AND status = 'active';
    INSERT INTO ledger_entries (user_id, entry_type, reference_id, reference_table, amount, direction, notes, created_by)
    VALUES (r.user_id, 'equity_dividend', r.share_id, 'equity_shares', v_dividend, 'credit', 'Equity share dividend', auth.uid());
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;
GRANT EXECUTE ON FUNCTION release_equity_dividend() TO authenticated;

-- Release rebates
CREATE OR REPLACE FUNCTION release_rebates(p_period_start DATE, p_period_end DATE, p_rate DECIMAL)
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_release_id UUID;
  v_count      INT := 0;
  v_rebate     DECIMAL(15,2);
  r            RECORD;
BEGIN
  IF get_user_role(auth.uid()) != 'admin' THEN RAISE EXCEPTION 'Access denied'; END IF;
  INSERT INTO rebate_releases (period_start, period_end, rate, released_by)
  VALUES (p_period_start, p_period_end, p_rate, auth.uid()) RETURNING id INTO v_release_id;

  FOR r IN
    SELECT lr.loan_id, l.user_id, SUM(lr.amount) AS total_paid
    FROM loan_repayments lr
    JOIN loans l ON l.id = lr.loan_id
    WHERE lr.payment_at::DATE BETWEEN p_period_start AND p_period_end
    GROUP BY lr.loan_id, l.user_id
  LOOP
    v_rebate := ROUND(r.total_paid * p_rate / 100.0, 2);
    IF v_rebate <= 0 THEN CONTINUE; END IF;
    INSERT INTO rebate_logs (release_id, user_id, loan_id, interest_paid, rebate_amount)
    VALUES (v_release_id, r.user_id, r.loan_id, r.total_paid, v_rebate);
    UPDATE savings_accounts SET balance = balance + v_rebate, updated_at = now()
      WHERE user_id = r.user_id AND status = 'active';
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;
GRANT EXECUTE ON FUNCTION release_rebates(DATE, DATE, DECIMAL) TO authenticated;

-- Batch deposit approval
CREATE OR REPLACE FUNCTION approve_batch_deposit(p_batch_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_batch  batch_deposits%ROWTYPE;
  v_item   batch_deposit_items%ROWTYPE;
  v_share_id UUID;
  v_request_id UUID;
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin','staff') THEN RAISE EXCEPTION 'Access denied'; END IF;
  SELECT * INTO v_batch FROM batch_deposits WHERE id = p_batch_id;
  IF v_batch.status != 'pending' THEN RAISE EXCEPTION 'Batch is not pending'; END IF;
  FOR v_item IN SELECT * FROM batch_deposit_items WHERE batch_id = p_batch_id LOOP
    SELECT id INTO v_share_id FROM equity_shares
    WHERE user_id = v_item.user_id AND status = 'in_progress' ORDER BY share_number ASC LIMIT 1;
    IF v_share_id IS NULL THEN RAISE EXCEPTION 'Member % has no active equity share', v_item.user_id; END IF;
    INSERT INTO equity_deposit_requests (user_id, share_id, amount, payment_method, reference, receipt_url, notes, status)
    VALUES (v_item.user_id, v_share_id, v_item.amount, v_batch.payment_method, v_batch.reference, v_batch.receipt_url, v_batch.notes, 'pending')
    RETURNING id INTO v_request_id;
    UPDATE batch_deposit_items SET deposit_request_id = v_request_id WHERE id = v_item.id;
    PERFORM approve_deposit_request(v_request_id);
  END LOOP;
  UPDATE batch_deposits SET status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
  WHERE id = p_batch_id;
END;
$$;
GRANT EXECUTE ON FUNCTION approve_batch_deposit(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION reject_batch_deposit(p_batch_id UUID, p_reason TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin','staff') THEN RAISE EXCEPTION 'Access denied'; END IF;
  UPDATE batch_deposits SET status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(),
    rejection_reason = p_reason, updated_at = now()
  WHERE id = p_batch_id AND status = 'pending';
END;
$$;
GRANT EXECUTE ON FUNCTION reject_batch_deposit(UUID, TEXT) TO authenticated;

-- ─── PART 9: STORAGE BUCKETS ──────────────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public) VALUES ('branding', 'branding', true) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('avatars', 'avatars', true) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('deposit-receipts', 'deposit-receipts', false) ON CONFLICT (id) DO NOTHING;

CREATE POLICY "branding_public_read" ON storage.objects FOR SELECT USING (bucket_id = 'branding');
CREATE POLICY "branding_admin_write" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'branding' AND get_user_role(auth.uid()) = 'admin');
CREATE POLICY "branding_admin_update" ON storage.objects FOR UPDATE USING (bucket_id = 'branding' AND get_user_role(auth.uid()) = 'admin');
CREATE POLICY "branding_admin_delete" ON storage.objects FOR DELETE USING (bucket_id = 'branding' AND get_user_role(auth.uid()) = 'admin');

CREATE POLICY "avatars_public_read" ON storage.objects FOR SELECT TO public USING (bucket_id = 'avatars');
CREATE POLICY "avatars_upload" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "avatars_update" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "receipts_member_upload" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'deposit-receipts' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "receipts_admin_read" ON storage.objects FOR SELECT USING (bucket_id = 'deposit-receipts' AND get_user_role(auth.uid()) IN ('admin','staff'));

-- ─── PART 10: SEED DATA ───────────────────────────────────────────────────────

INSERT INTO system_config (config_key, config_value, value_type, description) VALUES
  ('currency_code',                   'PHP',              'string',  'ISO currency code'),
  ('currency_symbol',                 '₱',               'string',  'Currency symbol shown in the UI'),
  ('share_price',                     '5000.00',          'number',  'Cost of one full equity share'),
  ('min_installment_amount',          '100.00',           'number',  'Minimum allowed installment payment'),
  ('installment_frequency',           'weekly',           'enum',    'Payment cadence: weekly, biweekly, monthly'),
  ('max_shares_per_member',           '10',               'number',  'Cap on shares a single member can hold'),
  ('loan_to_equity_ratio',            '2.0',              'number',  'Max loan relative to completed share value'),
  ('min_shares_for_loan',             '1',                'number',  'Minimum completed shares required for a loan'),
  ('max_loan_term_months',            '36',               'number',  'Maximum repayment period in months'),
  ('loan_interest_rate',              '12',               'number',  'Annual interest rate percentage'),
  ('interest_calculation_method',     'reducing_balance', 'enum',    'flat or reducing_balance'),
  ('grace_period_days',               '7',                'number',  'Days before a missed payment triggers a flag'),
  ('loan_default_threshold_days',     '30',               'number',  'Days overdue before loan is marked defaulted'),
  ('membership_lapse_on_default',     'true',             'boolean', 'Whether loan default suspends membership'),
  ('loan_min_co_makers',              '1',                'number',  'Minimum co-makers required per loan application'),
  ('savings_interest_rate',           '2.5',              'number',  'Annual savings interest rate (%)'),
  ('savings_min_balance',             '500.00',           'number',  'Minimum balance to maintain in savings'),
  ('savings_interest_release_months', '6,12',             'string',  'Months when interest is auto-released (e.g. 6,12 = June & December)'),
  ('savings_required_for_loan',       'false',            'boolean', 'Whether savings account balance is required before loan approval'),
  ('loan_min_savings_balance',        '500',              'number',  'Minimum savings balance required before loan can be approved'),
  ('equity_dividend_rate',            '5',                'number',  'Dividend rate (%) applied to completed share value per period'),
  ('equity_dividend_period_months',   '12',               'number',  'Dividend release cadence in months'),
  ('app_name',                        'CoopFinance',      'string',  'Application name shown in the UI'),
  ('app_vision',                      '',                 'string',  'Vision statement of the cooperative'),
  ('app_mission',                     '',                 'string',  'Mission statement of the cooperative'),
  ('app_logo_url',                    '',                 'string',  'URL to the cooperative logo')
ON CONFLICT (config_key) DO NOTHING;

INSERT INTO role_permissions (role, permission_key, enabled) VALUES
  ('staff',  'approve_deposits',       true),
  ('staff',  'reject_deposits',        true),
  ('staff',  'approve_loan_apps',      true),
  ('staff',  'reject_loan_apps',       true),
  ('staff',  'approve_membership',     true),
  ('staff',  'view_reports',           true),
  ('staff',  'manage_loan_products',   false),
  ('staff',  'restructure_loans',      false),
  ('member', 'apply_for_loan',         true),
  ('member', 'submit_deposit_request', true),
  ('member', 'view_loan_calculator',   true)
ON CONFLICT (role, permission_key) DO NOTHING;

-- ─── DONE ─────────────────────────────────────────────────────────────────────
-- After running this script:
-- 1. Go to Authentication > Settings and configure email/password signup as needed
-- 2. The first user you create via the Supabase dashboard should be given admin role:
--    UPDATE profiles SET role = 'admin' WHERE id = '<your-user-id>';
-- 3. Configure your .env with the new project URL and anon key
