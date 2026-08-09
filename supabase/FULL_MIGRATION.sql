-- FULL_MIGRATION.sql
-- Auto-generated: concatenation of all migrations in order.
-- Run this against a fresh Supabase instance to bootstrap the schema.

-- ============================================================
-- Migration: 01_system_config.sql
-- ============================================================

-- System Configuration Tables
CREATE TABLE system_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_key VARCHAR UNIQUE NOT NULL,
  config_value VARCHAR NOT NULL,
  value_type VARCHAR CHECK (value_type IN ('string','number','boolean','enum')) NOT NULL,
  description TEXT,
  updated_by UUID REFERENCES auth.users(id),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE system_config_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_key VARCHAR NOT NULL,
  old_value VARCHAR,
  new_value VARCHAR NOT NULL,
  changed_by UUID REFERENCES auth.users(id),
  changed_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO system_config (config_key, config_value, value_type, description) VALUES
  ('currency_code', 'PHP', 'string', 'ISO currency code (e.g. PHP, USD, SGD)'),
  ('currency_symbol', '₱', 'string', 'Currency symbol shown in the UI (e.g. ₱, $, S$)'),
  ('share_price', '5000.00', 'number', 'Cost of one full equity share'),
  ('min_installment_amount', '100.00', 'number', 'Minimum allowed installment payment'),
  ('installment_frequency', 'weekly', 'enum', 'Allowed payment cadence: weekly, biweekly, monthly'),
  ('max_shares_per_member', '10', 'number', 'Cap on shares a single member can hold'),
  ('loan_to_equity_ratio', '2.0', 'number', 'Max loan amount relative to completed share value'),
  ('min_shares_for_loan', '1', 'number', 'Minimum completed shares required to apply for a loan'),
  ('max_loan_term_months', '36', 'number', 'Maximum repayment period in months'),
  ('loan_interest_rate', '12', 'number', 'Annual interest rate percentage'),
  ('interest_calculation_method', 'reducing_balance', 'enum', 'flat or reducing_balance'),
  ('grace_period_days', '7', 'number', 'Days before a missed payment triggers a flag'),
  ('loan_default_threshold_days', '30', 'number', 'Days overdue before a loan is marked defaulted'),
  ('membership_lapse_on_default', 'true', 'boolean', 'Whether loan default suspends membership');


-- ============================================================
-- Migration: 02_users_and_roles.sql
-- ============================================================

-- Users and Roles
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name VARCHAR NOT NULL,
  phone VARCHAR,
  role VARCHAR CHECK (role IN ('admin','member','staff')) NOT NULL DEFAULT 'member',
  account_status VARCHAR CHECK (account_status IN ('active','suspended','inactive')) NOT NULL DEFAULT 'active',
  employee_id VARCHAR UNIQUE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

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


-- ============================================================
-- Migration: 03_equity.sql
-- ============================================================

-- Equity Tables
CREATE TABLE equity_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  share_number INT NOT NULL,
  target_amount DECIMAL(15,2) NOT NULL,
  paid_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  status VARCHAR CHECK (status IN ('in_progress','completed','cancelled')) NOT NULL DEFAULT 'in_progress',
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, share_number)
);

CREATE TABLE equity_contributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id),
  share_id UUID NOT NULL REFERENCES equity_shares(id),
  amount DECIMAL(15,2) NOT NULL CHECK (amount > 0),
  payment_method VARCHAR CHECK (payment_method IN ('cash','bank_transfer','mobile_money')) NOT NULL,
  reference VARCHAR,
  recorded_by UUID REFERENCES profiles(id),
  contribution_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Auto-update share paid_amount and status on contribution insert
CREATE OR REPLACE FUNCTION update_share_on_contribution()
RETURNS TRIGGER AS $$
DECLARE
  v_share equity_shares%ROWTYPE;
BEGIN
  SELECT * INTO v_share FROM equity_shares WHERE id = NEW.share_id FOR UPDATE;

  UPDATE equity_shares
  SET
    paid_amount = paid_amount + NEW.amount,
    status = CASE WHEN paid_amount + NEW.amount >= target_amount THEN 'completed' ELSE status END,
    completed_at = CASE WHEN paid_amount + NEW.amount >= target_amount THEN now() ELSE completed_at END,
    updated_at = now()
  WHERE id = NEW.share_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER after_contribution_insert
  AFTER INSERT ON equity_contributions
  FOR EACH ROW EXECUTE FUNCTION update_share_on_contribution();


-- ============================================================
-- Migration: 04_membership.sql
-- ============================================================

-- Membership Tables
CREATE TABLE membership_status (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) UNIQUE,
  status VARCHAR CHECK (status IN ('pending','active','suspended','inactive')) NOT NULL DEFAULT 'pending',
  completed_shares INT NOT NULL DEFAULT 0,
  last_evaluated_at TIMESTAMPTZ DEFAULT now(),
  reason VARCHAR,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE membership_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id),
  from_status VARCHAR,
  to_status VARCHAR NOT NULL,
  reason TEXT,
  changed_at TIMESTAMPTZ DEFAULT now()
);

-- Function to evaluate membership for a user
CREATE OR REPLACE FUNCTION evaluate_membership(p_user_id UUID)
RETURNS VOID AS $$
DECLARE
  v_completed_shares INT;
  v_current_status VARCHAR;
  v_new_status VARCHAR;
  v_has_active_default BOOLEAN;
  v_lapse_on_default BOOLEAN;
BEGIN
  SELECT COUNT(*) INTO v_completed_shares
  FROM equity_shares
  WHERE user_id = p_user_id AND status = 'completed';

  SELECT (config_value = 'true') INTO v_lapse_on_default
  FROM system_config WHERE config_key = 'membership_lapse_on_default';

  SELECT EXISTS(
    SELECT 1 FROM loans WHERE user_id = p_user_id AND status = 'defaulted'
  ) INTO v_has_active_default;

  IF v_completed_shares = 0 THEN
    v_new_status := 'pending';
  ELSIF v_lapse_on_default AND v_has_active_default THEN
    v_new_status := 'suspended';
  ELSE
    v_new_status := 'active';
  END IF;

  SELECT status INTO v_current_status
  FROM membership_status WHERE user_id = p_user_id;

  IF v_current_status IS NULL THEN
    INSERT INTO membership_status (user_id, status, completed_shares, last_evaluated_at)
    VALUES (p_user_id, v_new_status, v_completed_shares, now());
  ELSIF v_current_status != v_new_status THEN
    INSERT INTO membership_history (user_id, from_status, to_status)
    VALUES (p_user_id, v_current_status, v_new_status);

    UPDATE membership_status
    SET status = v_new_status,
        completed_shares = v_completed_shares,
        last_evaluated_at = now(),
        updated_at = now()
    WHERE user_id = p_user_id;
  ELSE
    UPDATE membership_status
    SET completed_shares = v_completed_shares,
        last_evaluated_at = now(),
        updated_at = now()
    WHERE user_id = p_user_id;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Trigger membership evaluation when a share is completed
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


-- ============================================================
-- Migration: 05_lending.sql
-- ============================================================

-- Lending Tables
CREATE TABLE loan_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id),
  amount_requested DECIMAL(15,2) NOT NULL CHECK (amount_requested > 0),
  purpose TEXT,
  term_months INT NOT NULL,
  status VARCHAR CHECK (status IN ('draft','submitted','under_review','approved','rejected','cancelled')) NOT NULL DEFAULT 'draft',
  reviewed_by UUID REFERENCES profiles(id),
  decision_at TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE loans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES loan_applications(id),
  user_id UUID NOT NULL REFERENCES profiles(id),
  principal DECIMAL(15,2) NOT NULL,
  interest_rate DECIMAL(5,2) NOT NULL,
  term_months INT NOT NULL,
  calculation_method VARCHAR CHECK (calculation_method IN ('flat','reducing_balance')) NOT NULL,
  total_repayable DECIMAL(15,2) NOT NULL,
  amount_paid DECIMAL(15,2) NOT NULL DEFAULT 0,
  outstanding DECIMAL(15,2) NOT NULL,
  status VARCHAR CHECK (status IN ('active','completed','defaulted','written_off')) NOT NULL DEFAULT 'active',
  disbursed_at TIMESTAMPTZ DEFAULT now(),
  due_date DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE loan_repayment_schedule (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id UUID NOT NULL REFERENCES loans(id),
  installment_no INT NOT NULL,
  due_date DATE NOT NULL,
  principal_due DECIMAL(15,2) NOT NULL,
  interest_due DECIMAL(15,2) NOT NULL,
  total_due DECIMAL(15,2) NOT NULL,
  amount_paid DECIMAL(15,2) NOT NULL DEFAULT 0,
  status VARCHAR CHECK (status IN ('pending','partial','paid','overdue','waived')) NOT NULL DEFAULT 'pending',
  paid_at TIMESTAMPTZ,
  UNIQUE(loan_id, installment_no)
);

CREATE TABLE loan_repayments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id UUID NOT NULL REFERENCES loans(id),
  schedule_id UUID REFERENCES loan_repayment_schedule(id),
  amount DECIMAL(15,2) NOT NULL CHECK (amount > 0),
  payment_method VARCHAR CHECK (payment_method IN ('cash','bank_transfer','mobile_money')) NOT NULL,
  reference VARCHAR,
  recorded_by UUID REFERENCES profiles(id),
  payment_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);


-- ============================================================
-- Migration: 06_ledger.sql
-- ============================================================

-- Ledger Tables
CREATE TABLE ledger_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id),
  entry_type VARCHAR CHECK (entry_type IN (
    'equity_contribution','equity_reversal',
    'loan_disbursement','loan_repayment',
    'fee','adjustment'
  )) NOT NULL,
  reference_id UUID NOT NULL,
  reference_table VARCHAR NOT NULL,
  amount DECIMAL(15,2) NOT NULL,
  direction VARCHAR CHECK (direction IN ('debit','credit')) NOT NULL,
  notes TEXT,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Append-only: no updates or deletes allowed
CREATE RULE no_update_ledger AS ON UPDATE TO ledger_entries DO INSTEAD NOTHING;
CREATE RULE no_delete_ledger AS ON DELETE TO ledger_entries DO INSTEAD NOTHING;

-- Auto-insert ledger entry on equity contribution
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

-- Auto-insert ledger entry on loan repayment
CREATE OR REPLACE FUNCTION ledger_on_repayment()
RETURNS TRIGGER AS $$
DECLARE
  v_user_id UUID;
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


-- ============================================================
-- Migration: 07_rls_policies.sql
-- ============================================================

-- Row Level Security Policies

-- Enable RLS on all tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE equity_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE equity_contributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE membership_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE membership_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE loan_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE loans ENABLE ROW LEVEL SECURITY;
ALTER TABLE loan_repayment_schedule ENABLE ROW LEVEL SECURITY;
ALTER TABLE loan_repayments ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_config_history ENABLE ROW LEVEL SECURITY;

-- Helper: get caller role
CREATE OR REPLACE FUNCTION get_user_role(p_user_id UUID)
RETURNS VARCHAR AS $$
  SELECT role FROM profiles WHERE id = p_user_id;
$$ LANGUAGE sql SECURITY DEFINER;

-- profiles: users see own, admins/staff see all
CREATE POLICY profiles_self ON profiles FOR SELECT USING (id = auth.uid());
CREATE POLICY profiles_admin ON profiles FOR ALL USING (get_user_role(auth.uid()) IN ('admin','staff'));

-- equity: members see own, admins/staff see all
CREATE POLICY equity_shares_self ON equity_shares FOR SELECT USING (user_id = auth.uid());
CREATE POLICY equity_shares_admin ON equity_shares FOR ALL USING (get_user_role(auth.uid()) IN ('admin','staff'));

CREATE POLICY equity_contributions_self ON equity_contributions FOR SELECT USING (user_id = auth.uid());
CREATE POLICY equity_contributions_admin ON equity_contributions FOR ALL USING (get_user_role(auth.uid()) IN ('admin','staff'));

-- membership
CREATE POLICY membership_self ON membership_status FOR SELECT USING (user_id = auth.uid());
CREATE POLICY membership_admin ON membership_status FOR ALL USING (get_user_role(auth.uid()) IN ('admin','staff'));

CREATE POLICY membership_history_self ON membership_history FOR SELECT USING (user_id = auth.uid());
CREATE POLICY membership_history_admin ON membership_history FOR ALL USING (get_user_role(auth.uid()) IN ('admin','staff'));

-- loans
CREATE POLICY loans_self ON loan_applications FOR SELECT USING (user_id = auth.uid());
CREATE POLICY loans_insert ON loan_applications FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY loans_admin ON loan_applications FOR ALL USING (get_user_role(auth.uid()) IN ('admin','staff'));

CREATE POLICY loans_tbl_self ON loans FOR SELECT USING (user_id = auth.uid());
CREATE POLICY loans_tbl_admin ON loans FOR ALL USING (get_user_role(auth.uid()) IN ('admin','staff'));

CREATE POLICY loan_schedule_self ON loan_repayment_schedule FOR SELECT
  USING (loan_id IN (SELECT id FROM loans WHERE user_id = auth.uid()));
CREATE POLICY loan_schedule_admin ON loan_repayment_schedule FOR ALL
  USING (get_user_role(auth.uid()) IN ('admin','staff'));

CREATE POLICY loan_repayments_self ON loan_repayments FOR SELECT USING (
  loan_id IN (SELECT id FROM loans WHERE user_id = auth.uid())
);
CREATE POLICY loan_repayments_admin ON loan_repayments FOR ALL USING (get_user_role(auth.uid()) IN ('admin','staff'));

-- ledger: members see own, admins see all
CREATE POLICY ledger_self ON ledger_entries FOR SELECT USING (user_id = auth.uid());
CREATE POLICY ledger_admin ON ledger_entries FOR SELECT USING (get_user_role(auth.uid()) IN ('admin','staff'));
CREATE POLICY ledger_insert ON ledger_entries FOR INSERT WITH CHECK (get_user_role(auth.uid()) IN ('admin','staff'));

-- system_config: admins manage, all authenticated users can read
CREATE POLICY config_admin ON system_config FOR ALL USING (get_user_role(auth.uid()) = 'admin');
CREATE POLICY config_read ON system_config FOR SELECT USING (get_user_role(auth.uid()) IN ('admin','staff','member'));

CREATE POLICY config_history_admin ON system_config_history FOR ALL USING (get_user_role(auth.uid()) = 'admin');


-- ============================================================
-- Migration: 08_admin_user_view.sql
-- ============================================================

-- Admin user management functions and view
-- Run this after 07_rls_policies.sql

-- Secure function to list all users (includes email from auth.users)
-- SECURITY DEFINER runs as the function owner (postgres), bypassing RLS on auth.users
CREATE OR REPLACE FUNCTION get_all_users_for_admin()
RETURNS TABLE (
  id              UUID,
  full_name       VARCHAR,
  phone           VARCHAR,
  role            VARCHAR,
  account_status  VARCHAR,
  email           VARCHAR,
  membership_status VARCHAR,
  completed_shares  INT,
  created_at      TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin', 'staff') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.full_name,
    p.phone,
    p.role,
    p.account_status,
    u.email::VARCHAR,
    ms.status::VARCHAR       AS membership_status,
    ms.completed_shares,
    p.created_at
  FROM profiles p
  LEFT JOIN auth.users u ON u.id = p.id
  LEFT JOIN membership_status ms ON ms.user_id = p.id
  ORDER BY p.created_at DESC;
END;
$$;

-- Grant execute to authenticated users (the function itself checks role internally)
GRANT EXECUTE ON FUNCTION get_all_users_for_admin() TO authenticated;

-- Secure function for admins to update a user's role
CREATE OR REPLACE FUNCTION admin_update_user_role(
  p_target_user_id UUID,
  p_new_role        VARCHAR
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF get_user_role(auth.uid()) != 'admin' THEN
    RAISE EXCEPTION 'Only admins can change user roles';
  END IF;

  IF p_new_role NOT IN ('admin', 'staff', 'member') THEN
    RAISE EXCEPTION 'Invalid role: %', p_new_role;
  END IF;

  UPDATE profiles
  SET role = p_new_role, updated_at = now()
  WHERE id = p_target_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_update_user_role(UUID, VARCHAR) TO authenticated;

-- Secure function for admins/staff to update a user's account status
CREATE OR REPLACE FUNCTION admin_update_user_status(
  p_target_user_id UUID,
  p_new_status      VARCHAR
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin', 'staff') THEN
    RAISE EXCEPTION 'Only admins or staff can change account status';
  END IF;

  IF p_new_status NOT IN ('active', 'suspended', 'inactive') THEN
    RAISE EXCEPTION 'Invalid status: %', p_new_status;
  END IF;

  UPDATE profiles
  SET account_status = p_new_status, updated_at = now()
  WHERE id = p_target_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_update_user_status(UUID, VARCHAR) TO authenticated;


-- ============================================================
-- Migration: 09_employee_link.sql
-- ============================================================

-- Employee link functions
-- employee_id column is defined in 02_users_and_roles.sql
-- Run this after 08_admin_user_view.sql

-- Allow admins/staff to link a profile to an employee_id
CREATE OR REPLACE FUNCTION admin_link_employee(
  p_profile_id  UUID,
  p_employee_id VARCHAR
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin', 'staff') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  UPDATE profiles
  SET employee_id = p_employee_id, updated_at = now()
  WHERE id = p_profile_id;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_link_employee(UUID, VARCHAR) TO authenticated;


-- ============================================================
-- Migration: 10_deposit_requests.sql
-- ============================================================

-- Deposit request submitted by member, approved by staff/admin
CREATE TABLE deposit_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id),
  share_id UUID NOT NULL REFERENCES equity_shares(id),
  amount DECIMAL(15,2) NOT NULL CHECK (amount > 0),
  payment_method VARCHAR CHECK (payment_method IN ('cash','bank_transfer','mobile_money')) NOT NULL,
  reference VARCHAR,
  receipt_url VARCHAR,   -- Supabase Storage public URL
  notes TEXT,
  status VARCHAR CHECK (status IN ('pending','approved','rejected')) NOT NULL DEFAULT 'pending',
  reviewed_by UUID REFERENCES profiles(id),
  reviewed_at TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE deposit_requests ENABLE ROW LEVEL SECURITY;

-- Members see only their own requests
CREATE POLICY deposit_requests_member ON deposit_requests
  FOR ALL USING (user_id = auth.uid());

-- Staff/admin see all
CREATE POLICY deposit_requests_admin ON deposit_requests
  FOR ALL USING (get_user_role(auth.uid()) IN ('admin','staff'));

-- On approval: distribute amount starting from the requested share,
-- then overflow into subsequent in-progress shares in order.
CREATE OR REPLACE FUNCTION approve_deposit_request(p_request_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req        deposit_requests%ROWTYPE;
  v_share      equity_shares%ROWTYPE;
  v_remaining  DECIMAL(15,2);
  v_to_credit  DECIMAL(15,2);
  v_leftover   DECIMAL(15,2);
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin','staff') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT * INTO v_req FROM deposit_requests WHERE id = p_request_id;

  IF v_req.status != 'pending' THEN
    RAISE EXCEPTION 'Request is not pending';
  END IF;

  v_leftover := v_req.amount;

  -- Walk through in-progress shares starting from the requested share,
  -- then by share_number order for the same member.
  FOR v_share IN
    SELECT * FROM equity_shares
    WHERE user_id = v_req.user_id
      AND status = 'in_progress'
      AND (id = v_req.share_id OR share_number > (
            SELECT share_number FROM equity_shares WHERE id = v_req.share_id
          ))
    ORDER BY
      CASE WHEN id = v_req.share_id THEN 0 ELSE 1 END,
      share_number ASC
  LOOP
    EXIT WHEN v_leftover <= 0;

    v_remaining := v_share.target_amount - v_share.paid_amount;
    v_to_credit := LEAST(v_leftover, v_remaining);

    INSERT INTO equity_contributions (user_id, share_id, amount, payment_method, reference, recorded_by)
    VALUES (v_req.user_id, v_share.id, v_to_credit, v_req.payment_method, v_req.reference, auth.uid());

    v_leftover := v_leftover - v_to_credit;
  END LOOP;

  -- If any amount remains after all shares are full, credit it to the original share
  -- (this handles edge cases like no next share available)
  IF v_leftover > 0 THEN
    INSERT INTO equity_contributions (user_id, share_id, amount, payment_method, reference, recorded_by)
    VALUES (v_req.user_id, v_req.share_id, v_leftover, v_req.payment_method, v_req.reference, auth.uid());
  END IF;

  -- Mark request approved
  UPDATE deposit_requests
  SET status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
  WHERE id = p_request_id;
END;
$$;

GRANT EXECUTE ON FUNCTION approve_deposit_request(UUID) TO authenticated;

-- Reject function
CREATE OR REPLACE FUNCTION reject_deposit_request(p_request_id UUID, p_reason TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin','staff') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  UPDATE deposit_requests
  SET status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(),
      rejection_reason = p_reason, updated_at = now()
  WHERE id = p_request_id AND status = 'pending';
END;
$$;

GRANT EXECUTE ON FUNCTION reject_deposit_request(UUID, TEXT) TO authenticated;

-- STORAGE SETUP (run in Supabase dashboard or via CLI):
-- 1. Create a storage bucket named: deposit-receipts
-- 2. Set it to PUBLIC (so receipt URLs are accessible)
-- 3. Add RLS policy: authenticated users can upload to folder named after their user ID
--    Policy name: "Members can upload own receipts"
--    Allowed operation: INSERT
--    Policy: (bucket_id = 'deposit-receipts' AND auth.uid()::text = (storage.foldername(name))[1])


-- ============================================================
-- Migration: 11_membership_approval.sql
-- ============================================================

-- Allow staff/admin to manually set a member's membership status
-- Also ensures a membership_status record exists when a user is made a member

CREATE OR REPLACE FUNCTION admin_set_membership_status(
  p_user_id UUID,
  p_status VARCHAR,
  p_reason TEXT DEFAULT NULL
)
RETURNS VOID AS $$
DECLARE
  v_current_status VARCHAR;
BEGIN
  -- Verify caller is admin or staff
  IF get_user_role(auth.uid()) NOT IN ('admin', 'staff') THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  SELECT status INTO v_current_status
  FROM membership_status WHERE user_id = p_user_id;

  IF v_current_status IS NULL THEN
    INSERT INTO membership_status (user_id, status, completed_shares, reason, last_evaluated_at)
    VALUES (p_user_id, p_status, 0, p_reason, now());
  ELSE
    INSERT INTO membership_history (user_id, from_status, to_status, reason)
    VALUES (p_user_id, v_current_status, p_status, p_reason);

    UPDATE membership_status
    SET status = p_status,
        reason = p_reason,
        last_evaluated_at = now(),
        updated_at = now()
    WHERE user_id = p_user_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================================
-- Migration: 12_registration_pending.sql
-- ============================================================

-- Redefines handle_new_user() to include employee_id from metadata.
-- New users register as 'active' immediately (employee ID verification happens client-side).
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


-- ============================================================
-- Migration: 13_membership_history_improved.sql
-- ============================================================

-- Add changed_by tracking to membership_history
ALTER TABLE membership_history
  ADD COLUMN IF NOT EXISTS changed_by UUID REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS changed_by_name VARCHAR;

-- Update admin_set_membership_status:
-- 1. Record who made the change
-- 2. Only insert history when status actually changes
-- 3. Cannot set 'active' if member has 0 completed shares
CREATE OR REPLACE FUNCTION admin_set_membership_status(
  p_user_id UUID,
  p_status VARCHAR,
  p_reason TEXT DEFAULT NULL
)
RETURNS VOID AS $$
DECLARE
  v_current_status  VARCHAR;
  v_changer_name    VARCHAR;
  v_completed_shares INT;
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin', 'staff') THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  -- Enforce share requirement for active status
  SELECT COUNT(*) INTO v_completed_shares
  FROM equity_shares
  WHERE user_id = p_user_id AND status = 'completed';

  IF p_status = 'active' AND v_completed_shares = 0 THEN
    RAISE EXCEPTION 'Cannot approve membership: member has no completed equity shares';
  END IF;

  SELECT full_name INTO v_changer_name FROM profiles WHERE id = auth.uid();
  SELECT status INTO v_current_status FROM membership_status WHERE user_id = p_user_id;

  IF v_current_status IS NULL THEN
    INSERT INTO membership_status (user_id, status, completed_shares, reason, last_evaluated_at)
    VALUES (p_user_id, p_status, v_completed_shares, p_reason, now());

    INSERT INTO membership_history (user_id, from_status, to_status, reason, changed_by, changed_by_name)
    VALUES (p_user_id, NULL, p_status, p_reason, auth.uid(), v_changer_name);
  ELSIF v_current_status != p_status THEN
    INSERT INTO membership_history (user_id, from_status, to_status, reason, changed_by, changed_by_name)
    VALUES (p_user_id, v_current_status, p_status, p_reason, auth.uid(), v_changer_name);

    UPDATE membership_status
    SET status = p_status,
        completed_shares = v_completed_shares,
        reason = p_reason,
        last_evaluated_at = now(),
        updated_at = now()
    WHERE user_id = p_user_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================================
-- Migration: 14_branding_config.sql
-- ============================================================

-- Insert branding config keys if they don't already exist
INSERT INTO system_config (config_key, config_value, value_type, description)
VALUES
  ('app_name',    'CoopFinance',  'string', 'Name of the application shown in the sidebar and browser title'),
  ('app_vision',  '',             'string', 'Vision statement of the cooperative'),
  ('app_mission', '',             'string', 'Mission statement of the cooperative'),
  ('app_logo_url','',             'string', 'URL to the uploaded cooperative logo image')
ON CONFLICT (config_key) DO NOTHING;

-- Create branding storage bucket (public, so logo URLs work without auth)
INSERT INTO storage.buckets (id, name, public)
VALUES ('branding', 'branding', true)
ON CONFLICT (id) DO NOTHING;

-- Anyone authenticated can read branding assets (logo is public anyway)
CREATE POLICY "branding_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'branding');

-- Only admins can upload/update/delete branding assets
CREATE POLICY "branding_admin_insert"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'branding'
    AND get_user_role(auth.uid()) = 'admin'
  );

CREATE POLICY "branding_admin_update"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'branding'
    AND get_user_role(auth.uid()) = 'admin'
  );

CREATE POLICY "branding_admin_delete"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'branding'
    AND get_user_role(auth.uid()) = 'admin'
  );


-- ============================================================
-- Migration: 15_loan_eligibility.sql
-- ============================================================

-- Enforce that a member must have at least one completed equity share
-- before they can submit a loan application.

-- Drop the old open insert policy if it exists
DROP POLICY IF EXISTS loans_insert ON loan_applications;

-- New insert policy: member must have >= 1 completed share
CREATE POLICY loans_insert ON loan_applications FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND (
      SELECT COUNT(*) FROM equity_shares
      WHERE user_id = auth.uid() AND status = 'completed'
    ) > 0
  );


-- ============================================================
-- Migration: 16_loan_features.sql
-- ============================================================

-- ─── Co-makers table ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS loan_co_makers (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id    UUID NOT NULL REFERENCES loan_applications(id) ON DELETE CASCADE,
  co_maker_user_id  UUID NOT NULL REFERENCES profiles(id),
  created_at        TIMESTAMPTZ DEFAULT now(),
  UNIQUE(application_id, co_maker_user_id)
);

-- RLS
ALTER TABLE loan_co_makers ENABLE ROW LEVEL SECURITY;

-- Applicant can insert co-makers for their own application
CREATE POLICY co_makers_insert ON loan_co_makers FOR INSERT
  WITH CHECK (
    application_id IN (
      SELECT id FROM loan_applications WHERE user_id = auth.uid()
    )
  );

-- Co-maker can see records where they are listed; applicant can see their own
CREATE POLICY co_makers_select ON loan_co_makers FOR SELECT
  USING (
    co_maker_user_id = auth.uid()
    OR application_id IN (
      SELECT id FROM loan_applications WHERE user_id = auth.uid()
    )
  );

-- Admin/staff can see all
CREATE POLICY co_makers_admin ON loan_co_makers FOR ALL
  USING (get_user_role(auth.uid()) IN ('admin', 'staff'));

-- ─── New config keys ──────────────────────────────────────────────────────────
INSERT INTO system_config (config_key, config_value, value_type, description)
VALUES
  ('loan_ratio_new_member',    '1',  'number', 'Loan-to-equity ratio for new members (< tenure threshold)'),
  ('loan_ratio_senior_member', '3',  'number', 'Loan-to-equity ratio for senior members (>= tenure threshold)'),
  ('loan_ratio_tenure_months', '12', 'number', 'Months of membership before senior ratio applies'),
  ('loan_min_co_makers',       '1',  'number', 'Minimum number of co-makers required per loan application')
ON CONFLICT (config_key) DO NOTHING;

-- ─── Max 1 active loan: update the loan_applications insert policy ────────────
DROP POLICY IF EXISTS loans_insert ON loan_applications;

CREATE POLICY loans_insert ON loan_applications FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    -- Must have at least 1 completed share
    AND (
      SELECT COUNT(*) FROM equity_shares
      WHERE user_id = auth.uid() AND status = 'completed'
    ) > 0
    -- Must not have an active loan
    AND (
      SELECT COUNT(*) FROM loans
      WHERE user_id = auth.uid() AND status = 'active'
    ) = 0
    -- Must not have a pending/under-review application
    AND (
      SELECT COUNT(*) FROM loan_applications
      WHERE user_id = auth.uid() AND status IN ('submitted', 'under_review')
    ) = 0
  );

-- ─── Loan default → membership suspension trigger ────────────────────────────
CREATE OR REPLACE FUNCTION suspend_member_on_loan_default()
RETURNS TRIGGER AS $$
DECLARE
  v_current_status VARCHAR;
BEGIN
  IF NEW.status = 'defaulted' AND OLD.status != 'defaulted' THEN
    SELECT status INTO v_current_status
    FROM membership_status WHERE user_id = NEW.user_id;

    IF v_current_status IS NOT NULL AND v_current_status != 'suspended' THEN
      INSERT INTO membership_history (user_id, from_status, to_status, reason)
      VALUES (NEW.user_id, v_current_status, 'suspended', 'Automatic suspension due to loan default (loan ID: ' || NEW.id || ')');

      UPDATE membership_status
      SET status = 'suspended',
          reason = 'Loan defaulted',
          last_evaluated_at = now(),
          updated_at = now()
      WHERE user_id = NEW.user_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_loan_default ON loans;
CREATE TRIGGER trg_loan_default
  AFTER UPDATE OF status ON loans
  FOR EACH ROW
  EXECUTE FUNCTION suspend_member_on_loan_default();

-- ─── Function: get eligible co-makers for the current user ───────────────────
CREATE OR REPLACE FUNCTION get_eligible_co_makers()
RETURNS TABLE(id UUID, full_name VARCHAR) AS $$
BEGIN
  RETURN QUERY
  SELECT p.id, p.full_name
  FROM profiles p
  JOIN membership_status ms ON ms.user_id = p.id
  WHERE p.id != auth.uid()
    AND p.role = 'member'
    AND p.account_status = 'active'
    AND ms.status = 'active'
    -- Must not have an active loan
    AND NOT EXISTS (
      SELECT 1 FROM loans l
      WHERE l.user_id = p.id AND l.status = 'active'
    )
    -- Must not already be a co-maker on an active/pending application
    AND NOT EXISTS (
      SELECT 1 FROM loan_co_makers lcm
      JOIN loan_applications la ON la.id = lcm.application_id
      WHERE lcm.co_maker_user_id = p.id
        AND la.status IN ('submitted', 'under_review', 'approved')
    )
  ORDER BY p.full_name;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================================
-- Migration: 17_co_maker_confirmation.sql
-- ============================================================

-- Add status tracking to loan_co_makers
ALTER TABLE loan_co_makers
  ADD COLUMN IF NOT EXISTS status VARCHAR CHECK (status IN ('pending', 'confirmed', 'declined')) NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS responded_at TIMESTAMPTZ;

-- Allow co-maker to update their own status
CREATE POLICY co_makers_respond ON loan_co_makers FOR UPDATE
  USING (co_maker_user_id = auth.uid())
  WITH CHECK (co_maker_user_id = auth.uid());

-- RPC: co-maker responds to their request
CREATE OR REPLACE FUNCTION respond_to_co_maker_request(
  p_application_id UUID,
  p_status         VARCHAR
)
RETURNS VOID AS $$
BEGIN
  IF p_status NOT IN ('confirmed', 'declined') THEN
    RAISE EXCEPTION 'Invalid status: must be confirmed or declined';
  END IF;

  UPDATE loan_co_makers
  SET status = p_status, responded_at = now()
  WHERE application_id = p_application_id
    AND co_maker_user_id = auth.uid();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Co-maker request not found';
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RPC: fetch co-maker requests for the current user (with applicant details)
CREATE OR REPLACE FUNCTION get_my_co_maker_requests()
RETURNS TABLE(
  id               UUID,
  application_id   UUID,
  status           VARCHAR,
  responded_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ,
  applicant_name   VARCHAR,
  amount_requested DECIMAL,
  term_months      INT,
  purpose          TEXT,
  application_status VARCHAR
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    lcm.id,
    lcm.application_id,
    lcm.status,
    lcm.responded_at,
    lcm.created_at,
    p.full_name AS applicant_name,
    la.amount_requested,
    la.term_months,
    la.purpose,
    la.status AS application_status
  FROM loan_co_makers lcm
  JOIN loan_applications la ON la.id = lcm.application_id
  JOIN profiles p ON p.id = la.user_id
  WHERE lcm.co_maker_user_id = auth.uid()
  ORDER BY lcm.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================================
-- Migration: 18_loan_approval.sql
-- ============================================================

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


-- ============================================================
-- Migration: 19_draft_flow.sql
-- ============================================================

-- Change loan application flow:
-- Member submits → status = 'draft' (waiting for co-makers)
-- All co-makers confirm → auto-transition to 'submitted' (goes to admin)
-- If any co-maker declines → stays 'draft', applicant must resolve

-- Update respond_to_co_maker_request to auto-submit when all co-makers confirm
CREATE OR REPLACE FUNCTION respond_to_co_maker_request(
  p_application_id UUID,
  p_status         VARCHAR
)
RETURNS VOID AS $$
DECLARE
  v_remaining_pending INT;
BEGIN
  IF p_status NOT IN ('confirmed', 'declined') THEN
    RAISE EXCEPTION 'Invalid status: must be confirmed or declined';
  END IF;

  UPDATE loan_co_makers
  SET status = p_status, responded_at = now()
  WHERE application_id = p_application_id
    AND co_maker_user_id = auth.uid();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Co-maker request not found';
  END IF;

  -- If all co-makers have confirmed, auto-transition draft → submitted
  IF p_status = 'confirmed' THEN
    SELECT COUNT(*) INTO v_remaining_pending
    FROM loan_co_makers
    WHERE application_id = p_application_id AND status != 'confirmed';

    IF v_remaining_pending = 0 THEN
      UPDATE loan_applications
      SET status = 'submitted', updated_at = now()
      WHERE id = p_application_id AND status = 'draft';
    END IF;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update loans_insert RLS: also block if a draft application exists
DROP POLICY IF EXISTS loans_insert ON loan_applications;

CREATE POLICY loans_insert ON loan_applications FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND (
      SELECT COUNT(*) FROM equity_shares
      WHERE user_id = auth.uid() AND status = 'completed'
    ) > 0
    AND (
      SELECT COUNT(*) FROM loans
      WHERE user_id = auth.uid() AND status = 'active'
    ) = 0
    AND (
      SELECT COUNT(*) FROM loan_applications
      WHERE user_id = auth.uid()
        AND status IN ('draft', 'submitted', 'under_review')
    ) = 0
  );

-- Function so applicant can see their co-makers' names + status
-- (needed because RLS blocks members from reading other profiles)
CREATE OR REPLACE FUNCTION get_my_application_co_makers()
RETURNS TABLE(
  application_id   UUID,
  co_maker_user_id UUID,
  full_name        VARCHAR,
  status           VARCHAR,
  responded_at     TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    lcm.application_id,
    lcm.co_maker_user_id,
    p.full_name,
    lcm.status,
    lcm.responded_at
  FROM loan_co_makers lcm
  JOIN loan_applications la ON la.id = lcm.application_id
  JOIN profiles p ON p.id = lcm.co_maker_user_id
  WHERE la.user_id = auth.uid()
  ORDER BY lcm.created_at;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================================
-- Migration: 20_co_maker_shares_required.sql
-- ============================================================

-- Co-makers must also have at least one completed equity share to be eligible

CREATE OR REPLACE FUNCTION get_eligible_co_makers()
RETURNS TABLE(id UUID, full_name VARCHAR) AS $$
BEGIN
  RETURN QUERY
  SELECT p.id, p.full_name
  FROM profiles p
  JOIN membership_status ms ON ms.user_id = p.id
  WHERE p.id != auth.uid()
    AND p.role = 'member'
    AND p.account_status = 'active'
    AND ms.status = 'active'
    -- Must have at least one completed equity share
    AND EXISTS (
      SELECT 1 FROM equity_shares es
      WHERE es.user_id = p.id AND es.status = 'completed'
    )
    -- Must not have an active loan
    AND NOT EXISTS (
      SELECT 1 FROM loans l
      WHERE l.user_id = p.id AND l.status = 'active'
    )
    -- Must not already be a co-maker on an active/pending application
    AND NOT EXISTS (
      SELECT 1 FROM loan_co_makers lcm
      JOIN loan_applications la ON la.id = lcm.application_id
      WHERE lcm.co_maker_user_id = p.id
        AND la.status IN ('draft', 'submitted', 'under_review')
    )
  ORDER BY p.full_name;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================================
-- Migration: 21_deposit_overflow.sql
-- ============================================================

-- Fix approve_deposit_request: auto-create next share for overflow
-- instead of over-crediting the original share when no next share exists.

CREATE OR REPLACE FUNCTION approve_deposit_request(p_request_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req          deposit_requests%ROWTYPE;
  v_share        equity_shares%ROWTYPE;
  v_remaining    DECIMAL(15,2);
  v_to_credit    DECIMAL(15,2);
  v_leftover     DECIMAL(15,2);
  v_share_price  DECIMAL(15,2);
  v_max_shares   INT;
  v_share_count  INT;
  v_next_number  INT;
  v_new_share_id UUID;
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin','staff') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT * INTO v_req FROM deposit_requests WHERE id = p_request_id;

  IF v_req.status != 'pending' THEN
    RAISE EXCEPTION 'Request is not pending';
  END IF;

  v_leftover := v_req.amount;

  -- Walk through existing in-progress shares starting from the requested one
  FOR v_share IN
    SELECT * FROM equity_shares
    WHERE user_id = v_req.user_id
      AND status = 'in_progress'
      AND (id = v_req.share_id OR share_number > (
            SELECT share_number FROM equity_shares WHERE id = v_req.share_id
          ))
    ORDER BY
      CASE WHEN id = v_req.share_id THEN 0 ELSE 1 END,
      share_number ASC
  LOOP
    EXIT WHEN v_leftover <= 0;

    v_remaining := v_share.target_amount - v_share.paid_amount;
    v_to_credit := LEAST(v_leftover, v_remaining);

    INSERT INTO equity_contributions (user_id, share_id, amount, payment_method, reference, recorded_by)
    VALUES (v_req.user_id, v_share.id, v_to_credit, v_req.payment_method, v_req.reference, auth.uid());

    v_leftover := v_leftover - v_to_credit;
  END LOOP;

  -- If leftover remains, auto-open new shares and credit them
  IF v_leftover > 0 THEN
    -- Read config
    SELECT config_value::DECIMAL INTO v_share_price
    FROM system_config WHERE config_key = 'share_price';

    SELECT config_value::INT INTO v_max_shares
    FROM system_config WHERE config_key = 'max_shares_per_member';

    v_share_price := COALESCE(v_share_price, 5000);
    v_max_shares  := COALESCE(v_max_shares, 10);

    LOOP
      EXIT WHEN v_leftover <= 0;

      -- Count non-cancelled shares
      SELECT COUNT(*) INTO v_share_count
      FROM equity_shares
      WHERE user_id = v_req.user_id AND status != 'cancelled';

      EXIT WHEN v_share_count >= v_max_shares;

      -- Next share number
      SELECT COALESCE(MAX(share_number), 0) + 1 INTO v_next_number
      FROM equity_shares WHERE user_id = v_req.user_id;

      -- Create new share
      INSERT INTO equity_shares (user_id, share_number, target_amount)
      VALUES (v_req.user_id, v_next_number, v_share_price)
      RETURNING id INTO v_new_share_id;

      v_to_credit := LEAST(v_leftover, v_share_price);

      INSERT INTO equity_contributions (user_id, share_id, amount, payment_method, reference, recorded_by)
      VALUES (v_req.user_id, v_new_share_id, v_to_credit, v_req.payment_method, v_req.reference, auth.uid());

      v_leftover := v_leftover - v_to_credit;
    END LOOP;

    -- If still leftover (max shares reached), credit back to original share
    -- This records the excess so accounting doesn't lose the amount.
    IF v_leftover > 0 THEN
      INSERT INTO equity_contributions (user_id, share_id, amount, payment_method, reference, recorded_by)
      VALUES (v_req.user_id, v_req.share_id, v_leftover, v_req.payment_method, v_req.reference, auth.uid());
    END IF;
  END IF;

  -- Mark request approved
  UPDATE deposit_requests
  SET status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
  WHERE id = p_request_id;
END;
$$;

GRANT EXECUTE ON FUNCTION approve_deposit_request(UUID) TO authenticated;


-- ============================================================
-- Migration: 22_indexes_and_constraints.sql
-- ============================================================

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


-- ============================================================
-- Migration: 23_contribution_request_id.sql
-- ============================================================

-- Add deposit_request_id FK to equity_contributions so receipts are directly linked

ALTER TABLE equity_contributions
  ADD COLUMN IF NOT EXISTS deposit_request_id UUID REFERENCES deposit_requests(id);

-- Backfill existing rows: match approved requests to contributions by
-- user_id + share_id + amount + reviewed_at within 5 minutes of contribution_at
UPDATE equity_contributions ec
SET deposit_request_id = dr.id
FROM deposit_requests dr
WHERE dr.status = 'approved'
  AND dr.user_id = ec.user_id
  AND dr.share_id = ec.share_id
  AND ABS(EXTRACT(EPOCH FROM (ec.contribution_at - dr.reviewed_at))) < 300
  AND ec.deposit_request_id IS NULL;

-- For overflow contributions (different share_id), match by user_id + date only
UPDATE equity_contributions ec
SET deposit_request_id = dr.id
FROM deposit_requests dr
WHERE dr.status = 'approved'
  AND dr.user_id = ec.user_id
  AND ABS(EXTRACT(EPOCH FROM (ec.contribution_at - dr.reviewed_at))) < 300
  AND ec.deposit_request_id IS NULL;

-- Replace approve_deposit_request to populate deposit_request_id on new contributions
CREATE OR REPLACE FUNCTION approve_deposit_request(p_request_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req          deposit_requests%ROWTYPE;
  v_share        equity_shares%ROWTYPE;
  v_remaining    DECIMAL(15,2);
  v_to_credit    DECIMAL(15,2);
  v_leftover     DECIMAL(15,2);
  v_share_price  DECIMAL(15,2);
  v_max_shares   INT;
  v_share_count  INT;
  v_next_number  INT;
  v_new_share_id UUID;
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin','staff') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT * INTO v_req FROM deposit_requests WHERE id = p_request_id;

  IF v_req.status != 'pending' THEN
    RAISE EXCEPTION 'Request is not pending';
  END IF;

  v_leftover := v_req.amount;

  -- Walk through existing in-progress shares starting from the requested one
  FOR v_share IN
    SELECT * FROM equity_shares
    WHERE user_id = v_req.user_id
      AND status = 'in_progress'
      AND (id = v_req.share_id OR share_number > (
            SELECT share_number FROM equity_shares WHERE id = v_req.share_id
          ))
    ORDER BY
      CASE WHEN id = v_req.share_id THEN 0 ELSE 1 END,
      share_number ASC
  LOOP
    EXIT WHEN v_leftover <= 0;

    v_remaining := v_share.target_amount - v_share.paid_amount;
    v_to_credit := LEAST(v_leftover, v_remaining);

    INSERT INTO equity_contributions (user_id, share_id, deposit_request_id, amount, payment_method, reference, recorded_by)
    VALUES (v_req.user_id, v_share.id, p_request_id, v_to_credit, v_req.payment_method, v_req.reference, auth.uid());

    v_leftover := v_leftover - v_to_credit;
  END LOOP;

  -- If leftover remains, auto-open new shares and credit them
  IF v_leftover > 0 THEN
    SELECT config_value::DECIMAL INTO v_share_price
    FROM system_config WHERE config_key = 'share_price';

    SELECT config_value::INT INTO v_max_shares
    FROM system_config WHERE config_key = 'max_shares_per_member';

    v_share_price := COALESCE(v_share_price, 5000);
    v_max_shares  := COALESCE(v_max_shares, 10);

    LOOP
      EXIT WHEN v_leftover <= 0;

      SELECT COUNT(*) INTO v_share_count
      FROM equity_shares
      WHERE user_id = v_req.user_id AND status != 'cancelled';

      EXIT WHEN v_share_count >= v_max_shares;

      SELECT COALESCE(MAX(share_number), 0) + 1 INTO v_next_number
      FROM equity_shares WHERE user_id = v_req.user_id;

      INSERT INTO equity_shares (user_id, share_number, target_amount)
      VALUES (v_req.user_id, v_next_number, v_share_price)
      RETURNING id INTO v_new_share_id;

      v_to_credit := LEAST(v_leftover, v_share_price);

      INSERT INTO equity_contributions (user_id, share_id, deposit_request_id, amount, payment_method, reference, recorded_by)
      VALUES (v_req.user_id, v_new_share_id, p_request_id, v_to_credit, v_req.payment_method, v_req.reference, auth.uid());

      v_leftover := v_leftover - v_to_credit;
    END LOOP;

    IF v_leftover > 0 THEN
      INSERT INTO equity_contributions (user_id, share_id, deposit_request_id, amount, payment_method, reference, recorded_by)
      VALUES (v_req.user_id, v_req.share_id, p_request_id, v_leftover, v_req.payment_method, v_req.reference, auth.uid());
    END IF;
  END IF;

  UPDATE deposit_requests
  SET status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
  WHERE id = p_request_id;
END;
$$;

GRANT EXECUTE ON FUNCTION approve_deposit_request(UUID) TO authenticated;


-- ============================================================
-- Migration: 24_soft_delete_users.sql
-- ============================================================

-- Soft delete for profiles: instead of hard-deleting, set deleted_at
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

-- RPC for admin to soft-delete a user
CREATE OR REPLACE FUNCTION admin_soft_delete_user(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF get_user_role(auth.uid()) != 'admin' THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  UPDATE profiles
  SET deleted_at = now(), updated_at = now()
  WHERE id = p_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_soft_delete_user(UUID) TO authenticated;

-- RPC to restore a soft-deleted user
CREATE OR REPLACE FUNCTION admin_restore_user(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF get_user_role(auth.uid()) != 'admin' THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  UPDATE profiles
  SET deleted_at = NULL, updated_at = now()
  WHERE id = p_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_restore_user(UUID) TO authenticated;


-- ============================================================
-- Migration: 25_loan_products.sql
-- ============================================================

-- Loan Products table
-- Admins define reusable loan product templates; members select one when applying.
-- Also adds loan_product_id FK to loan_applications.

CREATE TABLE IF NOT EXISTS loan_products (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                text NOT NULL,
  description         text,
  interest_rate       numeric(5, 2) NOT NULL,
  min_amount          numeric(12, 2) NOT NULL DEFAULT 0,
  max_amount          numeric(12, 2),
  min_term_months     int NOT NULL DEFAULT 1,
  max_term_months     int NOT NULL DEFAULT 36,
  calculation_method  text NOT NULL DEFAULT 'reducing_balance'
                        CHECK (calculation_method IN ('flat', 'reducing_balance')),
  is_active           boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid REFERENCES auth.users (id)
);

-- Row-level security
ALTER TABLE loan_products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "loan_products_select" ON loan_products;
DROP POLICY IF EXISTS "loan_products_insert" ON loan_products;
DROP POLICY IF EXISTS "loan_products_update" ON loan_products;
DROP POLICY IF EXISTS "loan_products_delete" ON loan_products;

-- All authenticated users can read active products (members need this to apply)
CREATE POLICY "loan_products_select"
  ON loan_products FOR SELECT
  TO authenticated
  USING (
    is_active = true
    OR get_user_role(auth.uid()) IN ('admin', 'staff')
  );

-- Only admin / staff can insert
CREATE POLICY "loan_products_insert"
  ON loan_products FOR INSERT
  TO authenticated
  WITH CHECK (get_user_role(auth.uid()) IN ('admin', 'staff'));

-- Only admin / staff can update (e.g. toggle active, edit details)
CREATE POLICY "loan_products_update"
  ON loan_products FOR UPDATE
  TO authenticated
  USING (get_user_role(auth.uid()) IN ('admin', 'staff'));

-- Only admin can delete
CREATE POLICY "loan_products_delete"
  ON loan_products FOR DELETE
  TO authenticated
  USING (get_user_role(auth.uid()) = 'admin');

-- Add loan_product_id to loan_applications
ALTER TABLE loan_applications
  ADD COLUMN IF NOT EXISTS loan_product_id uuid REFERENCES loan_products (id);


-- ============================================================
-- Migration: 26_loan_products_v2.sql
-- ============================================================

-- Extend loan_products with interest period, equal_principal method, and fee columns

-- Allow equal_principal as a calculation method
ALTER TABLE loan_products DROP CONSTRAINT IF EXISTS loan_products_calculation_method_check;
ALTER TABLE loan_products ADD CONSTRAINT loan_products_calculation_method_check
  CHECK (calculation_method IN ('flat', 'reducing_balance', 'equal_principal'));

-- Interest rate period (monthly or annual)
ALTER TABLE loan_products
  ADD COLUMN IF NOT EXISTS interest_rate_period TEXT NOT NULL DEFAULT 'annual'
    CHECK (interest_rate_period IN ('monthly', 'annual'));

-- Fee columns
ALTER TABLE loan_products
  ADD COLUMN IF NOT EXISTS processing_fee_type TEXT CHECK (processing_fee_type IN ('fixed', 'percentage')),
  ADD COLUMN IF NOT EXISTS processing_fee_value NUMERIC,
  ADD COLUMN IF NOT EXISTS insurance_type TEXT CHECK (insurance_type IN ('fixed', 'percentage')),
  ADD COLUMN IF NOT EXISTS insurance_value NUMERIC,
  ADD COLUMN IF NOT EXISTS service_fee_type TEXT CHECK (service_fee_type IN ('fixed', 'percentage')),
  ADD COLUMN IF NOT EXISTS service_fee_value NUMERIC,
  ADD COLUMN IF NOT EXISTS cbu_type TEXT CHECK (cbu_type IN ('fixed', 'percentage')),
  ADD COLUMN IF NOT EXISTS cbu_value NUMERIC;


-- ============================================================
-- Migration: 27_public_branding_config.sql
-- ============================================================

-- Allow unauthenticated (anon) users to read branding config keys.
-- Needed so the login/register pages can display the app name and logo
-- before a session exists.
CREATE POLICY config_public_branding ON system_config
  FOR SELECT
  USING (config_key IN ('app_name', 'app_logo_url'));


-- ============================================================
-- Migration: 28_loan_approval_v2.sql
-- ============================================================

-- Fix loan approval to use the selected loan product's settings
-- (interest_rate, calculation_method, interest_rate_period) instead of global system_config.
-- Also handles monthly vs annual interest rate period introduced in 26_loan_products_v2.sql.
CREATE OR REPLACE FUNCTION admin_approve_loan_application(p_application_id UUID)
RETURNS UUID AS $$
DECLARE
  v_app             loan_applications%ROWTYPE;
  v_product         loan_products%ROWTYPE;
  v_loan_id         UUID;
  v_interest_rate   DECIMAL;
  v_calc_method     VARCHAR;
  v_rate_period     VARCHAR;
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

  -- Read from loan product if set, otherwise fall back to system_config globals
  IF v_app.loan_product_id IS NOT NULL THEN
    SELECT * INTO v_product FROM loan_products WHERE id = v_app.loan_product_id;
    v_interest_rate := v_product.interest_rate;
    v_calc_method   := v_product.calculation_method;
    v_rate_period   := COALESCE(v_product.interest_rate_period, 'annual');
  ELSE
    SELECT COALESCE(config_value::DECIMAL, 12) INTO v_interest_rate
      FROM system_config WHERE config_key = 'loan_interest_rate';
    SELECT COALESCE(config_value, 'reducing_balance') INTO v_calc_method
      FROM system_config WHERE config_key = 'interest_calculation_method';
    v_rate_period := 'annual';
  END IF;

  -- Convert rate to a monthly decimal (v_r)
  -- annual: 12% annual → 0.01/month; monthly: 1% monthly → 0.01/month
  IF v_rate_period = 'monthly' THEN
    v_r := v_interest_rate / 100.0;
  ELSE
    v_r := v_interest_rate / 100.0 / 12.0;
  END IF;

  -- Calculate schedule
  IF v_calc_method = 'flat' THEN
    -- Flat: interest on original principal for the full term
    v_total_repayable := v_app.amount_requested
      + (v_app.amount_requested * v_r * v_app.term_months);
    v_emi := v_total_repayable / v_app.term_months;
  ELSE
    -- Reducing balance (standard EMI formula)
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

  -- Create loan record
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
      v_interest_pay  := ROUND(v_app.amount_requested * v_r, 2);
      v_principal_pay := ROUND(v_app.amount_requested / v_app.term_months, 2);
    ELSE
      v_interest_pay  := ROUND(v_outstanding * v_r, 2);
      IF i = v_app.term_months THEN
        -- Last installment: clear remaining balance to avoid rounding drift
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


-- ============================================================
-- Migration: 29_admin_audit_log.sql
-- ============================================================

-- Admin audit log: records admin actions such as impersonation start/end,
-- bulk approvals, config changes, etc.
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id        UUID NOT NULL REFERENCES auth.users(id),
  action          TEXT NOT NULL,
  target_user_id  UUID REFERENCES auth.users(id),
  metadata        JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_admin    ON admin_audit_log(admin_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_target   ON admin_audit_log(target_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_action   ON admin_audit_log(action, created_at DESC);

ALTER TABLE admin_audit_log ENABLE ROW LEVEL SECURITY;

-- Only admin can read the audit log
CREATE POLICY audit_log_admin_read ON admin_audit_log
  FOR SELECT
  USING (get_user_role(auth.uid()) = 'admin');

-- RPC used by the frontend to write audit log entries.
-- Accepts any action string so it can be reused for future admin actions
-- beyond impersonation.
CREATE OR REPLACE FUNCTION log_admin_action(
  p_action          TEXT,
  p_target_user_id  UUID    DEFAULT NULL,
  p_metadata        JSONB   DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin', 'staff') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  INSERT INTO admin_audit_log (admin_id, action, target_user_id, metadata)
  VALUES (auth.uid(), p_action, p_target_user_id, p_metadata)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION log_admin_action(TEXT, UUID, JSONB) TO authenticated;


-- ============================================================
-- Migration: 30_employee_id_check.sql
-- ============================================================

-- Allows unauthenticated users (the register page) to check whether an
-- employee_id is already taken without exposing any profile data.
-- Returns TRUE if the employee_id is available, FALSE if already registered.
CREATE OR REPLACE FUNCTION is_employee_id_available(p_employee_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM profiles WHERE employee_id = p_employee_id
  );
$$;

-- Allow the anon role to call this function (needed on the register page)
GRANT EXECUTE ON FUNCTION is_employee_id_available(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION is_employee_id_available(TEXT) TO authenticated;


-- ============================================================
-- Migration: 31_restructure_loan.sql
-- ============================================================

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


-- ============================================================
-- Migration: 32_role_permissions.sql
-- ============================================================

-- Role-based permission matrix.
-- Admin can configure which features staff and member roles can access.
-- Admin always has full access (enforced in the app layer).

CREATE TABLE IF NOT EXISTS role_permissions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role           TEXT NOT NULL CHECK (role IN ('staff', 'member')),
  permission_key TEXT NOT NULL,
  enabled        BOOLEAN NOT NULL DEFAULT false,
  updated_by     UUID REFERENCES auth.users(id),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(role, permission_key)
);

ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read (needed for UI gating)
CREATE POLICY role_permissions_read ON role_permissions
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- Only admin can write
CREATE POLICY role_permissions_admin_write ON role_permissions
  FOR ALL USING (get_user_role(auth.uid()) = 'admin');

-- Seed defaults
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


-- ============================================================
-- Migration: 33_safe_delete_share.sql
-- ============================================================

-- Safe share deletion: block if any deposit_requests are pending or approved.
-- This prevents money from being lost when a share is removed.

CREATE OR REPLACE FUNCTION admin_delete_share(p_share_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT;
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin', 'staff') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  -- Block deletion if any deposit is pending or approved against this share
  SELECT COUNT(*) INTO v_count
  FROM deposit_requests
  WHERE share_id = p_share_id
    AND status IN ('pending', 'approved');

  IF v_count > 0 THEN
    RAISE EXCEPTION 'This share has % deposit request(s) that are pending or approved and cannot be removed.', v_count;
  END IF;

  -- Also block if paid_amount > 0 (extra safety)
  IF EXISTS (SELECT 1 FROM equity_shares WHERE id = p_share_id AND paid_amount > 0) THEN
    RAISE EXCEPTION 'This share has recorded contributions and cannot be removed.';
  END IF;

  DELETE FROM equity_shares WHERE id = p_share_id;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_delete_share(UUID) TO authenticated;


-- ============================================================
-- Migration: 34_profile_completion.sql
-- ============================================================

-- Profile completion: additional fields for member identity verification

-- 1. Add new columns to profiles
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS avatar_url        TEXT,
  ADD COLUMN IF NOT EXISTS date_of_birth     DATE,
  ADD COLUMN IF NOT EXISTS address           TEXT,
  ADD COLUMN IF NOT EXISTS civil_status      VARCHAR(20)
    CHECK (civil_status IN ('single','married','widowed','separated','divorced')),
  ADD COLUMN IF NOT EXISTS emergency_contact_name  VARCHAR(255),
  ADD COLUMN IF NOT EXISTS emergency_contact_phone VARCHAR(50),
  ADD COLUMN IF NOT EXISTS profile_completed_at    TIMESTAMPTZ;

-- 2. Allow members (and all authenticated users) to update their own profile row
-- The existing RLS on profiles may only allow reads. Add a self-update policy.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'profiles'
      AND policyname = 'profiles_self_update'
  ) THEN
    CREATE POLICY profiles_self_update ON profiles
      FOR UPDATE
      USING (id = auth.uid())
      WITH CHECK (id = auth.uid());
  END IF;
END$$;

-- 3. Avatars storage bucket (idempotent)
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload/update their own avatar
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'avatars_upload'
  ) THEN
    CREATE POLICY avatars_upload ON storage.objects
      FOR INSERT TO authenticated
      WITH CHECK (
        bucket_id = 'avatars'
        AND (storage.foldername(name))[1] = auth.uid()::text
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'avatars_update'
  ) THEN
    CREATE POLICY avatars_update ON storage.objects
      FOR UPDATE TO authenticated
      USING (
        bucket_id = 'avatars'
        AND (storage.foldername(name))[1] = auth.uid()::text
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'avatars_public_read'
  ) THEN
    CREATE POLICY avatars_public_read ON storage.objects
      FOR SELECT TO public
      USING (bucket_id = 'avatars');
  END IF;
END$$;

-- 4. Update get_all_users_for_admin to include profile_completed_at
DROP FUNCTION IF EXISTS get_all_users_for_admin();
CREATE OR REPLACE FUNCTION get_all_users_for_admin()
RETURNS TABLE (
  id                   UUID,
  full_name            VARCHAR,
  phone                VARCHAR,
  role                 VARCHAR,
  account_status       VARCHAR,
  email                VARCHAR,
  membership_status    VARCHAR,
  completed_shares     INT,
  created_at           TIMESTAMPTZ,
  profile_completed_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin', 'staff') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.full_name,
    p.phone,
    p.role,
    p.account_status,
    u.email::VARCHAR,
    ms.status::VARCHAR       AS membership_status,
    ms.completed_shares,
    p.created_at,
    p.profile_completed_at
  FROM profiles p
  LEFT JOIN auth.users u ON u.id = p.id
  LEFT JOIN membership_status ms ON ms.user_id = p.id
  WHERE p.deleted_at IS NULL
  ORDER BY p.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION get_all_users_for_admin() TO authenticated;

-- 5. New RPC: get a single user's full profile for admin/staff view
CREATE OR REPLACE FUNCTION get_user_for_admin(p_user_id UUID)
RETURNS TABLE (
  id                       UUID,
  full_name                VARCHAR,
  phone                    VARCHAR,
  role                     VARCHAR,
  account_status           VARCHAR,
  email                    VARCHAR,
  employee_id              VARCHAR,
  avatar_url               TEXT,
  date_of_birth            DATE,
  address                  TEXT,
  civil_status             VARCHAR,
  emergency_contact_name   VARCHAR,
  emergency_contact_phone  VARCHAR,
  profile_completed_at     TIMESTAMPTZ,
  membership_status        VARCHAR,
  completed_shares         INT,
  created_at               TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin', 'staff') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.full_name,
    p.phone,
    p.role,
    p.account_status,
    u.email::VARCHAR,
    p.employee_id,
    p.avatar_url,
    p.date_of_birth,
    p.address,
    p.civil_status,
    p.emergency_contact_name,
    p.emergency_contact_phone,
    p.profile_completed_at,
    ms.status::VARCHAR       AS membership_status,
    ms.completed_shares,
    p.created_at
  FROM profiles p
  LEFT JOIN auth.users u ON u.id = p.id
  LEFT JOIN membership_status ms ON ms.user_id = p.id
  WHERE p.id = p_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION get_user_for_admin(UUID) TO authenticated;


-- ============================================================
-- Migration: 35_deposit_reference_unique.sql
-- ============================================================

-- ─── Unique deposit reference numbers ────────────────────────────────────────
-- Prevent the same transaction reference from being submitted more than once.
-- NULL and empty-string references are excluded (reference is optional).

-- Step 1: Clear the reference on duplicate rows, keeping only the earliest
-- submission per reference value. This handles any existing duplicates so the
-- unique index can be created cleanly.
UPDATE deposit_requests AS dr
SET reference = NULL
WHERE reference IS NOT NULL
  AND reference <> ''
  AND id NOT IN (
    -- Keep the oldest row for each reference value
    SELECT DISTINCT ON (reference) id
    FROM deposit_requests
    WHERE reference IS NOT NULL AND reference <> ''
    ORDER BY reference, created_at ASC
  );

-- Step 2: Create the partial unique index (NULLs and empty strings are excluded)
CREATE UNIQUE INDEX IF NOT EXISTS idx_deposit_requests_reference_unique
  ON deposit_requests(reference)
  WHERE reference IS NOT NULL AND reference <> '';


-- ============================================================
-- Migration: 36_batch_deposits.sql
-- ============================================================

-- Add collector role
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('admin', 'member', 'staff', 'collector'));

-- Batch deposit: one receipt covering multiple members
CREATE TABLE IF NOT EXISTS batch_deposits (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference      VARCHAR,
  payment_method VARCHAR CHECK (payment_method IN ('cash','bank_transfer','mobile_money')) NOT NULL,
  receipt_url    VARCHAR,
  notes          TEXT,
  total_amount   DECIMAL(15,2) NOT NULL CHECK (total_amount > 0),
  status         VARCHAR CHECK (status IN ('pending','approved','rejected')) NOT NULL DEFAULT 'pending',
  submitted_by   UUID NOT NULL REFERENCES profiles(id),
  reviewed_by    UUID REFERENCES profiles(id),
  reviewed_at    TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at     TIMESTAMPTZ DEFAULT now(),
  updated_at     TIMESTAMPTZ DEFAULT now()
);

-- Individual member entries within a batch
CREATE TABLE IF NOT EXISTS batch_deposit_items (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id           UUID NOT NULL REFERENCES batch_deposits(id) ON DELETE CASCADE,
  user_id            UUID NOT NULL REFERENCES profiles(id),
  amount             DECIMAL(15,2) NOT NULL CHECK (amount > 0),
  deposit_request_id UUID REFERENCES deposit_requests(id),
  created_at         TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE batch_deposits ENABLE ROW LEVEL SECURITY;
ALTER TABLE batch_deposit_items ENABLE ROW LEVEL SECURITY;

-- Collectors/members see their own submitted batches
CREATE POLICY batch_deposits_submitter ON batch_deposits
  FOR ALL USING (submitted_by = auth.uid());

-- Admin/staff see all batches
CREATE POLICY batch_deposits_admin ON batch_deposits
  FOR ALL USING (get_user_role(auth.uid()) IN ('admin','staff'));

-- Items: follow the batch for submitter
CREATE POLICY batch_deposit_items_submitter ON batch_deposit_items
  FOR ALL USING (
    batch_id IN (SELECT id FROM batch_deposits WHERE submitted_by = auth.uid())
  );

-- Items: admin/staff see all
CREATE POLICY batch_deposit_items_admin ON batch_deposit_items
  FOR ALL USING (get_user_role(auth.uid()) IN ('admin','staff'));

-- Items: members can see items where they are the beneficiary
CREATE POLICY batch_deposit_items_member ON batch_deposit_items
  FOR SELECT USING (user_id = auth.uid());

-- Also allow collector role to access deposit_requests (read own)
CREATE POLICY deposit_requests_collector ON deposit_requests
  FOR SELECT USING (
    get_user_role(auth.uid()) = 'collector' AND user_id = auth.uid()
  );

-- Approve batch: creates + approves a deposit_request per item
CREATE OR REPLACE FUNCTION approve_batch_deposit(p_batch_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch  batch_deposits%ROWTYPE;
  v_item   batch_deposit_items%ROWTYPE;
  v_share_id UUID;
  v_request_id UUID;
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin','staff') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT * INTO v_batch FROM batch_deposits WHERE id = p_batch_id;

  IF v_batch.status != 'pending' THEN
    RAISE EXCEPTION 'Batch is not pending';
  END IF;

  FOR v_item IN
    SELECT * FROM batch_deposit_items WHERE batch_id = p_batch_id
  LOOP
    -- Find member's first in-progress share
    SELECT id INTO v_share_id
    FROM equity_shares
    WHERE user_id = v_item.user_id AND status = 'in_progress'
    ORDER BY share_number ASC
    LIMIT 1;

    IF v_share_id IS NULL THEN
      RAISE EXCEPTION 'Member % has no active equity share', v_item.user_id;
    END IF;

    -- Create the deposit request
    INSERT INTO deposit_requests (user_id, share_id, amount, payment_method, reference, receipt_url, notes, status)
    VALUES (
      v_item.user_id,
      v_share_id,
      v_item.amount,
      v_batch.payment_method,
      v_batch.reference,
      v_batch.receipt_url,
      v_batch.notes,
      'pending'
    )
    RETURNING id INTO v_request_id;

    -- Link it back to the item
    UPDATE batch_deposit_items SET deposit_request_id = v_request_id WHERE id = v_item.id;

    -- Approve it (reuse existing logic)
    PERFORM approve_deposit_request(v_request_id);
  END LOOP;

  UPDATE batch_deposits
  SET status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
  WHERE id = p_batch_id;
END;
$$;

GRANT EXECUTE ON FUNCTION approve_batch_deposit(UUID) TO authenticated;

-- Reject batch
CREATE OR REPLACE FUNCTION reject_batch_deposit(p_batch_id UUID, p_reason TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin','staff') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  UPDATE batch_deposits
  SET status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(),
      rejection_reason = p_reason, updated_at = now()
  WHERE id = p_batch_id AND status = 'pending';
END;
$$;

GRANT EXECUTE ON FUNCTION reject_batch_deposit(UUID, TEXT) TO authenticated;

-- Allow collector role to read profiles (for member search in batch form)
CREATE POLICY profiles_collector_read ON profiles
  FOR SELECT USING (get_user_role(auth.uid()) = 'collector');

-- Update admin_update_user_role to accept 'collector' as a valid role
CREATE OR REPLACE FUNCTION admin_update_user_role(
  p_target_user_id UUID,
  p_new_role        VARCHAR
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF get_user_role(auth.uid()) != 'admin' THEN
    RAISE EXCEPTION 'Only admins can change user roles';
  END IF;

  IF p_new_role NOT IN ('admin', 'staff', 'member', 'collector') THEN
    RAISE EXCEPTION 'Invalid role: %', p_new_role;
  END IF;

  UPDATE profiles
  SET role = p_new_role, updated_at = now()
  WHERE id = p_target_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_update_user_role(UUID, VARCHAR) TO authenticated;


-- ============================================================
-- Migration: 37_member_documents.sql
-- ============================================================

-- Member document uploads (gov ID, proof of address, etc.)
-- Members upload via their profile page; admin/staff view in member detail.

CREATE TABLE IF NOT EXISTS member_documents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  document_type VARCHAR CHECK (document_type IN ('government_id', 'proof_of_address', 'other')) NOT NULL,
  file_name     TEXT NOT NULL,
  file_url      TEXT NOT NULL,
  uploaded_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_member_documents_user ON member_documents(user_id, uploaded_at DESC);

ALTER TABLE member_documents ENABLE ROW LEVEL SECURITY;

-- Members can manage their own documents
CREATE POLICY member_documents_self ON member_documents
  FOR ALL USING (user_id = auth.uid());

-- Admin and staff can view all documents
CREATE POLICY member_documents_admin ON member_documents
  FOR SELECT USING (get_user_role(auth.uid()) IN ('admin', 'staff'));

-- Storage bucket: member-documents
-- Run in Supabase dashboard or via CLI:
--   supabase storage create member-documents --public false
-- Then add policy: allow authenticated users to upload to their own folder (user_id/*)
-- and allow admin/staff to read all.


-- ============================================================
-- Migration: 38_member_notes.sql
-- ============================================================

-- Admin/staff internal notes on members.
-- Not visible to members themselves.

CREATE TABLE IF NOT EXISTS member_notes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  author_id  UUID NOT NULL REFERENCES profiles(id),
  note       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_member_notes_member ON member_notes(member_id, created_at DESC);

ALTER TABLE member_notes ENABLE ROW LEVEL SECURITY;

-- Only admin and staff can read/write notes
CREATE POLICY member_notes_admin ON member_notes
  FOR ALL USING (get_user_role(auth.uid()) IN ('admin', 'staff'));


-- ============================================================
-- Migration: 39_savings.sql
-- ============================================================

-- ─── Savings Module ──────────────────────────────────────────────────────────
-- One savings account per member, opened automatically when first share completes.
-- Deposit flow: member submits request → admin approves → balance updated via trigger.
-- Withdrawal flow: member requests → admin approves → balance deducted in RPC.
-- Interest: released every 6 months via pg_cron calling release_savings_interest().

-- ─── Tables ───────────────────────────────────────────────────────────────────

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

-- Immutable record created when a deposit request is approved
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
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        UUID NOT NULL REFERENCES savings_accounts(id),
  user_id           UUID NOT NULL REFERENCES profiles(id),
  average_daily_balance DECIMAL(15,2) NOT NULL,
  interest_amount   DECIMAL(15,2) NOT NULL,
  period_start      DATE NOT NULL,
  period_end        DATE NOT NULL,
  released_by       VARCHAR NOT NULL DEFAULT 'system',
  created_at        TIMESTAMPTZ DEFAULT now()
);

-- ─── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE savings_accounts           ENABLE ROW LEVEL SECURITY;
ALTER TABLE savings_deposit_requests   ENABLE ROW LEVEL SECURITY;
ALTER TABLE savings_contributions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE savings_withdrawal_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE savings_interest_logs      ENABLE ROW LEVEL SECURITY;

CREATE POLICY savings_accounts_self ON savings_accounts
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY savings_accounts_admin ON savings_accounts
  FOR ALL USING (get_user_role(auth.uid()) IN ('admin','staff'));

CREATE POLICY savings_deposit_requests_self ON savings_deposit_requests
  FOR ALL USING (user_id = auth.uid());
CREATE POLICY savings_deposit_requests_admin ON savings_deposit_requests
  FOR ALL USING (get_user_role(auth.uid()) IN ('admin','staff'));

CREATE POLICY savings_contributions_self ON savings_contributions
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY savings_contributions_admin ON savings_contributions
  FOR ALL USING (get_user_role(auth.uid()) IN ('admin','staff'));

CREATE POLICY savings_withdrawal_requests_self ON savings_withdrawal_requests
  FOR ALL USING (user_id = auth.uid());
CREATE POLICY savings_withdrawal_requests_admin ON savings_withdrawal_requests
  FOR ALL USING (get_user_role(auth.uid()) IN ('admin','staff'));

CREATE POLICY savings_interest_logs_self ON savings_interest_logs
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY savings_interest_logs_admin ON savings_interest_logs
  FOR ALL USING (get_user_role(auth.uid()) IN ('admin','staff'));

-- ─── Extend ledger entry_type to include savings entries ──────────────────────

ALTER TABLE ledger_entries DROP CONSTRAINT IF EXISTS ledger_entries_entry_type_check;
ALTER TABLE ledger_entries ADD CONSTRAINT ledger_entries_entry_type_check
  CHECK (entry_type IN (
    'equity_contribution','equity_reversal',
    'loan_disbursement','loan_repayment',
    'fee','adjustment',
    'savings_deposit','savings_withdrawal','savings_interest'
  ));

-- ─── Trigger: update balance + ledger when contribution inserted ──────────────

CREATE OR REPLACE FUNCTION savings_on_contribution()
RETURNS TRIGGER AS $$
BEGIN
  -- Update account balance
  UPDATE savings_accounts
  SET balance = balance + NEW.amount, updated_at = now()
  WHERE id = NEW.account_id;

  -- Append ledger entry
  INSERT INTO ledger_entries (user_id, entry_type, reference_id, reference_table, amount, direction, created_by)
  VALUES (NEW.user_id, 'savings_deposit', NEW.id, 'savings_contributions', NEW.amount, 'credit', NEW.recorded_by);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER after_savings_contribution
  AFTER INSERT ON savings_contributions
  FOR EACH ROW EXECUTE FUNCTION savings_on_contribution();

-- ─── Auto-create savings account when first share completes ──────────────────

CREATE OR REPLACE FUNCTION auto_create_savings_account()
RETURNS TRIGGER AS $$
BEGIN
  -- When completed_shares goes from 0 to ≥ 1, open a savings account if not already there
  IF (OLD.completed_shares = 0 OR OLD.completed_shares IS NULL) AND NEW.completed_shares >= 1 THEN
    INSERT INTO savings_accounts (user_id)
    VALUES (NEW.user_id)
    ON CONFLICT (user_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER after_membership_status_update_savings
  AFTER UPDATE ON membership_status
  FOR EACH ROW EXECUTE FUNCTION auto_create_savings_account();

-- ─── RPCs ──────────────────────────────────────────────────────────────────────

-- Approve a savings deposit request
CREATE OR REPLACE FUNCTION approve_savings_deposit(p_request_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req        savings_deposit_requests%ROWTYPE;
  v_weekly_cap DECIMAL(15,2);
  v_weekly_sum DECIMAL(15,2);
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin','staff') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT * INTO v_req FROM savings_deposit_requests WHERE id = p_request_id;

  IF v_req.status != 'pending' THEN
    RAISE EXCEPTION 'Request is not pending';
  END IF;

  -- Check weekly deposit cap
  SELECT COALESCE(config_value::DECIMAL, 0) INTO v_weekly_cap
  FROM system_config WHERE config_key = 'savings_weekly_cap';

  IF v_weekly_cap > 0 THEN
    SELECT COALESCE(SUM(sc.amount), 0) INTO v_weekly_sum
    FROM savings_contributions sc
    WHERE sc.user_id = v_req.user_id
      AND sc.contributed_at >= date_trunc('week', now());

    IF v_weekly_sum + v_req.amount > v_weekly_cap THEN
      RAISE EXCEPTION 'Weekly deposit cap of % would be exceeded (already deposited %)',
        v_weekly_cap, v_weekly_sum;
    END IF;
  END IF;

  -- Create contribution (trigger handles balance update + ledger)
  INSERT INTO savings_contributions (
    account_id, user_id, request_id, amount, payment_method, reference, recorded_by
  )
  VALUES (
    v_req.account_id, v_req.user_id, v_req.id,
    v_req.amount, v_req.payment_method, v_req.reference, auth.uid()
  );

  -- Mark approved
  UPDATE savings_deposit_requests
  SET status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
  WHERE id = p_request_id;
END;
$$;

GRANT EXECUTE ON FUNCTION approve_savings_deposit(UUID) TO authenticated;

-- Reject a savings deposit request
CREATE OR REPLACE FUNCTION reject_savings_deposit(p_request_id UUID, p_reason TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin','staff') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  UPDATE savings_deposit_requests
  SET status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(),
      rejection_reason = p_reason, updated_at = now()
  WHERE id = p_request_id AND status = 'pending';
END;
$$;

GRANT EXECUTE ON FUNCTION reject_savings_deposit(UUID, TEXT) TO authenticated;

-- Approve a savings withdrawal request
CREATE OR REPLACE FUNCTION approve_savings_withdrawal(p_request_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req     savings_withdrawal_requests%ROWTYPE;
  v_balance DECIMAL(15,2);
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin','staff') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT * INTO v_req FROM savings_withdrawal_requests WHERE id = p_request_id;

  IF v_req.status != 'pending' THEN
    RAISE EXCEPTION 'Request is not pending';
  END IF;

  SELECT balance INTO v_balance FROM savings_accounts WHERE id = v_req.account_id;

  IF v_balance < v_req.amount THEN
    RAISE EXCEPTION 'Insufficient balance (balance: %, requested: %)', v_balance, v_req.amount;
  END IF;

  -- Deduct from balance
  UPDATE savings_accounts
  SET balance = balance - v_req.amount, updated_at = now()
  WHERE id = v_req.account_id;

  -- Append ledger entry
  INSERT INTO ledger_entries (user_id, entry_type, reference_id, reference_table, amount, direction, created_by)
  VALUES (v_req.user_id, 'savings_withdrawal', v_req.id, 'savings_withdrawal_requests', v_req.amount, 'debit', auth.uid());

  -- Mark approved
  UPDATE savings_withdrawal_requests
  SET status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
  WHERE id = p_request_id;
END;
$$;

GRANT EXECUTE ON FUNCTION approve_savings_withdrawal(UUID) TO authenticated;

-- Reject a savings withdrawal request
CREATE OR REPLACE FUNCTION reject_savings_withdrawal(p_request_id UUID, p_reason TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin','staff') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  UPDATE savings_withdrawal_requests
  SET status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(),
      rejection_reason = p_reason, updated_at = now()
  WHERE id = p_request_id AND status = 'pending';
END;
$$;

GRANT EXECUTE ON FUNCTION reject_savings_withdrawal(UUID, TEXT) TO authenticated;

-- Release interest to all active savings accounts (called by pg_cron every 6 months)
CREATE OR REPLACE FUNCTION release_savings_interest()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rate         DECIMAL(5,2);
  v_period_start DATE;
  v_period_end   DATE;
  v_account      savings_accounts%ROWTYPE;
  v_interest     DECIMAL(15,2);
BEGIN
  SELECT COALESCE(config_value::DECIMAL, 2.5) INTO v_rate
  FROM system_config WHERE config_key = 'savings_interest_rate';

  v_period_start := (now() - INTERVAL '6 months')::DATE;
  v_period_end   := now()::DATE;

  FOR v_account IN
    SELECT * FROM savings_accounts WHERE status = 'active' AND balance > 0
  LOOP
    v_interest := ROUND(v_account.balance * (v_rate / 100), 2);

    IF v_interest > 0 THEN
      -- Credit interest to balance
      UPDATE savings_accounts
      SET balance = balance + v_interest, updated_at = now()
      WHERE id = v_account.id;

      -- Log interest
      INSERT INTO savings_interest_logs (
        account_id, user_id, average_daily_balance, interest_amount,
        period_start, period_end, released_by
      )
      VALUES (
        v_account.id, v_account.user_id, v_account.balance,
        v_interest, v_period_start, v_period_end, 'system'
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

GRANT EXECUTE ON FUNCTION release_savings_interest() TO authenticated;

-- ─── New system_config entries ────────────────────────────────────────────────

INSERT INTO system_config (config_key, config_value, value_type, description) VALUES
  ('savings_interest_rate',         '2.5',  'number',  'Interest rate credited per period (default every 6 months)'),
  ('savings_interest_period_months','6',    'number',  'How many months between interest releases'),
  ('savings_min_deposit',           '500',  'number',  'Minimum single savings deposit amount'),
  ('savings_weekly_cap',            '5000', 'number',  'Maximum total savings deposits per member per calendar week'),
  ('savings_required_for_loan',     'true', 'boolean', 'Whether an active savings account is required before a loan application')
ON CONFLICT (config_key) DO NOTHING;

-- ─── pg_cron schedule (run separately in Supabase dashboard if pg_cron is enabled) ──
-- SELECT cron.schedule('release-savings-interest', '0 0 1 */6 *', 'SELECT release_savings_interest()');


-- ============================================================
-- Migration: 40_savings_backfill.sql
-- ============================================================

-- Backfill: create savings accounts for members who already have ≥1 completed share
-- but whose account was not created because the trigger didn't exist yet.
INSERT INTO savings_accounts (user_id)
SELECT user_id
FROM membership_status
WHERE completed_shares >= 1
ON CONFLICT (user_id) DO NOTHING;


-- ============================================================
-- Migration: 41_savings_interest_fix.sql
-- ============================================================

-- Fix savings interest calculation and remove weekly deposit cap.
--
-- Interest is now calculated on the "qualifying balance":
--   current balance MINUS deposits made within the last savings_interest_holdout_days days.
-- This prevents members from making bulk deposits right before the interest release
-- date just to inflate their interest payout.
--
-- Example: with a 30-day holdout, a deposit made on Jun 29 for a Jun 30 release
-- does NOT count toward the current period — it qualifies next period.

-- ─── Add holdout config key, remove weekly cap ───────────────────────────────

DELETE FROM system_config WHERE config_key = 'savings_weekly_cap';

INSERT INTO system_config (config_key, config_value, value_type, description) VALUES
  ('savings_interest_holdout_days', '30', 'number',
   'Minimum days a deposit must be held before it counts toward interest calculation')
ON CONFLICT (config_key) DO NOTHING;

-- ─── Replace approve_savings_deposit (remove weekly cap enforcement) ──────────

CREATE OR REPLACE FUNCTION approve_savings_deposit(p_request_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req savings_deposit_requests%ROWTYPE;
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin','staff') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT * INTO v_req FROM savings_deposit_requests WHERE id = p_request_id;

  IF v_req.status != 'pending' THEN
    RAISE EXCEPTION 'Request is not pending';
  END IF;

  -- Create contribution (trigger handles balance update + ledger)
  INSERT INTO savings_contributions (
    account_id, user_id, request_id, amount, payment_method, reference, recorded_by
  )
  VALUES (
    v_req.account_id, v_req.user_id, v_req.id,
    v_req.amount, v_req.payment_method, v_req.reference, auth.uid()
  );

  -- Mark approved
  UPDATE savings_deposit_requests
  SET status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
  WHERE id = p_request_id;
END;
$$;

GRANT EXECUTE ON FUNCTION approve_savings_deposit(UUID) TO authenticated;

-- ─── Replace release_savings_interest (use qualifying balance) ────────────────

CREATE OR REPLACE FUNCTION release_savings_interest()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rate          DECIMAL(5,2);
  v_holdout_days  INT;
  v_period_start  DATE;
  v_period_end    DATE;
  v_account       savings_accounts%ROWTYPE;
  v_recent_deposits DECIMAL(15,2);
  v_qualifying    DECIMAL(15,2);
  v_interest      DECIMAL(15,2);
BEGIN
  -- Read configuration
  SELECT COALESCE(config_value::DECIMAL, 2.5) INTO v_rate
  FROM system_config WHERE config_key = 'savings_interest_rate';

  SELECT COALESCE(config_value::INT, 30) INTO v_holdout_days
  FROM system_config WHERE config_key = 'savings_interest_holdout_days';

  v_period_start := (now() - INTERVAL '6 months')::DATE;
  v_period_end   := now()::DATE;

  FOR v_account IN
    SELECT * FROM savings_accounts WHERE status = 'active' AND balance > 0
  LOOP
    -- Qualifying balance = current balance minus deposits made within the holdout window.
    -- Deposits older than holdout_days have "seasoned" and earn interest;
    -- recent bulk deposits do not inflate the payout.
    SELECT COALESCE(SUM(sc.amount), 0) INTO v_recent_deposits
    FROM savings_contributions sc
    WHERE sc.account_id = v_account.id
      AND sc.contributed_at > now() - (v_holdout_days || ' days')::INTERVAL;

    v_qualifying := GREATEST(0, v_account.balance - v_recent_deposits);
    v_interest   := ROUND(v_qualifying * (v_rate / 100), 2);

    IF v_interest > 0 THEN
      -- Credit interest to balance
      UPDATE savings_accounts
      SET balance = balance + v_interest, updated_at = now()
      WHERE id = v_account.id;

      -- Log interest (average_daily_balance reflects the qualifying balance, not raw balance)
      INSERT INTO savings_interest_logs (
        account_id, user_id, average_daily_balance, interest_amount,
        period_start, period_end, released_by
      )
      VALUES (
        v_account.id, v_account.user_id, v_qualifying,
        v_interest, v_period_start, v_period_end, 'system'
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

GRANT EXECUTE ON FUNCTION release_savings_interest() TO authenticated;


-- ============================================================
-- Migration: 42_savings_adb_interest.sql
-- ============================================================

-- Fix interest calculation to use Average Daily Balance (ADB).
--
-- ADB = balance_at_period_start
--       + SUM(each_deposit × days_remaining_in_period / total_period_days)
--       - SUM(each_withdrawal × days_remaining_in_period / total_period_days)
--
-- Effect: a member who saves consistently throughout the 6-month period earns
-- interest on the average balance they held. A member who dumps a large bulk
-- amount the day before interest release earns very little extra — that deposit
-- only contributes (1/180) of its value to the average.

-- Remove holdout config (replaced by ADB approach)
DELETE FROM system_config WHERE config_key = 'savings_interest_holdout_days';

CREATE OR REPLACE FUNCTION release_savings_interest()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rate              DECIMAL(5,2);
  v_period_start_ts   TIMESTAMPTZ;
  v_period_end_ts     TIMESTAMPTZ;
  v_period_days       DECIMAL(15,6);
  v_account           savings_accounts%ROWTYPE;
  v_balance_at_start  DECIMAL(15,2);
  v_adb               DECIMAL(15,2);
  v_interest          DECIMAL(15,2);
BEGIN
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

      -- Log interest (average_daily_balance = ADB, not raw current balance)
      INSERT INTO savings_interest_logs (
        account_id, user_id, average_daily_balance, interest_amount,
        period_start, period_end, released_by
      )
      VALUES (
        v_account.id, v_account.user_id,
        v_adb,
        v_interest,
        v_period_start_ts::DATE, v_period_end_ts::DATE,
        'system'
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

GRANT EXECUTE ON FUNCTION release_savings_interest() TO authenticated;


-- ============================================================
-- Migration: 43_config_corrections.sql
-- ============================================================

-- Correct system_config values based on owner review.

-- Equity shares: minimum weekly installment
UPDATE system_config SET config_value = '250',
  description = 'Minimum deposit installment per week for equity shares'
WHERE config_key = 'min_installment_amount';

-- Savings: separate minimum deposit from minimum balance
UPDATE system_config SET config_value = '100',
  description = 'Minimum single savings deposit amount'
WHERE config_key = 'savings_min_deposit';

INSERT INTO system_config (config_key, config_value, value_type, description) VALUES
  ('savings_min_balance', '500', 'number',
   'Minimum balance that must remain in a savings account (cannot withdraw below this)')
ON CONFLICT (config_key) DO NOTHING;

-- Loans: corrected interest rate and max term
UPDATE system_config SET config_value = '3.33',
  description = 'Monthly loan interest rate (%)'
WHERE config_key = 'loan_interest_rate';

INSERT INTO system_config (config_key, config_value, value_type, description) VALUES
  ('max_loan_term_months', '6', 'number',
   'Maximum allowed loan repayment term in months')
ON CONFLICT (config_key) DO NOTHING;

-- Loan amount formula: collateral-based (replaces multiplier for first-time loans)
-- Max = borrower completed shares value + borrower savings balance
--       + co-maker completed shares value + co-maker savings balance
INSERT INTO system_config (config_key, config_value, value_type, description) VALUES
  ('loan_amount_formula', 'collateral', 'enum',
   'How max loan is computed: collateral = (borrower shares + savings) + (co-maker shares + savings)')
ON CONFLICT (config_key) DO NOTHING;


-- ============================================================
-- Migration: 44_critical_fixes.sql
-- ============================================================

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


-- ============================================================
-- Migration: 45_cron_schedules.sql
-- ============================================================

-- pg_cron scheduled jobs
-- PREREQUISITE: Enable the pg_cron extension first:
--   Supabase Dashboard → Database → Extensions → search "pg_cron" → Enable
--
-- Then run this file in the SQL editor.

-- Daily at midnight: mark past-due loan installments as overdue
SELECT cron.schedule(
  'mark-overdue-installments',
  '0 0 * * *',
  'SELECT mark_overdue_loan_installments()'
);

-- Every 6 months on the 1st at midnight: release savings interest to all active accounts
SELECT cron.schedule(
  'release-savings-interest',
  '0 0 1 */6 *',
  'SELECT release_savings_interest()'
);


-- ============================================================
-- Migration: 46_loan_product_rate_fix.sql
-- ============================================================

-- Migration 46: P2 — Align active loan product interest rates with system_config
--
-- The system_config loan_interest_rate is 3.33% per month.
-- Any active loan products created before this was set may still carry
-- a different rate or an annual rate. This migration corrects them.
--
-- IMPORTANT: Review the results of the SELECT below before running the UPDATE.
-- If a product intentionally uses a different rate, exclude it by ID.

-- Preview affected products (run this first):
-- SELECT id, name, interest_rate, interest_rate_period, calculation_method
-- FROM loan_products WHERE is_active = true;

-- Update all active loan products to 3.33% monthly flat rate:
UPDATE loan_products
SET
  interest_rate        = 3.33,
  interest_rate_period = 'monthly',
  calculation_method   = 'flat'
WHERE is_active = true;


-- ============================================================
-- Migration: 47_optional_co_maker.sql
-- ============================================================

-- Migration 47: Co-maker is optional — only required when loan amount > borrower's own collateral
--
-- Previous rule: always require ≥ 1 confirmed co-maker before approval.
-- New rule: co-maker required only if amount_requested > (borrower shares value + borrower savings).
--           If co-makers are attached (regardless of requirement), they must all have confirmed.

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

  -- ── C4: Collateral-based max loan calculation ─────────────────────────────
  -- Add confirmed co-makers' shares + savings (zero if no co-makers)
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

  v_max_loan := v_borrower_only + v_comaker_shares + v_comaker_savings;

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


-- ============================================================
-- Migration: 48_equity_dividends.sql
-- ============================================================

-- Extend ledger entry_type
ALTER TABLE ledger_entries DROP CONSTRAINT IF EXISTS ledger_entries_entry_type_check;
ALTER TABLE ledger_entries ADD CONSTRAINT ledger_entries_entry_type_check CHECK (entry_type IN (
  'equity_contribution','equity_reversal',
  'loan_disbursement','loan_repayment',
  'fee','adjustment',
  'savings_deposit','savings_withdrawal','savings_interest',
  'equity_dividend'
));

CREATE TABLE equity_dividend_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  share_id UUID NOT NULL REFERENCES equity_shares(id),
  user_id UUID NOT NULL REFERENCES profiles(id),
  share_value DECIMAL(15,2) NOT NULL,
  dividend_earned DECIMAL(15,2) NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  released_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE equity_dividend_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY dividend_logs_self ON equity_dividend_logs FOR SELECT USING (user_id = auth.uid());
CREATE POLICY dividend_logs_admin ON equity_dividend_logs FOR ALL USING (get_user_role(auth.uid()) IN ('admin','staff'));

-- system_config entries
INSERT INTO system_config (config_key, config_value, value_type, description) VALUES
  ('equity_dividend_rate', '5', 'number', 'Dividend rate (%) applied to completed share value per period'),
  ('equity_dividend_period_months', '12', 'number', 'Dividend release cadence in months (default annual)')
ON CONFLICT (config_key) DO NOTHING;

-- release_equity_dividend(): admin triggers annually
-- Credits dividend to savings_accounts.balance if member has one, always logs to ledger
CREATE OR REPLACE FUNCTION release_equity_dividend()
RETURNS INT AS $$
DECLARE
  v_rate        DECIMAL;
  v_period_end  DATE := CURRENT_DATE;
  v_count       INT := 0;
  v_period_start DATE;
  v_dividend    DECIMAL(15,2);
  r             RECORD;
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


-- ============================================================
-- Migration: 49_share_transfers.sql
-- ============================================================

CREATE TABLE share_transfers (
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

ALTER TABLE share_transfers ENABLE ROW LEVEL SECURITY;
CREATE POLICY share_transfers_self ON share_transfers FOR SELECT USING (from_user_id = auth.uid() OR to_user_id = auth.uid());
CREATE POLICY share_transfers_insert ON share_transfers FOR INSERT WITH CHECK (from_user_id = auth.uid());
CREATE POLICY share_transfers_admin ON share_transfers FOR ALL USING (get_user_role(auth.uid()) IN ('admin','staff'));

-- Extend ledger entry_type
ALTER TABLE ledger_entries DROP CONSTRAINT IF EXISTS ledger_entries_entry_type_check;
ALTER TABLE ledger_entries ADD CONSTRAINT ledger_entries_entry_type_check CHECK (entry_type IN (
  'equity_contribution','equity_reversal',
  'loan_disbursement','loan_repayment',
  'fee','adjustment',
  'savings_deposit','savings_withdrawal','savings_interest',
  'equity_dividend',
  'share_transfer_out','share_transfer_in'
));

CREATE OR REPLACE FUNCTION request_share_transfer(p_share_id UUID, p_to_user_id UUID, p_reason TEXT DEFAULT NULL)
RETURNS UUID AS $$
DECLARE
  v_share equity_shares%ROWTYPE;
  v_transfer_id UUID;
BEGIN
  SELECT * INTO v_share FROM equity_shares WHERE id = p_share_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Share not found'; END IF;
  IF v_share.user_id != auth.uid() THEN RAISE EXCEPTION 'You do not own this share'; END IF;
  IF v_share.status != 'completed' THEN RAISE EXCEPTION 'Only completed shares can be transferred'; END IF;

  -- Check no pending transfer for this share
  IF EXISTS (SELECT 1 FROM share_transfers WHERE share_id = p_share_id AND status = 'pending') THEN
    RAISE EXCEPTION 'A pending transfer already exists for this share';
  END IF;

  IF p_to_user_id = auth.uid() THEN RAISE EXCEPTION 'Cannot transfer share to yourself'; END IF;

  INSERT INTO share_transfers (share_id, from_user_id, to_user_id, reason)
  VALUES (p_share_id, auth.uid(), p_to_user_id, p_reason)
  RETURNING id INTO v_transfer_id;

  RETURN v_transfer_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
GRANT EXECUTE ON FUNCTION request_share_transfer(UUID, UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION admin_approve_share_transfer(p_transfer_id UUID)
RETURNS VOID AS $$
DECLARE
  v_t share_transfers%ROWTYPE;
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin','staff') THEN RAISE EXCEPTION 'Access denied'; END IF;
  SELECT * INTO v_t FROM share_transfers WHERE id = p_transfer_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transfer not found'; END IF;
  IF v_t.status != 'pending' THEN RAISE EXCEPTION 'Transfer is not pending'; END IF;

  -- Move the share
  UPDATE equity_shares SET user_id = v_t.to_user_id, updated_at = now() WHERE id = v_t.share_id;

  -- Ledger entries
  INSERT INTO ledger_entries (user_id, entry_type, reference_id, reference_table, amount, direction, notes, created_by)
  SELECT v_t.from_user_id, 'share_transfer_out', v_t.id, 'share_transfers', es.target_amount, 'debit', 'Share transferred out', auth.uid()
  FROM equity_shares es WHERE es.id = v_t.share_id;

  INSERT INTO ledger_entries (user_id, entry_type, reference_id, reference_table, amount, direction, notes, created_by)
  SELECT v_t.to_user_id, 'share_transfer_in', v_t.id, 'share_transfers', es.target_amount, 'credit', 'Share received via transfer', auth.uid()
  FROM equity_shares es WHERE es.id = v_t.share_id;

  UPDATE share_transfers SET status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
  WHERE id = p_transfer_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
GRANT EXECUTE ON FUNCTION admin_approve_share_transfer(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION admin_reject_share_transfer(p_transfer_id UUID, p_reason TEXT)
RETURNS VOID AS $$
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin','staff') THEN RAISE EXCEPTION 'Access denied'; END IF;
  UPDATE share_transfers
  SET status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(), rejection_reason = p_reason, updated_at = now()
  WHERE id = p_transfer_id AND status = 'pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'Transfer not found or not pending'; END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
GRANT EXECUTE ON FUNCTION admin_reject_share_transfer(UUID, TEXT) TO authenticated;


-- ============================================================
-- Migration: 50_damayan.sql
-- ============================================================

CREATE TABLE damayan_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title             VARCHAR NOT NULL,
  description       TEXT,
  affected_member_id UUID REFERENCES profiles(id),
  event_date        DATE NOT NULL,
  assessment_amount DECIMAL(15,2) NOT NULL CHECK (assessment_amount > 0),
  status            VARCHAR CHECK (status IN ('active','closed')) NOT NULL DEFAULT 'active',
  created_by        UUID NOT NULL REFERENCES profiles(id),
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE damayan_assessments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    UUID NOT NULL REFERENCES damayan_events(id),
  user_id     UUID NOT NULL REFERENCES profiles(id),
  amount_due  DECIMAL(15,2) NOT NULL,
  amount_paid DECIMAL(15,2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  status      VARCHAR CHECK (status IN ('pending','paid','waived')) NOT NULL DEFAULT 'pending',
  paid_at     TIMESTAMPTZ,
  notes       TEXT,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE(event_id, user_id)
);

ALTER TABLE damayan_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE damayan_assessments ENABLE ROW LEVEL SECURITY;

-- All authenticated members can read events
CREATE POLICY damayan_events_read ON damayan_events FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY damayan_events_admin ON damayan_events FOR ALL USING (get_user_role(auth.uid()) IN ('admin','staff'));

-- Members see their own assessments; admin/staff see all
CREATE POLICY damayan_assessments_self ON damayan_assessments FOR SELECT USING (user_id = auth.uid());
CREATE POLICY damayan_assessments_admin ON damayan_assessments FOR ALL USING (get_user_role(auth.uid()) IN ('admin','staff'));

-- create_damayan_event: creates event + generates assessments for all active members
CREATE OR REPLACE FUNCTION create_damayan_event(
  p_title TEXT, p_description TEXT, p_affected_member_id UUID,
  p_event_date DATE, p_assessment_amount DECIMAL
)
RETURNS UUID AS $$
DECLARE
  v_event_id UUID;
  v_member RECORD;
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin','staff') THEN RAISE EXCEPTION 'Access denied'; END IF;

  INSERT INTO damayan_events (title, description, affected_member_id, event_date, assessment_amount, created_by)
  VALUES (p_title, p_description, p_affected_member_id, p_event_date, p_assessment_amount, auth.uid())
  RETURNING id INTO v_event_id;

  -- Generate assessment for every active member (except the affected member)
  FOR v_member IN
    SELECT id FROM profiles
    WHERE account_status = 'active' AND role = 'member'
      AND (p_affected_member_id IS NULL OR id != p_affected_member_id)
  LOOP
    INSERT INTO damayan_assessments (event_id, user_id, amount_due)
    VALUES (v_event_id, v_member.id, p_assessment_amount)
    ON CONFLICT (event_id, user_id) DO NOTHING;
  END LOOP;

  RETURN v_event_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
GRANT EXECUTE ON FUNCTION create_damayan_event(TEXT, TEXT, UUID, DATE, DECIMAL) TO authenticated;

-- record_damayan_payment: marks an assessment as paid
CREATE OR REPLACE FUNCTION record_damayan_payment(p_assessment_id UUID, p_notes TEXT DEFAULT NULL)
RETURNS VOID AS $$
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin','staff') THEN RAISE EXCEPTION 'Access denied'; END IF;
  UPDATE damayan_assessments
  SET status = 'paid', amount_paid = amount_due, paid_at = now(), notes = p_notes, updated_at = now()
  WHERE id = p_assessment_id AND status = 'pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'Assessment not found or already processed'; END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
GRANT EXECUTE ON FUNCTION record_damayan_payment(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION waive_damayan_assessment(p_assessment_id UUID, p_notes TEXT DEFAULT NULL)
RETURNS VOID AS $$
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin') THEN RAISE EXCEPTION 'Access denied'; END IF;
  UPDATE damayan_assessments
  SET status = 'waived', notes = p_notes, updated_at = now()
  WHERE id = p_assessment_id AND status = 'pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'Assessment not found or already processed'; END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
GRANT EXECUTE ON FUNCTION waive_damayan_assessment(UUID, TEXT) TO authenticated;


-- ============================================================
-- Migration: 51_branches.sql
-- ============================================================

CREATE TABLE branches (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       VARCHAR NOT NULL,
  location   TEXT,
  is_active  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE branches ENABLE ROW LEVEL SECURITY;
-- All authenticated can read branches; admin manages
CREATE POLICY branches_read ON branches FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY branches_admin ON branches FOR ALL USING (get_user_role(auth.uid()) = 'admin');

-- Add branch_id to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id);

-- Assign member to a branch
CREATE OR REPLACE FUNCTION assign_member_branch(p_user_id UUID, p_branch_id UUID)
RETURNS VOID AS $$
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin','staff') THEN RAISE EXCEPTION 'Access denied'; END IF;
  UPDATE profiles SET branch_id = p_branch_id, updated_at = now() WHERE id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
GRANT EXECUTE ON FUNCTION assign_member_branch(UUID, UUID) TO authenticated;


-- ============================================================
-- Migration: 52_rebates.sql
-- ============================================================

CREATE TABLE rebate_releases (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_start DATE NOT NULL,
  period_end   DATE NOT NULL,
  rebate_rate  DECIMAL(5,2) NOT NULL,
  total_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  released_by  UUID NOT NULL REFERENCES profiles(id),
  notes        TEXT,
  created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE rebate_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  release_id    UUID NOT NULL REFERENCES rebate_releases(id),
  user_id       UUID NOT NULL REFERENCES profiles(id),
  interest_paid DECIMAL(15,2) NOT NULL,
  rebate_rate   DECIMAL(5,2) NOT NULL,
  rebate_amount DECIMAL(15,2) NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE rebate_releases ENABLE ROW LEVEL SECURITY;
ALTER TABLE rebate_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY rebate_releases_admin ON rebate_releases FOR ALL USING (get_user_role(auth.uid()) IN ('admin','staff'));
CREATE POLICY rebate_releases_read ON rebate_releases FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY rebate_logs_self ON rebate_logs FOR SELECT USING (user_id = auth.uid());
CREATE POLICY rebate_logs_admin ON rebate_logs FOR ALL USING (get_user_role(auth.uid()) IN ('admin','staff'));

-- Extend ledger entry_type (final — includes all types from all migrations)
ALTER TABLE ledger_entries DROP CONSTRAINT IF EXISTS ledger_entries_entry_type_check;
ALTER TABLE ledger_entries ADD CONSTRAINT ledger_entries_entry_type_check CHECK (entry_type IN (
  'equity_contribution','equity_reversal',
  'loan_disbursement','loan_repayment',
  'fee','adjustment',
  'savings_deposit','savings_withdrawal','savings_interest',
  'equity_dividend',
  'share_transfer_out','share_transfer_in',
  'rebate'
));

INSERT INTO system_config (config_key, config_value, value_type, description) VALUES
  ('rebate_rate', '10', 'number', 'Rebate percentage of loan interest paid returned to members')
ON CONFLICT (config_key) DO NOTHING;

CREATE OR REPLACE FUNCTION release_rebates(p_period_start DATE, p_period_end DATE)
RETURNS UUID AS $$
DECLARE
  v_rate        DECIMAL;
  v_release_id  UUID;
  v_total       DECIMAL(15,2) := 0;
  v_rebate      DECIMAL(15,2);
  r             RECORD;
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin') THEN RAISE EXCEPTION 'Access denied'; END IF;

  SELECT COALESCE(config_value::DECIMAL, 10) INTO v_rate
  FROM system_config WHERE config_key = 'rebate_rate';

  -- Create release record
  INSERT INTO rebate_releases (period_start, period_end, rebate_rate, released_by, notes)
  VALUES (p_period_start, p_period_end, v_rate, auth.uid(), 'Loan interest rebate')
  RETURNING id INTO v_release_id;

  -- For each member, compute total interest paid during the period
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

  -- Update total on release record
  UPDATE rebate_releases SET total_amount = v_total WHERE id = v_release_id;

  RETURN v_release_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
GRANT EXECUTE ON FUNCTION release_rebates(DATE, DATE) TO authenticated;


-- ============================================================
-- Migration: 53_transfer_members_rpc.sql
-- ============================================================

-- Migration 53: SECURITY DEFINER RPC so members can fetch the active member list
-- for the share transfer recipient dropdown (direct profiles query is blocked by RLS).

CREATE OR REPLACE FUNCTION get_active_members_for_transfer()
RETURNS TABLE(id UUID, full_name VARCHAR, employee_id VARCHAR) AS $$
BEGIN
  RETURN QUERY
  SELECT p.id, p.full_name, p.employee_id
  FROM profiles p
  WHERE p.id != auth.uid()
    AND p.role = 'member'
    AND p.account_status = 'active'
  ORDER BY p.full_name;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_active_members_for_transfer() TO authenticated;


-- ============================================================
-- Migration: 54_branch_income.sql
-- ============================================================

-- Migration 54: Rework branches as cooperative business ventures
--
-- Branches are NOT member chapters. They are businesses owned by the cooperative
-- (e.g., a store, a farm). Income from each branch is distributed to ALL members
-- with completed equity shares, proportional to their share count.
--
-- Changes from migration 51:
--   - Remove branch_id from profiles (members don't belong to branches)
--   - Remove assign_member_branch() RPC
--   - Add branch_income and branch_income_distributions tables
--   - Add record_branch_income() and distribute_branch_income() RPCs

-- Remove member-branch assignment (wrong concept)
ALTER TABLE profiles DROP COLUMN IF EXISTS branch_id;
DROP FUNCTION IF EXISTS assign_member_branch(UUID, UUID);

-- Extend ledger entry_type to include branch income distribution
ALTER TABLE ledger_entries DROP CONSTRAINT IF EXISTS ledger_entries_entry_type_check;
ALTER TABLE ledger_entries ADD CONSTRAINT ledger_entries_entry_type_check CHECK (entry_type IN (
  'equity_contribution','equity_reversal',
  'loan_disbursement','loan_repayment',
  'fee','adjustment',
  'savings_deposit','savings_withdrawal','savings_interest',
  'equity_dividend',
  'share_transfer_out','share_transfer_in',
  'rebate',
  'branch_income'
));

-- ─── branch_income: income recorded per branch per period ─────────────────────
CREATE TABLE branch_income (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id    UUID NOT NULL REFERENCES branches(id),
  amount       DECIMAL(15,2) NOT NULL CHECK (amount > 0),
  period_start DATE NOT NULL,
  period_end   DATE NOT NULL,
  description  TEXT,
  distributed  BOOLEAN NOT NULL DEFAULT false,
  recorded_by  UUID NOT NULL REFERENCES profiles(id),
  created_at   TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE branch_income ENABLE ROW LEVEL SECURITY;
CREATE POLICY branch_income_read ON branch_income FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY branch_income_admin ON branch_income FOR ALL USING (get_user_role(auth.uid()) IN ('admin','staff'));

-- ─── branch_income_distributions: per-member share of a branch income record ──
CREATE TABLE branch_income_distributions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  income_id    UUID NOT NULL REFERENCES branch_income(id),
  user_id      UUID NOT NULL REFERENCES profiles(id),
  share_count  INT NOT NULL,
  amount       DECIMAL(15,2) NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE(income_id, user_id)
);

ALTER TABLE branch_income_distributions ENABLE ROW LEVEL SECURITY;
CREATE POLICY branch_dist_self ON branch_income_distributions FOR SELECT USING (user_id = auth.uid());
CREATE POLICY branch_dist_admin ON branch_income_distributions FOR ALL USING (get_user_role(auth.uid()) IN ('admin','staff'));

-- ─── record_branch_income(): admin records income for a branch ────────────────
CREATE OR REPLACE FUNCTION record_branch_income(
  p_branch_id   UUID,
  p_amount      DECIMAL,
  p_period_start DATE,
  p_period_end   DATE,
  p_description  TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_income_id UUID;
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin','staff') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  INSERT INTO branch_income (branch_id, amount, period_start, period_end, description, recorded_by)
  VALUES (p_branch_id, p_amount, p_period_start, p_period_end, p_description, auth.uid())
  RETURNING id INTO v_income_id;

  RETURN v_income_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
GRANT EXECUTE ON FUNCTION record_branch_income(UUID, DECIMAL, DATE, DATE, TEXT) TO authenticated;

-- ─── distribute_branch_income(): divide income among all shareholders ─────────
-- Distribution is proportional to each member's completed share count.
-- Credits are added to each member's savings account (if active).
CREATE OR REPLACE FUNCTION distribute_branch_income(p_income_id UUID)
RETURNS INT AS $$
DECLARE
  v_income     branch_income%ROWTYPE;
  v_total_shares INT;
  v_per_share  DECIMAL(15,2);
  v_count      INT := 0;
  r            RECORD;
  v_member_amount DECIMAL(15,2);
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin') THEN
    RAISE EXCEPTION 'Access denied — only admin can distribute income';
  END IF;

  SELECT * INTO v_income FROM branch_income WHERE id = p_income_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Income record not found'; END IF;
  IF v_income.distributed THEN RAISE EXCEPTION 'This income has already been distributed'; END IF;

  -- Count total completed shares across all active members
  SELECT COALESCE(SUM(share_count), 0) INTO v_total_shares
  FROM (
    SELECT COUNT(*) AS share_count
    FROM equity_shares es
    JOIN profiles p ON p.id = es.user_id
    WHERE es.status = 'completed'
      AND p.account_status = 'active'
      AND p.role = 'member'
    GROUP BY es.user_id
  ) sub;

  IF v_total_shares = 0 THEN
    RAISE EXCEPTION 'No members with completed shares found';
  END IF;

  v_per_share := v_income.amount / v_total_shares;

  -- Distribute to each member proportional to their share count
  FOR r IN
    SELECT es.user_id, COUNT(*) AS share_count
    FROM equity_shares es
    JOIN profiles p ON p.id = es.user_id
    WHERE es.status = 'completed'
      AND p.account_status = 'active'
      AND p.role = 'member'
    GROUP BY es.user_id
  LOOP
    v_member_amount := ROUND(v_per_share * r.share_count, 2);

    INSERT INTO branch_income_distributions (income_id, user_id, share_count, amount)
    VALUES (p_income_id, r.user_id, r.share_count::INT, v_member_amount)
    ON CONFLICT (income_id, user_id) DO NOTHING;

    -- Credit to savings account if exists
    UPDATE savings_accounts
    SET balance = balance + v_member_amount, updated_at = now()
    WHERE user_id = r.user_id AND status = 'active';

    -- Ledger entry
    INSERT INTO ledger_entries (
      user_id, entry_type, reference_id, reference_table, amount, direction, notes, created_by
    ) VALUES (
      r.user_id, 'branch_income', p_income_id, 'branch_income',
      v_member_amount, 'credit', 'Branch income distribution', auth.uid()
    );

    v_count := v_count + 1;
  END LOOP;

  -- Mark as distributed
  UPDATE branch_income SET distributed = true WHERE id = p_income_id;

  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
GRANT EXECUTE ON FUNCTION distribute_branch_income(UUID) TO authenticated;


-- ============================================================
-- Migration: 55_branch_expenses.sql
-- ============================================================

-- branch_expenses: categorized expense records per branch per period
CREATE TABLE branch_expenses (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id   UUID NOT NULL REFERENCES branches(id),
  category    VARCHAR CHECK (category IN ('salary','utilities','rent','supplies','maintenance','other')) NOT NULL DEFAULT 'other',
  amount      DECIMAL(15,2) NOT NULL CHECK (amount > 0),
  period_start DATE NOT NULL,
  period_end   DATE NOT NULL,
  description TEXT,
  recorded_by UUID NOT NULL REFERENCES profiles(id),
  created_at  TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE branch_expenses ENABLE ROW LEVEL SECURITY;
-- All authenticated users can read (members see branch financials)
CREATE POLICY branch_expenses_read ON branch_expenses FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY branch_expenses_admin ON branch_expenses FOR ALL USING (get_user_role(auth.uid()) IN ('admin','staff'));

CREATE OR REPLACE FUNCTION record_branch_expense(
  p_branch_id    UUID,
  p_category     VARCHAR,
  p_amount       DECIMAL,
  p_period_start DATE,
  p_period_end   DATE,
  p_description  TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE v_id UUID;
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin','staff') THEN RAISE EXCEPTION 'Access denied'; END IF;
  INSERT INTO branch_expenses (branch_id, category, amount, period_start, period_end, description, recorded_by)
  VALUES (p_branch_id, p_category, p_amount, p_period_start, p_period_end, p_description, auth.uid())
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
GRANT EXECUTE ON FUNCTION record_branch_expense(UUID, VARCHAR, DECIMAL, DATE, DATE, TEXT) TO authenticated;


-- ============================================================
-- Migration: 56_board_role.sql
-- ============================================================

-- Migration 56: Add Board of Directors role + fill in missing permission keys
--
-- Board of Directors (board):
--   - Read-only access to reports, members, branch portfolio, cooperative financials
--   - No approval or management actions
--
-- Also seeds new permission keys for features added in migrations 39–55
--   (savings, share transfers, damayan, branch recording)

-- ─── 1. Add 'board' to profiles role constraint ───────────────────────────────
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('admin', 'member', 'staff', 'collector', 'board'));

-- ─── 2. Extend role_permissions to allow 'board' and 'collector' ──────────────
ALTER TABLE role_permissions DROP CONSTRAINT IF EXISTS role_permissions_role_check;
ALTER TABLE role_permissions ADD CONSTRAINT role_permissions_role_check
  CHECK (role IN ('staff', 'member', 'board', 'collector'));

-- ─── 3. Seed new staff permissions ───────────────────────────────────────────
INSERT INTO role_permissions (role, permission_key, enabled) VALUES
  -- Savings
  ('staff', 'approve_savings',        true),
  ('staff', 'reject_savings',         true),
  -- Share transfers
  ('staff', 'approve_share_transfers',true),
  -- Damayan
  ('staff', 'manage_damayan',         true),
  -- Branches
  ('staff', 'record_branch_data',     false)
ON CONFLICT (role, permission_key) DO NOTHING;

-- ─── 4. Seed new member permissions ──────────────────────────────────────────
INSERT INTO role_permissions (role, permission_key, enabled) VALUES
  ('member', 'submit_savings_request',  true),
  ('member', 'request_share_transfer',  true),
  ('member', 'view_branch_portfolio',   true)
ON CONFLICT (role, permission_key) DO NOTHING;

-- ─── 5. Seed board permissions (all read-only) ───────────────────────────────
INSERT INTO role_permissions (role, permission_key, enabled) VALUES
  ('board', 'view_reports',           true),
  ('board', 'view_members',           true),
  ('board', 'view_branch_portfolio',  true),
  ('board', 'view_loan_portfolio',    true),
  ('board', 'view_cooperative_funds', true)
ON CONFLICT (role, permission_key) DO NOTHING;

-- ─── 6. Update change_user_role() to accept 'board' ──────────────────────────
CREATE OR REPLACE FUNCTION change_user_role(p_target_user_id UUID, p_new_role TEXT)
RETURNS VOID AS $$
BEGIN
  IF get_user_role(auth.uid()) != 'admin' THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  IF p_new_role NOT IN ('admin', 'staff', 'member', 'collector', 'board') THEN
    RAISE EXCEPTION 'Invalid role: %', p_new_role;
  END IF;
  UPDATE profiles SET role = p_new_role, updated_at = now()
  WHERE id = p_target_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
GRANT EXECUTE ON FUNCTION change_user_role(UUID, TEXT) TO authenticated;

-- ─── 7. RLS: board can read key tables ───────────────────────────────────────
DROP POLICY IF EXISTS profiles_board_read ON profiles;
CREATE POLICY profiles_board_read ON profiles
  FOR SELECT USING (get_user_role(auth.uid()) = 'board');

DROP POLICY IF EXISTS loans_board_read ON loans;
CREATE POLICY loans_board_read ON loans
  FOR SELECT USING (get_user_role(auth.uid()) = 'board');

DROP POLICY IF EXISTS loan_applications_board_read ON loan_applications;
CREATE POLICY loan_applications_board_read ON loan_applications
  FOR SELECT USING (get_user_role(auth.uid()) = 'board');

DROP POLICY IF EXISTS savings_accounts_board_read ON savings_accounts;
CREATE POLICY savings_accounts_board_read ON savings_accounts
  FOR SELECT USING (get_user_role(auth.uid()) = 'board');

DROP POLICY IF EXISTS branch_income_board_read ON branch_income;
CREATE POLICY branch_income_board_read ON branch_income
  FOR SELECT USING (get_user_role(auth.uid()) = 'board');

DROP POLICY IF EXISTS branch_expenses_board_read ON branch_expenses;
CREATE POLICY branch_expenses_board_read ON branch_expenses
  FOR SELECT USING (get_user_role(auth.uid()) = 'board');


-- ============================================================
-- Migration: 57_comaker_shares_only.sql
-- ============================================================

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


-- ============================================================
-- Migration: 58_get_collateral_shares.sql
-- ============================================================

-- Migration 58: RPC to read co-maker share values for loan collateral
--
-- Members cannot read other members' equity_shares due to RLS (equity_shares_self policy).
-- This SECURITY DEFINER function bypasses RLS and returns completed share totals
-- for a given list of user IDs — scoped to the caller being an authenticated member.

CREATE OR REPLACE FUNCTION get_completed_share_totals(p_user_ids UUID[])
RETURNS TABLE(user_id UUID, total_shares DECIMAL(15,2)) AS $$
BEGIN
  -- Only allow authenticated users to call this
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  RETURN QUERY
  SELECT
    es.user_id,
    COALESCE(SUM(es.target_amount), 0)::DECIMAL(15,2) AS total_shares
  FROM equity_shares es
  WHERE es.user_id = ANY(p_user_ids)
    AND es.status = 'completed'
  GROUP BY es.user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_completed_share_totals(UUID[]) TO authenticated;


-- ============================================================
-- Migration: 59_branch_income_breakdown.sql
-- ============================================================

-- Migration 59: Add gross_sales, salary, expenses_total, roi to branch_income
--
-- net_profit (the distributable amount) = gross_sales - salary - expenses_total
-- roi is stored as a percentage (user-entered, informational)

ALTER TABLE branch_income
  ADD COLUMN IF NOT EXISTS gross_sales     DECIMAL(15,2),
  ADD COLUMN IF NOT EXISTS salary          DECIMAL(15,2),
  ADD COLUMN IF NOT EXISTS expenses_total  DECIMAL(15,2),
  ADD COLUMN IF NOT EXISTS roi             DECIMAL(8,2);

-- ─── Update record_branch_income() to accept new fields ──────────────────────
DROP FUNCTION IF EXISTS record_branch_income(UUID, DECIMAL, DATE, DATE, TEXT);

CREATE OR REPLACE FUNCTION record_branch_income(
  p_branch_id      UUID,
  p_amount         DECIMAL,
  p_period_start   DATE,
  p_period_end     DATE,
  p_description    TEXT    DEFAULT NULL,
  p_gross_sales    DECIMAL DEFAULT NULL,
  p_salary         DECIMAL DEFAULT NULL,
  p_expenses_total DECIMAL DEFAULT NULL,
  p_roi            DECIMAL DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_income_id UUID;
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin','staff') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  INSERT INTO branch_income (
    branch_id, amount, period_start, period_end, description,
    gross_sales, salary, expenses_total, roi, recorded_by
  )
  VALUES (
    p_branch_id, p_amount, p_period_start, p_period_end, p_description,
    p_gross_sales, p_salary, p_expenses_total, p_roi, auth.uid()
  )
  RETURNING id INTO v_income_id;

  RETURN v_income_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION record_branch_income(UUID, DECIMAL, DATE, DATE, TEXT, DECIMAL, DECIMAL, DECIMAL, DECIMAL) TO authenticated;


-- ============================================================
-- Migration: 60_branch_cutoff.sql
-- ============================================================

-- Migration 60: Add report_cutoff_day to branches
--
-- report_cutoff_day: 0 = Sunday, 1 = Monday, ..., 6 = Saturday
-- Defines which day of the week the weekly reporting period ends.
-- Defaults to 0 (Sunday), meaning each period runs Monday–Sunday.

ALTER TABLE branches
  ADD COLUMN IF NOT EXISTS report_cutoff_day SMALLINT DEFAULT 0
    CHECK (report_cutoff_day BETWEEN 0 AND 6);


-- ============================================================
-- Migration: 61_critical_accounting_fixes.sql
-- ============================================================

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


-- ============================================================
-- Migration: 62_high_accounting_fixes.sql
-- ============================================================

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
        account_id, user_id, average_daily_balance, interest_amount,
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


-- ============================================================
-- Migration: 63_medium_accounting_fixes.sql
-- ============================================================

-- Migration 63: MEDIUM-priority accounting fixes
--
-- 10. Branch distribution snapshot — use period_end share count, not live count
-- 11. Savings balance reconciliation — verify_savings_balance() helper
-- 12. Loan outstanding reconciliation — verify_loan_outstanding() helper
-- 13. Member exit/withdrawal process — admin_deactivate_member() RPC

-- ─── Issue 10: Branch distribution — use period-end share snapshot ────────────
-- Members who completed a share AFTER the income period end should NOT receive
-- a distribution for that period.

CREATE OR REPLACE FUNCTION distribute_branch_income(p_income_id UUID)
RETURNS INT AS $$
DECLARE
  v_income        branch_income%ROWTYPE;
  v_total_shares  INT;
  v_per_share     DECIMAL(15,2);
  v_count         INT := 0;
  r               RECORD;
  v_member_amount DECIMAL(15,2);
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin') THEN
    RAISE EXCEPTION 'Access denied — only admin can distribute income';
  END IF;

  SELECT * INTO v_income FROM branch_income WHERE id = p_income_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Income record not found'; END IF;
  IF v_income.distributed THEN RAISE EXCEPTION 'This income has already been distributed'; END IF;

  -- Count total completed shares as of the income period_end date
  -- (members who completed shares AFTER period_end are excluded)
  SELECT COALESCE(SUM(share_count), 0) INTO v_total_shares
  FROM (
    SELECT COUNT(*) AS share_count
    FROM equity_shares es
    JOIN profiles p ON p.id = es.user_id
    WHERE es.status = 'completed'
      AND (es.completed_at IS NULL OR es.completed_at::DATE <= v_income.period_end)
      AND p.account_status = 'active'
      AND p.role IN ('member', 'collector')
    GROUP BY es.user_id
  ) sub;

  IF v_total_shares = 0 THEN
    RAISE EXCEPTION 'No members with completed shares found for the period ending %', v_income.period_end;
  END IF;

  v_per_share := v_income.amount / v_total_shares;

  FOR r IN
    SELECT es.user_id, COUNT(*) AS share_count
    FROM equity_shares es
    JOIN profiles p ON p.id = es.user_id
    WHERE es.status = 'completed'
      AND (es.completed_at IS NULL OR es.completed_at::DATE <= v_income.period_end)
      AND p.account_status = 'active'
      AND p.role IN ('member', 'collector')
    GROUP BY es.user_id
  LOOP
    v_member_amount := ROUND(v_per_share * r.share_count, 2);

    INSERT INTO branch_income_distributions (income_id, user_id, share_count, amount)
    VALUES (p_income_id, r.user_id, r.share_count::INT, v_member_amount)
    ON CONFLICT (income_id, user_id) DO NOTHING;

    UPDATE savings_accounts
    SET balance = balance + v_member_amount, updated_at = now()
    WHERE user_id = r.user_id AND status = 'active';

    INSERT INTO ledger_entries (
      user_id, entry_type, reference_id, reference_table, amount, direction, notes, created_by
    ) VALUES (
      r.user_id, 'branch_income', p_income_id, 'branch_income',
      v_member_amount, 'credit', 'Branch income distribution', auth.uid()
    );

    v_count := v_count + 1;
  END LOOP;

  UPDATE branch_income SET distributed = true WHERE id = p_income_id;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
GRANT EXECUTE ON FUNCTION distribute_branch_income(UUID) TO authenticated;

-- ─── Issue 11: Savings balance reconciliation helper ─────────────────────────

CREATE OR REPLACE FUNCTION verify_savings_balance(p_account_id UUID)
RETURNS TABLE(
  account_id        UUID,
  stored_balance    DECIMAL(15,2),
  computed_balance  DECIMAL(15,2),
  difference        DECIMAL(15,2),
  is_reconciled     BOOLEAN
) AS $$
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin', 'staff') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  WITH
  deposits AS (
    SELECT COALESCE(SUM(sc.amount), 0)::DECIMAL(15,2) AS total
    FROM savings_contributions sc
    WHERE sc.account_id = p_account_id
  ),
  withdrawals AS (
    SELECT COALESCE(SUM(swr.amount), 0)::DECIMAL(15,2) AS total
    FROM savings_withdrawal_requests swr
    WHERE swr.account_id = p_account_id AND swr.status = 'approved'
  ),
  interest AS (
    SELECT COALESCE(SUM(sil.interest_amount), 0)::DECIMAL(15,2) AS total
    FROM savings_interest_logs sil
    WHERE sil.account_id = p_account_id
  ),
  distributions AS (
    SELECT COALESCE(SUM(bid.amount), 0)::DECIMAL(15,2) AS total
    FROM branch_income_distributions bid
    JOIN savings_accounts sa ON sa.user_id = bid.user_id
    WHERE sa.id = p_account_id
  ),
  dividends AS (
    SELECT COALESCE(SUM(edl.dividend_earned), 0)::DECIMAL(15,2) AS total
    FROM equity_dividend_logs edl
    JOIN savings_accounts sa ON sa.user_id = edl.user_id
    WHERE sa.id = p_account_id
  ),
  rebates_earned AS (
    SELECT COALESCE(SUM(rl.rebate_amount), 0)::DECIMAL(15,2) AS total
    FROM rebate_logs rl
    JOIN savings_accounts sa ON sa.user_id = rl.user_id
    WHERE sa.id = p_account_id
  )
  SELECT
    sa.id,
    sa.balance,
    (d.total + i.total + dist.total + div.total + reb.total - w.total)::DECIMAL(15,2) AS computed_balance,
    (sa.balance - (d.total + i.total + dist.total + div.total + reb.total - w.total))::DECIMAL(15,2) AS difference,
    ABS(sa.balance - (d.total + i.total + dist.total + div.total + reb.total - w.total)) < 0.01
  FROM savings_accounts sa, deposits d, withdrawals w, interest i, distributions dist, dividends div, rebates_earned reb
  WHERE sa.id = p_account_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
GRANT EXECUTE ON FUNCTION verify_savings_balance(UUID) TO authenticated;

-- ─── Issue 12: Loan outstanding reconciliation helper ─────────────────────────

CREATE OR REPLACE FUNCTION verify_loan_outstanding(p_loan_id UUID)
RETURNS TABLE(
  loan_id               UUID,
  stored_outstanding    DECIMAL(15,2),
  computed_outstanding  DECIMAL(15,2),
  difference            DECIMAL(15,2),
  is_reconciled         BOOLEAN
) AS $$
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin', 'staff') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  SELECT
    l.id,
    l.outstanding,
    -- Outstanding = sum of unpaid amounts on non-waived installments
    COALESCE(SUM(
      CASE
        WHEN lrs.status IN ('pending','overdue') THEN lrs.total_due
        WHEN lrs.status = 'partial'              THEN lrs.total_due - lrs.amount_paid
        ELSE 0
      END
    ), 0)::DECIMAL(15,2) AS computed_outstanding,
    (l.outstanding - COALESCE(SUM(
      CASE
        WHEN lrs.status IN ('pending','overdue') THEN lrs.total_due
        WHEN lrs.status = 'partial'              THEN lrs.total_due - lrs.amount_paid
        ELSE 0
      END
    ), 0))::DECIMAL(15,2) AS difference,
    ABS(l.outstanding - COALESCE(SUM(
      CASE
        WHEN lrs.status IN ('pending','overdue') THEN lrs.total_due
        WHEN lrs.status = 'partial'              THEN lrs.total_due - lrs.amount_paid
        ELSE 0
      END
    ), 0)) < 0.01
  FROM loans l
  LEFT JOIN loan_repayment_schedule lrs ON lrs.loan_id = l.id
  WHERE l.id = p_loan_id
  GROUP BY l.id, l.outstanding;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
GRANT EXECUTE ON FUNCTION verify_loan_outstanding(UUID) TO authenticated;

-- ─── Issue 13: Member exit / withdrawal process ───────────────────────────────

CREATE OR REPLACE FUNCTION admin_deactivate_member(p_user_id UUID, p_reason TEXT DEFAULT NULL)
RETURNS JSONB AS $$
DECLARE
  v_active_loans    INT;
  v_damayan_arrears DECIMAL(15,2);
  v_savings_balance DECIMAL(15,2);
  v_result          JSONB;
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin') THEN
    RAISE EXCEPTION 'Access denied — only admin can deactivate members';
  END IF;

  -- Block if the member has active loans
  SELECT COUNT(*) INTO v_active_loans
  FROM loans WHERE user_id = p_user_id AND status IN ('active','defaulted');

  IF v_active_loans > 0 THEN
    RAISE EXCEPTION 'Cannot deactivate: member has % active/defaulted loan(s). Settle all loans first.', v_active_loans;
  END IF;

  -- Record outstanding damayan arrears for audit
  SELECT COALESCE(SUM(amount_due - amount_paid), 0) INTO v_damayan_arrears
  FROM damayan_assessments
  WHERE user_id = p_user_id AND status = 'pending';

  -- Capture savings balance before closing
  SELECT COALESCE(balance, 0) INTO v_savings_balance
  FROM savings_accounts WHERE user_id = p_user_id AND status = 'active';

  -- Close savings account
  UPDATE savings_accounts
  SET status = 'closed', closed_at = now(), updated_at = now()
  WHERE user_id = p_user_id AND status = 'active';

  -- Suspend pending damayan assessments (write them off)
  UPDATE damayan_assessments
  SET status = 'waived', notes = COALESCE(notes || ' | ', '') || 'Waived on member exit', updated_at = now()
  WHERE user_id = p_user_id AND status = 'pending';

  -- Mark all in-progress shares as cancelled
  UPDATE equity_shares
  SET status = 'cancelled', updated_at = now()
  WHERE user_id = p_user_id AND status = 'in_progress';

  -- Set profile to inactive
  UPDATE profiles
  SET account_status = 'inactive', updated_at = now()
  WHERE id = p_user_id;

  -- Build result summary
  v_result := jsonb_build_object(
    'user_id',          p_user_id,
    'reason',           p_reason,
    'savings_closed',   v_savings_balance,
    'damayan_written_off', v_damayan_arrears,
    'deactivated_at',   now()
  );

  -- Ledger note if savings were closed with a balance (manual payout needed)
  IF v_savings_balance > 0 THEN
    INSERT INTO ledger_entries (user_id, entry_type, reference_id, reference_table, amount, direction, notes, created_by)
    VALUES (p_user_id, 'adjustment', p_user_id, 'profiles', v_savings_balance, 'credit',
            'Member exit — savings balance payout pending: ' || v_savings_balance::TEXT, auth.uid());
  END IF;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
GRANT EXECUTE ON FUNCTION admin_deactivate_member(UUID, TEXT) TO authenticated;

-- ─── Issue 14: Loan aging / delinquency report ────────────────────────────────

CREATE OR REPLACE FUNCTION get_loan_aging_report()
RETURNS TABLE(
  bucket            TEXT,
  loan_count        INT,
  total_outstanding DECIMAL(15,2),
  loan_ids          UUID[]
) AS $$
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin', 'staff', 'board') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  SELECT
    CASE
      WHEN l.status = 'completed' THEN 'Completed'
      WHEN MAX(COALESCE(lrs.due_date, l.due_date)) >= CURRENT_DATE THEN 'Current'
      WHEN MAX(COALESCE(lrs.due_date, l.due_date)) >= CURRENT_DATE - 30 THEN '1–30 days'
      WHEN MAX(COALESCE(lrs.due_date, l.due_date)) >= CURRENT_DATE - 60 THEN '31–60 days'
      WHEN MAX(COALESCE(lrs.due_date, l.due_date)) >= CURRENT_DATE - 90 THEN '61–90 days'
      ELSE '90+ days'
    END AS bucket,
    COUNT(DISTINCT l.id)::INT AS loan_count,
    SUM(l.outstanding)::DECIMAL(15,2) AS total_outstanding,
    ARRAY_AGG(DISTINCT l.id) AS loan_ids
  FROM loans l
  LEFT JOIN loan_repayment_schedule lrs ON lrs.loan_id = l.id AND lrs.status IN ('pending','overdue','partial')
  WHERE l.status IN ('active','defaulted','completed')
  GROUP BY
    CASE
      WHEN l.status = 'completed' THEN 'Completed'
      WHEN MAX(COALESCE(lrs.due_date, l.due_date)) >= CURRENT_DATE THEN 'Current'
      WHEN MAX(COALESCE(lrs.due_date, l.due_date)) >= CURRENT_DATE - 30 THEN '1–30 days'
      WHEN MAX(COALESCE(lrs.due_date, l.due_date)) >= CURRENT_DATE - 60 THEN '31–60 days'
      WHEN MAX(COALESCE(lrs.due_date, l.due_date)) >= CURRENT_DATE - 90 THEN '61–90 days'
      ELSE '90+ days'
    END
  ORDER BY MIN(COALESCE(lrs.due_date, l.due_date));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
GRANT EXECUTE ON FUNCTION get_loan_aging_report() TO authenticated;


-- ============================================================
-- Migration: 64_cancel_loan_application.sql
-- ============================================================

-- Migration 64: Allow members to cancel their own draft/submitted loan applications
--
-- Direct UPDATE is blocked by RLS (members have SELECT + INSERT only).
-- A SECURITY DEFINER RPC bypasses RLS safely while enforcing ownership + status checks.

CREATE OR REPLACE FUNCTION cancel_loan_application(p_application_id UUID)
RETURNS VOID AS $$
DECLARE
  v_app loan_applications%ROWTYPE;
BEGIN
  SELECT * INTO v_app FROM loan_applications WHERE id = p_application_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Application not found'; END IF;

  -- Only the applicant themselves can cancel
  IF v_app.user_id != auth.uid() THEN
    RAISE EXCEPTION 'Access denied — you can only cancel your own applications';
  END IF;

  -- Can only cancel draft or submitted (not yet under review / approved)
  IF v_app.status NOT IN ('draft', 'submitted') THEN
    RAISE EXCEPTION 'Cannot cancel an application with status: %', v_app.status;
  END IF;

  UPDATE loan_applications
  SET status = 'cancelled', updated_at = now()
  WHERE id = p_application_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION cancel_loan_application(UUID) TO authenticated;


-- ============================================================
-- Migration: 65_fix_under_review_rpc.sql
-- ============================================================

-- Migration 65: Fix admin_set_loan_under_review to accept orphaned drafts
--
-- Before this fix, the RPC only updated rows WHERE status = 'submitted'.
-- Orphaned draft applications (co-makers all confirmed but status still 'draft')
-- would silently fail because the WHERE clause didn't match.
-- Accept both 'submitted' and 'draft' so admins can move any ready application forward.

CREATE OR REPLACE FUNCTION admin_set_loan_under_review(p_application_id UUID)
RETURNS VOID AS $$
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin', 'staff') THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  UPDATE loan_applications
  SET status = 'under_review', updated_at = now()
  WHERE id = p_application_id AND status IN ('submitted', 'draft');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Application not found or already in review / approved / rejected';
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================================
-- Migration: 66_member_batch_deposit_rls.sql
-- ============================================================

-- Allow members to read profiles for employee ID lookup in batch deposit form.
-- Previously only 'collector' role had this access; batch deposit is now open to all members.

DROP POLICY IF EXISTS profiles_member_read ON profiles;

CREATE POLICY profiles_member_read ON profiles
  FOR SELECT
  USING (get_user_role(auth.uid()) = 'member');

-- Also ensure members can read deposit_requests for their own submissions
-- (batch approval creates deposit_requests owned by the beneficiary member)
DROP POLICY IF EXISTS deposit_requests_member_read ON deposit_requests;

CREATE POLICY deposit_requests_member_read ON deposit_requests
  FOR SELECT
  USING (user_id = auth.uid());


-- ============================================================
-- Migration: 67_custom_roles.sql
-- ============================================================

-- Custom roles: admin-defined organizational labels for members
CREATE TABLE IF NOT EXISTS custom_roles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(50) NOT NULL UNIQUE,
  color       VARCHAR(20) NOT NULL DEFAULT 'gray',  -- tailwind color name: gray, blue, green, purple, red, yellow, orange, pink
  description TEXT,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- Each profile can have one custom role (organizational title, not access control)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS custom_role_id UUID REFERENCES custom_roles(id) ON DELETE SET NULL;

-- RLS
ALTER TABLE custom_roles ENABLE ROW LEVEL SECURITY;

-- Everyone authenticated can read custom roles
CREATE POLICY custom_roles_read ON custom_roles
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- Only admin/staff can manage custom roles
CREATE POLICY custom_roles_admin ON custom_roles
  FOR ALL USING (get_user_role(auth.uid()) IN ('admin', 'staff'));

-- Remove collector from the role constraint
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('admin', 'member', 'staff', 'board'));

-- Update any existing collector profiles to member
UPDATE profiles SET role = 'member' WHERE role = 'collector';

-- Update admin_update_user_role to not accept collector
CREATE OR REPLACE FUNCTION admin_update_user_role(
  p_target_user_id UUID,
  p_new_role        VARCHAR
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF get_user_role(auth.uid()) != 'admin' THEN
    RAISE EXCEPTION 'Only admins can change user roles';
  END IF;
  IF p_new_role NOT IN ('admin', 'staff', 'member', 'board') THEN
    RAISE EXCEPTION 'Invalid role: %', p_new_role;
  END IF;
  UPDATE profiles SET role = p_new_role, updated_at = now()
  WHERE id = p_target_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_update_user_role(UUID, VARCHAR) TO authenticated;

-- RPC: assign or clear custom role for a member
CREATE OR REPLACE FUNCTION admin_assign_custom_role(
  p_user_id UUID,
  p_custom_role_id UUID  -- pass NULL to clear
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin', 'staff') THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;
  UPDATE profiles SET custom_role_id = p_custom_role_id, updated_at = now()
  WHERE id = p_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_assign_custom_role(UUID, UUID) TO authenticated;


-- ============================================================
-- Migration: 68_custom_role_permissions.sql
-- ============================================================

-- Custom role permissions
-- Stores configurable permission toggles for each custom role created by the admin.

CREATE TABLE IF NOT EXISTS custom_role_permissions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  custom_role_id UUID NOT NULL REFERENCES custom_roles(id) ON DELETE CASCADE,
  permission_key VARCHAR NOT NULL,
  enabled        BOOLEAN NOT NULL DEFAULT true,
  updated_by     UUID REFERENCES profiles(id),
  updated_at     TIMESTAMPTZ DEFAULT now(),
  UNIQUE (custom_role_id, permission_key)
);

-- RLS: admin can read and write; others can read (UI needs to check these)
ALTER TABLE custom_role_permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS crp_admin_all ON custom_role_permissions;
DROP POLICY IF EXISTS crp_read_all ON custom_role_permissions;

CREATE POLICY crp_admin_all ON custom_role_permissions
  FOR ALL
  USING (get_user_role(auth.uid()) = 'admin')
  WITH CHECK (get_user_role(auth.uid()) = 'admin');

CREATE POLICY crp_read_all ON custom_role_permissions
  FOR SELECT
  USING (get_user_role(auth.uid()) IN ('admin', 'staff', 'member', 'board'));


-- ============================================================
-- Migration: 69_loan_repayment_frequency.sql
-- ============================================================

-- Add repayment_frequency to loan_products and loans.
-- Replace admin_approve_loan_application to generate schedules with the correct cadence.

-- ─── Schema ───────────────────────────────────────────────────────────────────

ALTER TABLE loan_products
  ADD COLUMN IF NOT EXISTS repayment_frequency TEXT NOT NULL DEFAULT 'monthly'
    CHECK (repayment_frequency IN ('weekly', 'bi_weekly', 'semi_monthly', 'monthly'));

ALTER TABLE loans
  ADD COLUMN IF NOT EXISTS repayment_frequency TEXT NOT NULL DEFAULT 'monthly'
    CHECK (repayment_frequency IN ('weekly', 'bi_weekly', 'semi_monthly', 'monthly'));

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
  v_n_periods       INT;       -- total installments
  v_periods_per_yr  DECIMAL;   -- periods per year (for rate conversion)
  v_r               DECIMAL;   -- periodic interest rate
  v_emi             DECIMAL;
  v_outstanding     DECIMAL;
  v_principal_pay   DECIMAL;
  v_interest_pay    DECIMAL;
  v_total_repayable DECIMAL;
  v_interval        INTERVAL;
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

  -- Load loan product (for rate, method, frequency)
  SELECT * INTO v_product FROM loan_products WHERE id = v_app.loan_product_id;

  -- Determine effective interest rate and calculation method
  -- Prefer product settings; fall back to system_config
  IF v_product.id IS NOT NULL THEN
    v_interest_rate := v_product.interest_rate;
    -- Normalise to annual rate for schedule math
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

  -- Map frequency → (periods per year, installment count, interval)
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

  -- Calculate EMI and total repayable
  IF v_calc_method = 'flat' THEN
    -- Flat: total interest = P × annual_rate × term_years, divide evenly
    v_total_repayable := v_app.amount_requested
      + (v_app.amount_requested * v_interest_rate / 100.0 * v_app.term_months / 12.0);
    v_emi := v_total_repayable / v_n_periods;
  ELSIF v_calc_method = 'equal_principal' THEN
    -- Equal principal: principal is fixed per period, interest on outstanding
    v_principal_pay   := ROUND(v_app.amount_requested / v_n_periods, 2);
    v_total_repayable := v_app.amount_requested; -- interest computed per installment below
  ELSE
    -- Reducing balance (annuity EMI)
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
      -- Reducing balance
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


-- ============================================================
-- Migration: 70_loan_comaker_optional_savings_req.sql
-- ============================================================

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


-- ============================================================
-- Migration: 71_fix_savings_deposit_rls.sql
-- ============================================================

-- Fix RLS on savings_deposit_requests so members can INSERT their own rows.
-- Split the FOR ALL policy into explicit INSERT + SELECT/UPDATE/DELETE policies.

DROP POLICY IF EXISTS savings_deposit_requests_self  ON savings_deposit_requests;
DROP POLICY IF EXISTS savings_deposit_requests_admin ON savings_deposit_requests;

-- Members can insert new requests for themselves
CREATE POLICY savings_deposit_requests_insert ON savings_deposit_requests
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Members can read and update (e.g. cancel) their own requests
CREATE POLICY savings_deposit_requests_self ON savings_deposit_requests
  FOR SELECT
  USING (user_id = auth.uid());

-- Admin / staff can do everything
CREATE POLICY savings_deposit_requests_admin ON savings_deposit_requests
  FOR ALL
  USING (get_user_role(auth.uid()) IN ('admin', 'staff'))
  WITH CHECK (get_user_role(auth.uid()) IN ('admin', 'staff'));

-- Same fix for savings_withdrawal_requests (same pattern, pre-empt the same bug)
DROP POLICY IF EXISTS savings_withdrawal_requests_self  ON savings_withdrawal_requests;
DROP POLICY IF EXISTS savings_withdrawal_requests_admin ON savings_withdrawal_requests;

CREATE POLICY savings_withdrawal_requests_insert ON savings_withdrawal_requests
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY savings_withdrawal_requests_self ON savings_withdrawal_requests
  FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY savings_withdrawal_requests_admin ON savings_withdrawal_requests
  FOR ALL
  USING (get_user_role(auth.uid()) IN ('admin', 'staff'))
  WITH CHECK (get_user_role(auth.uid()) IN ('admin', 'staff'));


-- ============================================================
-- Migration: 72_savings_interest_schedule.sql
-- ============================================================

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

      -- Log interest (average_daily_balance = ADB, not raw current balance)
      INSERT INTO savings_interest_logs (
        account_id, user_id, average_daily_balance, interest_amount,
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


-- ============================================================
-- Migration: 73_auto_share_on_member_role.sql
-- ============================================================

-- Migration 73: Auto-create one empty equity share when a user's role is set to 'member'
-- This fires when admin accepts a user (assigns member role via admin_update_user_role).
-- The share is created with paid_amount = 0 and status = 'active', so the member
-- is considered "pending" until they complete paying it.

CREATE OR REPLACE FUNCTION auto_create_equity_share_on_member()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_share_price  DECIMAL(15,2);
  v_share_count  INT;
BEGIN
  -- Only fire when role changes TO 'member'
  IF NEW.role <> 'member' OR OLD.role = 'member' THEN
    RETURN NEW;
  END IF;

  -- Check if the member already has any equity shares
  SELECT COUNT(*) INTO v_share_count
  FROM equity_shares
  WHERE user_id = NEW.id;

  IF v_share_count > 0 THEN
    RETURN NEW;
  END IF;

  -- Read share price from system_config (default 5000 if not found)
  SELECT COALESCE(config_value::DECIMAL, 5000) INTO v_share_price
  FROM system_config
  WHERE config_key = 'share_price'
  LIMIT 1;

  v_share_price := COALESCE(v_share_price, 5000);

  -- Create one empty share
  INSERT INTO equity_shares (user_id, share_number, target_amount, paid_amount, status)
  VALUES (NEW.id, 1, v_share_price, 0, 'active');

  RETURN NEW;
END;
$$;

-- Drop trigger if it already exists, then recreate
DROP TRIGGER IF EXISTS trg_auto_create_equity_share ON profiles;

CREATE TRIGGER trg_auto_create_equity_share
  AFTER UPDATE OF role ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION auto_create_equity_share_on_member();


-- ============================================================
-- Migration: 74_rename_tables.sql
-- ============================================================

-- Normalize table naming conventions:
--   deposit_requests          → equity_deposit_requests  (add domain prefix, mirrors savings_deposit_requests)
--   share_transfers           → equity_share_transfers   (align with equity_ prefix)
--   loan_repayment_schedule   → loan_repayment_schedules (pluralize, consistent with loan_repayments)

ALTER TABLE deposit_requests        RENAME TO equity_deposit_requests;
ALTER TABLE share_transfers         RENAME TO equity_share_transfers;
ALTER TABLE loan_repayment_schedule RENAME TO loan_repayment_schedules;

-- Rename indexes for clarity (constraints and FKs retain their original names automatically)
ALTER INDEX IF EXISTS idx_deposit_requests_status_created  RENAME TO idx_equity_deposit_requests_status_created;
ALTER INDEX IF EXISTS idx_deposit_requests_user_id         RENAME TO idx_equity_deposit_requests_user_id;
ALTER INDEX IF EXISTS idx_deposit_requests_reference_unique RENAME TO idx_equity_deposit_requests_reference_unique;
ALTER INDEX IF EXISTS idx_loan_repayment_schedule_loan     RENAME TO idx_loan_repayment_schedules_loan;


-- ============================================================
-- Migration: 75_fix_savings_interest_period.sql
-- ============================================================

-- Fix: interest period should start from first deposit, not account opening.
-- An account can sit at ₱0 for years before a member deposits; counting those
-- empty days as part of the period would make the ADB ≈ 0 even with a real balance.
-- If there are no contributions at all, skip the account (nothing to credit).

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
  v_first_deposit_ts  TIMESTAMPTZ;
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

    -- Period starts at last interest release, or the very first deposit.
    -- Never use account opening date — balance was ₱0 then.
    SELECT COALESCE(
      (SELECT created_at FROM savings_interest_logs
       WHERE account_id = v_account.id ORDER BY created_at DESC LIMIT 1),
      (SELECT MIN(contributed_at) FROM savings_contributions
       WHERE account_id = v_account.id)
    ) INTO v_period_start_ts;

    -- No contributions yet → nothing to credit, skip
    IF v_period_start_ts IS NULL THEN
      CONTINUE;
    END IF;

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

    -- Skip if ADB is effectively zero (nothing earned)
    IF v_adb <= 0 THEN
      CONTINUE;
    END IF;

    v_interest := ROUND(v_adb * (v_rate / 100.0), 2);

    IF v_interest <= 0 THEN
      CONTINUE;
    END IF;

    -- Credit interest to the account
    UPDATE savings_accounts
    SET balance = balance + v_interest, updated_at = now()
    WHERE id = v_account.id;

    -- Log the interest release
    INSERT INTO savings_interest_logs (
      account_id, user_id, average_daily_balance, interest_amount,
      period_start, period_end, released_by
    ) VALUES (
      v_account.id, v_account.user_id, v_adb, v_interest,
      v_period_start_ts::DATE, v_period_end_ts::DATE, 'system'
    )
    RETURNING id INTO v_log_id;

    -- Ledger entry
    INSERT INTO ledger_entries (
      user_id, entry_type, reference_id, reference_table,
      amount, direction, notes, created_by
    ) VALUES (
      v_account.user_id, 'savings_interest', v_log_id, 'savings_interest_logs',
      v_interest, 'credit', 'Savings interest credited', NULL
    );

  END LOOP;
END;
$$;


-- ============================================================
-- Migration: 76_savings_adb_rpc.sql
-- ============================================================

-- RPC: get_savings_adb
-- Computes Average Daily Balance server-side using database now().
-- Client device time is never used, preventing manipulation.
--
-- Rules:
--   - Period starts from first deposit approval (contributed_at), not account opening.
--   - After an interest release, period restarts from the release date.
--   - Only WHOLE completed 24h days are counted (floor, not fractional hours).
--   - On the deposit day itself (< 24h since approval): ADB = 0, period_days = 0.
--   - Each deposit's days_held is also floored, so it starts contributing the day after approval.

CREATE OR REPLACE FUNCTION get_savings_adb(p_account_id UUID)
RETURNS TABLE (adb DECIMAL(15,2), period_days INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account           savings_accounts%ROWTYPE;
  v_period_start      TIMESTAMPTZ;
  v_had_prior_interest BOOLEAN;
  v_period_days       INTEGER;
  v_balance_at_start  DECIMAL(15,2);
  v_adb               DECIMAL(15,2);
BEGIN
  SELECT * INTO v_account FROM savings_accounts WHERE id = p_account_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 0::DECIMAL(15,2), 0::INTEGER;
    RETURN;
  END IF;

  -- Period start = last interest release, or the first deposit approval time.
  -- Account opening date is never used — balance was ₱0 before the first deposit.
  SELECT created_at INTO v_period_start
  FROM savings_interest_logs
  WHERE account_id = p_account_id
  ORDER BY created_at DESC LIMIT 1;

  v_had_prior_interest := v_period_start IS NOT NULL;

  IF NOT v_had_prior_interest THEN
    SELECT MIN(contributed_at) INTO v_period_start
    FROM savings_contributions
    WHERE account_id = p_account_id;
  END IF;

  -- No deposits at all yet
  IF v_period_start IS NULL THEN
    RETURN QUERY SELECT 0::DECIMAL(15,2), 0::INTEGER;
    RETURN;
  END IF;

  -- Whole completed days since period start (floor — no fractional hours)
  v_period_days := FLOOR(EXTRACT(EPOCH FROM (now() - v_period_start)) / 86400)::INTEGER;

  -- Less than 24h since first deposit/last interest release
  IF v_period_days = 0 THEN
    RETURN QUERY SELECT 0::DECIMAL(15,2), 0::INTEGER;
    RETURN;
  END IF;

  -- Balance at start of period
  IF v_had_prior_interest THEN
    SELECT GREATEST(0,
      v_account.balance
      - COALESCE((
          SELECT SUM(sc.amount)
          FROM savings_contributions sc
          WHERE sc.account_id = p_account_id
            AND sc.contributed_at > v_period_start
        ), 0)
      + COALESCE((
          SELECT SUM(swr.amount)
          FROM savings_withdrawal_requests swr
          WHERE swr.account_id = p_account_id
            AND swr.status = 'approved'
            AND swr.reviewed_at > v_period_start
        ), 0)
    ) INTO v_balance_at_start;
  ELSE
    -- No prior interest: account had ₱0 before first deposit
    v_balance_at_start := 0;
  END IF;

  -- ADB = balance_at_start
  --     + SUM(deposit × floor_days_held / period_days)
  -- floor_days_held: whole days since each deposit was approved (server now())
  SELECT GREATEST(0,
    v_balance_at_start
    + COALESCE((
        SELECT SUM(
          sc.amount
          * FLOOR(EXTRACT(EPOCH FROM (now() - sc.contributed_at)) / 86400)::DECIMAL
          / v_period_days
        )
        FROM savings_contributions sc
        WHERE sc.account_id = p_account_id
          AND (NOT v_had_prior_interest OR sc.contributed_at > v_period_start)
      ), 0)
    - COALESCE((
        SELECT SUM(
          swr.amount
          * FLOOR(EXTRACT(EPOCH FROM (now() - swr.reviewed_at)) / 86400)::DECIMAL
          / v_period_days
        )
        FROM savings_withdrawal_requests swr
        WHERE swr.account_id = p_account_id
          AND swr.status = 'approved'
          AND (NOT v_had_prior_interest OR swr.reviewed_at > v_period_start)
      ), 0)
  ) INTO v_adb;

  RETURN QUERY SELECT ROUND(COALESCE(v_adb, 0), 2), v_period_days;
END;
$$;

-- Grant execute to authenticated users (RLS on savings_accounts still applies)
GRANT EXECUTE ON FUNCTION get_savings_adb(UUID) TO authenticated;


-- ============================================================
-- Migration: 77_consolidate_release_savings_interest.sql
-- ============================================================

-- Consolidate release_savings_interest into a single unambiguous function.
-- Drops both existing overloads (no-arg and BOOLEAN) then recreates one version
-- with p_force BOOLEAN DEFAULT false — callable as release_savings_interest() or
-- release_savings_interest(true).
--
-- Incorporates all fixes:
--   • Month-gating from migration 72 (cron runs monthly, self-gates by config)
--   • Period starts from first deposit, NOT account opening (migration 75 fix)
--   • Skip accounts with no deposits (nothing to credit)
--   • Idempotency: skip if already released today

DROP FUNCTION IF EXISTS release_savings_interest();
DROP FUNCTION IF EXISTS release_savings_interest(BOOLEAN);

CREATE OR REPLACE FUNCTION release_savings_interest(p_force BOOLEAN DEFAULT false)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rate               DECIMAL(5,2);
  v_release_months     TEXT;
  v_current_month      INT;
  v_period_end_ts      TIMESTAMPTZ;
  v_period_start_ts    TIMESTAMPTZ;
  v_period_days        DECIMAL(15,6);
  v_account            savings_accounts%ROWTYPE;
  v_had_prior_interest BOOLEAN;
  v_balance_at_start   DECIMAL(15,2);
  v_adb                DECIMAL(15,2);
  v_interest           DECIMAL(15,2);
BEGIN
  -- Self-gate: if not forced, only run in configured release months
  IF NOT p_force THEN
    SELECT COALESCE(config_value, '6,12') INTO v_release_months
    FROM system_config WHERE config_key = 'savings_interest_release_months';

    v_current_month := EXTRACT(MONTH FROM now())::INT;

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
    -- Idempotency: skip if already released today for this account
    IF EXISTS (
      SELECT 1 FROM savings_interest_logs
      WHERE account_id = v_account.id
        AND period_end = v_period_end_ts::DATE
    ) THEN
      CONTINUE;
    END IF;

    -- Period start = last interest release, or the first deposit approval date.
    -- NEVER use account opened_at — the account had ₱0 before the first deposit.
    SELECT created_at INTO v_period_start_ts
    FROM savings_interest_logs
    WHERE account_id = v_account.id
    ORDER BY created_at DESC LIMIT 1;

    v_had_prior_interest := v_period_start_ts IS NOT NULL;

    IF NOT v_had_prior_interest THEN
      SELECT MIN(contributed_at) INTO v_period_start_ts
      FROM savings_contributions
      WHERE account_id = v_account.id;
    END IF;

    -- No deposits yet — nothing to credit
    IF v_period_start_ts IS NULL THEN
      CONTINUE;
    END IF;

    v_period_days := GREATEST(1, EXTRACT(EPOCH FROM (v_period_end_ts - v_period_start_ts)) / 86400.0);

    -- Balance at start of period
    IF v_had_prior_interest THEN
      SELECT GREATEST(0,
        v_account.balance
        - COALESCE((
            SELECT SUM(sc.amount) FROM savings_contributions sc
            WHERE sc.account_id = v_account.id AND sc.contributed_at > v_period_start_ts
          ), 0)
        + COALESCE((
            SELECT SUM(swr.amount) FROM savings_withdrawal_requests swr
            WHERE swr.account_id = v_account.id AND swr.status = 'approved'
              AND swr.reviewed_at > v_period_start_ts
          ), 0)
      ) INTO v_balance_at_start;
    ELSE
      v_balance_at_start := 0; -- account had ₱0 before first deposit
    END IF;

    -- ADB = balance_at_start + weighted deposits − weighted withdrawals
    SELECT GREATEST(0,
      v_balance_at_start
      + COALESCE((
          SELECT SUM(
            sc.amount
            * GREATEST(0, EXTRACT(EPOCH FROM (v_period_end_ts - sc.contributed_at)) / 86400.0)
            / v_period_days
          )
          FROM savings_contributions sc
          WHERE sc.account_id = v_account.id
            AND (NOT v_had_prior_interest OR sc.contributed_at > v_period_start_ts)
        ), 0)
      - COALESCE((
          SELECT SUM(
            swr.amount
            * GREATEST(0, EXTRACT(EPOCH FROM (v_period_end_ts - swr.reviewed_at)) / 86400.0)
            / v_period_days
          )
          FROM savings_withdrawal_requests swr
          WHERE swr.account_id = v_account.id AND swr.status = 'approved'
            AND (NOT v_had_prior_interest OR swr.reviewed_at > v_period_start_ts)
        ), 0)
    ) INTO v_adb;

    IF v_adb <= 0 THEN CONTINUE; END IF;

    v_interest := ROUND(v_adb * (v_rate / 100.0), 2);

    IF v_interest <= 0 THEN CONTINUE; END IF;

    -- Credit interest to balance
    UPDATE savings_accounts
    SET balance = balance + v_interest, updated_at = now()
    WHERE id = v_account.id;

    -- Log the release
    INSERT INTO savings_interest_logs (
      account_id, user_id, average_daily_balance, interest_amount,
      period_start, period_end, released_by
    ) VALUES (
      v_account.id, v_account.user_id,
      v_adb, v_interest,
      v_period_start_ts::DATE, v_period_end_ts::DATE,
      CASE WHEN p_force THEN 'admin' ELSE 'system' END
    );

    -- Ledger entry
    INSERT INTO ledger_entries (
      user_id, entry_type, reference_id, reference_table, amount, direction, notes, created_by
    )
    SELECT
      v_account.user_id, 'savings_interest', sil.id, 'savings_interest_logs',
      v_interest, 'credit', 'Savings interest credited', NULL
    FROM savings_interest_logs sil
    WHERE sil.account_id = v_account.id
    ORDER BY sil.created_at DESC LIMIT 1;

  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION release_savings_interest(BOOLEAN) TO authenticated;


-- ============================================================
-- Migration: 78_savings_adb_with_accrued.sql
-- ============================================================

-- Extend get_savings_adb to also return accrued_interest.
-- accrued_interest = ADB × rate% × (days_held / total_period_days)
-- This grows by ~₱2.05/day for ₱15,000 at 2.5% over 6 months.
-- The actual balance is never touched — this is display-only until the 6-month release.

DROP FUNCTION IF EXISTS get_savings_adb(UUID);

CREATE OR REPLACE FUNCTION get_savings_adb(p_account_id UUID)
RETURNS TABLE (adb DECIMAL(15,2), period_days INTEGER, accrued_interest DECIMAL(15,2))
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account             savings_accounts%ROWTYPE;
  v_period_start        TIMESTAMPTZ;
  v_had_prior_interest  BOOLEAN;
  v_period_days         INTEGER;
  v_balance_at_start    DECIMAL(15,2);
  v_adb                 DECIMAL(15,2);
  v_rate                DECIMAL(5,2);
  v_period_months       INT;
  v_total_period_days   DECIMAL(10,4);
  v_accrued             DECIMAL(15,2);
BEGIN
  SELECT * INTO v_account FROM savings_accounts WHERE id = p_account_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 0::DECIMAL(15,2), 0::INTEGER, 0::DECIMAL(15,2);
    RETURN;
  END IF;

  -- Period start = last interest release, or first deposit approval.
  SELECT created_at INTO v_period_start
  FROM savings_interest_logs
  WHERE account_id = p_account_id
  ORDER BY created_at DESC LIMIT 1;

  v_had_prior_interest := v_period_start IS NOT NULL;

  IF NOT v_had_prior_interest THEN
    SELECT MIN(contributed_at) INTO v_period_start
    FROM savings_contributions
    WHERE account_id = p_account_id;
  END IF;

  IF v_period_start IS NULL THEN
    RETURN QUERY SELECT 0::DECIMAL(15,2), 0::INTEGER, 0::DECIMAL(15,2);
    RETURN;
  END IF;

  -- Whole completed days only
  v_period_days := FLOOR(EXTRACT(EPOCH FROM (now() - v_period_start)) / 86400)::INTEGER;

  IF v_period_days = 0 THEN
    RETURN QUERY SELECT 0::DECIMAL(15,2), 0::INTEGER, 0::DECIMAL(15,2);
    RETURN;
  END IF;

  -- Balance at start of period
  IF v_had_prior_interest THEN
    SELECT GREATEST(0,
      v_account.balance
      - COALESCE((SELECT SUM(sc.amount) FROM savings_contributions sc
          WHERE sc.account_id = p_account_id AND sc.contributed_at > v_period_start), 0)
      + COALESCE((SELECT SUM(swr.amount) FROM savings_withdrawal_requests swr
          WHERE swr.account_id = p_account_id AND swr.status = 'approved'
            AND swr.reviewed_at > v_period_start), 0)
    ) INTO v_balance_at_start;
  ELSE
    v_balance_at_start := 0;
  END IF;

  -- ADB (whole days)
  SELECT GREATEST(0,
    v_balance_at_start
    + COALESCE((
        SELECT SUM(
          sc.amount
          * FLOOR(EXTRACT(EPOCH FROM (now() - sc.contributed_at)) / 86400)::DECIMAL
          / v_period_days
        )
        FROM savings_contributions sc
        WHERE sc.account_id = p_account_id
          AND (NOT v_had_prior_interest OR sc.contributed_at > v_period_start)
      ), 0)
    - COALESCE((
        SELECT SUM(
          swr.amount
          * FLOOR(EXTRACT(EPOCH FROM (now() - swr.reviewed_at)) / 86400)::DECIMAL
          / v_period_days
        )
        FROM savings_withdrawal_requests swr
        WHERE swr.account_id = p_account_id AND swr.status = 'approved'
          AND (NOT v_had_prior_interest OR swr.reviewed_at > v_period_start)
      ), 0)
  ) INTO v_adb;

  -- Interest rate and period length from config
  SELECT COALESCE(config_value::DECIMAL, 2.5) INTO v_rate
  FROM system_config WHERE config_key = 'savings_interest_rate';

  SELECT COALESCE(config_value::INT, 6) INTO v_period_months
  FROM system_config WHERE config_key = 'savings_interest_period_months';

  -- Total days in the interest period (e.g. 6 months = 182.5 days)
  v_total_period_days := v_period_months * (365.0 / 12.0);

  -- Accrued interest so far = ADB × rate% × (days_held / total_period_days)
  -- Grows linearly each day; reaches full interest (e.g. ₱375) at period end.
  v_accrued := ROUND(v_adb * (v_rate / 100.0) * (v_period_days::DECIMAL / v_total_period_days), 2);

  RETURN QUERY SELECT ROUND(COALESCE(v_adb, 0), 2), v_period_days, COALESCE(v_accrued, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION get_savings_adb(UUID) TO authenticated;


-- ============================================================
-- Migration: 79_savings_deposits_breakdown.sql
-- ============================================================

-- Returns a per-deposit breakdown for the current interest period.
-- Each row shows: when it was approved, amount, days held, and its individual accrued interest.
-- All time calculations use DB now() — immune to client device clock.

CREATE OR REPLACE FUNCTION get_savings_deposits_breakdown(p_account_id UUID)
RETURNS TABLE (
  contribution_id   UUID,
  contributed_at    TIMESTAMPTZ,
  amount            DECIMAL(15,2),
  days_held         INTEGER,
  accrued_interest  DECIMAL(15,2)
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_period_start      TIMESTAMPTZ;
  v_had_prior_interest BOOLEAN;
  v_period_days       INTEGER;
  v_rate              DECIMAL(5,2);
  v_period_months     INT;
  v_total_period_days DECIMAL(10,4);
BEGIN
  -- Period start = last interest release, or first deposit approval
  SELECT created_at INTO v_period_start
  FROM savings_interest_logs
  WHERE account_id = p_account_id
  ORDER BY created_at DESC LIMIT 1;

  v_had_prior_interest := v_period_start IS NOT NULL;

  IF NOT v_had_prior_interest THEN
    SELECT MIN(sc2.contributed_at) INTO v_period_start
    FROM savings_contributions sc2
    WHERE sc2.account_id = p_account_id;
  END IF;

  IF v_period_start IS NULL THEN RETURN; END IF;

  v_period_days := FLOOR(EXTRACT(EPOCH FROM (now() - v_period_start)) / 86400)::INTEGER;
  IF v_period_days = 0 THEN RETURN; END IF;

  SELECT COALESCE(config_value::DECIMAL, 2.5) INTO v_rate
  FROM system_config WHERE config_key = 'savings_interest_rate';

  SELECT COALESCE(config_value::INT, 6) INTO v_period_months
  FROM system_config WHERE config_key = 'savings_interest_period_months';

  v_total_period_days := v_period_months * (365.0 / 12.0);

  -- Per-deposit breakdown
  RETURN QUERY
  SELECT
    sc.id,
    sc.contributed_at,
    sc.amount,
    FLOOR(EXTRACT(EPOCH FROM (now() - sc.contributed_at)) / 86400)::INTEGER AS days_held,
    ROUND(
      sc.amount
      * (v_rate / 100.0)
      * (FLOOR(EXTRACT(EPOCH FROM (now() - sc.contributed_at)) / 86400)::DECIMAL / v_total_period_days)
    , 2) AS accrued_interest
  FROM savings_contributions sc
  WHERE sc.account_id = p_account_id
    AND (NOT v_had_prior_interest OR sc.contributed_at > v_period_start)
  ORDER BY sc.contributed_at ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION get_savings_deposits_breakdown(UUID) TO authenticated;


-- ============================================================
-- Migration: 80_savings_breakdown_add_reference.sql
-- ============================================================

-- Add reference and request_id to get_savings_deposits_breakdown
-- so the UI can show the reference number and link to the deposit request.

DROP FUNCTION IF EXISTS get_savings_deposits_breakdown(UUID);

CREATE OR REPLACE FUNCTION get_savings_deposits_breakdown(p_account_id UUID)
RETURNS TABLE (
  contribution_id   UUID,
  request_id        UUID,
  contributed_at    TIMESTAMPTZ,
  amount            DECIMAL(15,2),
  days_held         INTEGER,
  accrued_interest  DECIMAL(15,2),
  reference         VARCHAR
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_period_start       TIMESTAMPTZ;
  v_had_prior_interest BOOLEAN;
  v_period_days        INTEGER;
  v_rate               DECIMAL(5,2);
  v_period_months      INT;
  v_total_period_days  DECIMAL(10,4);
BEGIN
  -- Period start = last interest release, or first deposit approval
  SELECT created_at INTO v_period_start
  FROM savings_interest_logs
  WHERE account_id = p_account_id
  ORDER BY created_at DESC LIMIT 1;

  v_had_prior_interest := v_period_start IS NOT NULL;

  IF NOT v_had_prior_interest THEN
    SELECT MIN(sc2.contributed_at) INTO v_period_start
    FROM savings_contributions sc2
    WHERE sc2.account_id = p_account_id;
  END IF;

  IF v_period_start IS NULL THEN RETURN; END IF;

  v_period_days := FLOOR(EXTRACT(EPOCH FROM (now() - v_period_start)) / 86400)::INTEGER;
  IF v_period_days = 0 THEN RETURN; END IF;

  SELECT COALESCE(config_value::DECIMAL, 2.5) INTO v_rate
  FROM system_config WHERE config_key = 'savings_interest_rate';

  SELECT COALESCE(config_value::INT, 6) INTO v_period_months
  FROM system_config WHERE config_key = 'savings_interest_period_months';

  v_total_period_days := v_period_months * (365.0 / 12.0);

  RETURN QUERY
  SELECT
    sc.id                                                               AS contribution_id,
    sc.request_id                                                       AS request_id,
    sc.contributed_at,
    sc.amount,
    FLOOR(EXTRACT(EPOCH FROM (now() - sc.contributed_at)) / 86400)::INTEGER AS days_held,
    ROUND(
      sc.amount
      * (v_rate / 100.0)
      * (FLOOR(EXTRACT(EPOCH FROM (now() - sc.contributed_at)) / 86400)::DECIMAL / v_total_period_days)
    , 2)                                                                AS accrued_interest,
    sdr.reference                                                       AS reference
  FROM savings_contributions sc
  LEFT JOIN savings_deposit_requests sdr ON sdr.id = sc.request_id
  WHERE sc.account_id = p_account_id
    AND (NOT v_had_prior_interest OR sc.contributed_at > v_period_start)
  ORDER BY sc.contributed_at ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION get_savings_deposits_breakdown(UUID) TO authenticated;


-- ============================================================
-- Migration: 81_savings_breakdown_sort_desc.sql
-- ============================================================

-- Sort deposits breakdown most-recent first.

DROP FUNCTION IF EXISTS get_savings_deposits_breakdown(UUID);

CREATE OR REPLACE FUNCTION get_savings_deposits_breakdown(p_account_id UUID)
RETURNS TABLE (
  contribution_id   UUID,
  request_id        UUID,
  contributed_at    TIMESTAMPTZ,
  amount            DECIMAL(15,2),
  days_held         INTEGER,
  accrued_interest  DECIMAL(15,2),
  reference         VARCHAR
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_period_start       TIMESTAMPTZ;
  v_had_prior_interest BOOLEAN;
  v_period_days        INTEGER;
  v_rate               DECIMAL(5,2);
  v_period_months      INT;
  v_total_period_days  DECIMAL(10,4);
BEGIN
  SELECT created_at INTO v_period_start
  FROM savings_interest_logs
  WHERE account_id = p_account_id
  ORDER BY created_at DESC LIMIT 1;

  v_had_prior_interest := v_period_start IS NOT NULL;

  IF NOT v_had_prior_interest THEN
    SELECT MIN(sc2.contributed_at) INTO v_period_start
    FROM savings_contributions sc2
    WHERE sc2.account_id = p_account_id;
  END IF;

  IF v_period_start IS NULL THEN RETURN; END IF;

  v_period_days := FLOOR(EXTRACT(EPOCH FROM (now() - v_period_start)) / 86400)::INTEGER;
  IF v_period_days = 0 THEN RETURN; END IF;

  SELECT COALESCE(config_value::DECIMAL, 2.5) INTO v_rate
  FROM system_config WHERE config_key = 'savings_interest_rate';

  SELECT COALESCE(config_value::INT, 6) INTO v_period_months
  FROM system_config WHERE config_key = 'savings_interest_period_months';

  v_total_period_days := v_period_months * (365.0 / 12.0);

  RETURN QUERY
  SELECT
    sc.id                                                                       AS contribution_id,
    sc.request_id                                                               AS request_id,
    sc.contributed_at,
    sc.amount,
    FLOOR(EXTRACT(EPOCH FROM (now() - sc.contributed_at)) / 86400)::INTEGER    AS days_held,
    ROUND(
      sc.amount
      * (v_rate / 100.0)
      * (FLOOR(EXTRACT(EPOCH FROM (now() - sc.contributed_at)) / 86400)::DECIMAL / v_total_period_days)
    , 2)                                                                        AS accrued_interest,
    sdr.reference                                                               AS reference
  FROM savings_contributions sc
  LEFT JOIN savings_deposit_requests sdr ON sdr.id = sc.request_id
  WHERE sc.account_id = p_account_id
    AND (NOT v_had_prior_interest OR sc.contributed_at > v_period_start)
  ORDER BY sc.contributed_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION get_savings_deposits_breakdown(UUID) TO authenticated;


-- ============================================================
-- Migration: 82_loan_approval_savings_gate.sql
-- ============================================================

-- Fix admin_approve_loan_application after table rename (loan_repayment_schedule → loan_repayment_schedules).
-- Add savings balance gate: if savings_required_for_loan = true in system_config,
-- the member must have an active savings account with balance >= loan_min_savings_balance.

INSERT INTO system_config (config_key, config_value, value_type, description)
VALUES ('loan_min_savings_balance', '500', 'number', 'Minimum savings balance required before a loan can be approved')
ON CONFLICT (config_key) DO NOTHING;

CREATE OR REPLACE FUNCTION admin_approve_loan_application(p_application_id UUID)
RETURNS UUID AS $$
DECLARE
  v_app                  loan_applications%ROWTYPE;
  v_product              loan_products%ROWTYPE;
  v_loan_id              UUID;
  v_interest_rate        DECIMAL;
  v_calc_method          VARCHAR;
  v_frequency            TEXT;
  v_n_periods            INT;
  v_periods_per_yr       DECIMAL;
  v_r                    DECIMAL;
  v_emi                  DECIMAL;
  v_outstanding          DECIMAL;
  v_principal_pay        DECIMAL;
  v_interest_pay         DECIMAL;
  v_total_repayable      DECIMAL;
  v_interval             INTERVAL;
  v_co_maker_count       INT;
  v_pending_count        INT;
  v_declined_count       INT;
  v_savings_required     BOOLEAN;
  v_savings_balance      DECIMAL;
  v_min_savings          DECIMAL;
  i                      INT;
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin', 'staff') THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  SELECT * INTO v_app FROM loan_applications WHERE id = p_application_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Application not found'; END IF;
  IF v_app.status NOT IN ('submitted', 'under_review') THEN
    RAISE EXCEPTION 'Application is not in a reviewable state';
  END IF;

  -- Co-maker enforcement (optional; if any present, all must confirm)
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

  -- Savings balance gate (only when savings_required_for_loan = true)
  SELECT COALESCE(config_value, 'false') = 'true' INTO v_savings_required
    FROM system_config WHERE config_key = 'savings_required_for_loan';

  IF v_savings_required THEN
    SELECT COALESCE(config_value::DECIMAL, 500) INTO v_min_savings
      FROM system_config WHERE config_key = 'loan_min_savings_balance';
    SELECT COALESCE(balance, 0) INTO v_savings_balance
      FROM savings_accounts WHERE user_id = v_app.user_id AND status = 'active';
    IF v_savings_balance < v_min_savings THEN
      RAISE EXCEPTION 'Cannot approve: member savings balance (₱%) is below the required minimum of ₱%',
        v_savings_balance, v_min_savings;
    END IF;
  END IF;

  -- Load loan product
  SELECT * INTO v_product FROM loan_products WHERE id = v_app.loan_product_id;

  -- Determine interest rate, method, frequency
  IF v_product.id IS NOT NULL THEN
    v_interest_rate := v_product.interest_rate;
    IF v_product.interest_rate_period = 'monthly' THEN
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
    WHEN 'weekly' THEN
      v_periods_per_yr := 52;
      v_n_periods      := v_app.term_months * 4;
      v_interval       := '7 days'::INTERVAL;
    WHEN 'bi_weekly' THEN
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

  -- Generate repayment schedule (uses renamed table loan_repayment_schedules)
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

    INSERT INTO loan_repayment_schedules (
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


-- ============================================================
-- Migration: 83_fix_delete_share_fk.sql
-- ============================================================

-- Fix admin_delete_share: delete equity_contributions before deleting the share.
-- The previous version blocked on paid_amount > 0 but didn't clean up contribution
-- rows, causing a FK constraint violation even when the share had no real payments.

CREATE OR REPLACE FUNCTION admin_delete_share(p_share_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT;
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin', 'staff') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  -- Block deletion if any deposit is pending or approved against this share
  SELECT COUNT(*) INTO v_count
  FROM equity_deposit_requests
  WHERE share_id = p_share_id
    AND status IN ('pending', 'approved');

  IF v_count > 0 THEN
    RAISE EXCEPTION 'This share has % deposit request(s) that are pending or approved and cannot be removed.', v_count;
  END IF;

  -- Block if real money has been recorded
  IF EXISTS (SELECT 1 FROM equity_shares WHERE id = p_share_id AND paid_amount > 0) THEN
    RAISE EXCEPTION 'This share has recorded contributions and cannot be removed.';
  END IF;

  -- Remove any orphaned contribution rows before deleting the share
  DELETE FROM equity_contributions WHERE share_id = p_share_id;

  DELETE FROM equity_shares WHERE id = p_share_id;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_delete_share(UUID) TO authenticated;


-- ============================================================
-- Migration: 84_auto_share_on_register.sql
-- ============================================================

-- Migration 84: Also auto-create equity share on INSERT into profiles when role = 'member'
-- Migration 73 handles role changes (UPDATE), but new registrations are direct inserts
-- with role = 'member', so the UPDATE trigger never fires for them.

CREATE OR REPLACE FUNCTION auto_create_equity_share_on_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_share_price DECIMAL(15,2);
BEGIN
  IF NEW.role <> 'member' THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(config_value::DECIMAL, 5000) INTO v_share_price
  FROM system_config
  WHERE config_key = 'share_price'
  LIMIT 1;

  v_share_price := COALESCE(v_share_price, 5000);

  INSERT INTO equity_shares (user_id, share_number, target_amount, paid_amount, status)
  VALUES (NEW.id, 1, v_share_price, 0, 'active');

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_create_equity_share_on_insert ON profiles;

CREATE TRIGGER trg_auto_create_equity_share_on_insert
  AFTER INSERT ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION auto_create_equity_share_on_insert();


-- ============================================================
-- Migration: 85_bulk_import.sql
-- ============================================================

-- Migration 85: Bulk import support for admin bypass
-- 1. Make loans.application_id nullable (bulk-imported loans have no application)
-- 2. RPC to record a contribution directly and keep share balance in sync

ALTER TABLE loans ALTER COLUMN application_id DROP NOT NULL;

-- Direct contribution recorder: inserts contribution and syncs share paid_amount/status.
-- Used by the admin bulk-import tool to bypass the deposit-request approval flow.
CREATE OR REPLACE FUNCTION admin_record_contribution_direct(
  p_user_id       UUID,
  p_share_id      UUID,
  p_amount        DECIMAL(15,2),
  p_payment_method VARCHAR,
  p_reference     VARCHAR,
  p_date          TIMESTAMPTZ,
  p_recorded_by   UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_paid   DECIMAL(15,2);
  v_target DECIMAL(15,2);
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin', 'staff') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  INSERT INTO equity_contributions
    (user_id, share_id, amount, payment_method, reference, recorded_by, contribution_at)
  VALUES
    (p_user_id, p_share_id, p_amount, p_payment_method, p_reference, p_recorded_by, p_date);

  SELECT COALESCE(SUM(amount), 0) INTO v_paid
  FROM equity_contributions WHERE share_id = p_share_id;

  SELECT target_amount INTO v_target FROM equity_shares WHERE id = p_share_id;

  UPDATE equity_shares
  SET paid_amount  = v_paid,
      status       = CASE WHEN v_paid >= v_target THEN 'completed' ELSE status END,
      completed_at = CASE WHEN v_paid >= v_target AND completed_at IS NULL THEN now() ELSE completed_at END,
      updated_at   = now()
  WHERE id = p_share_id;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_record_contribution_direct(UUID, UUID, DECIMAL, VARCHAR, VARCHAR, TIMESTAMPTZ, UUID) TO authenticated;


-- ============================================================
-- Migration: 86_bulk_import_savings.sql
-- ============================================================

-- Migration 86: Direct savings recorder for admin bulk import
-- Creates or reuses a member's savings_account, inserts a contribution,
-- and keeps savings_accounts.balance in sync.

CREATE OR REPLACE FUNCTION admin_record_savings_direct(
  p_user_id       UUID,
  p_amount        DECIMAL(15,2),
  p_payment_method VARCHAR,
  p_reference     VARCHAR,
  p_date          TIMESTAMPTZ,
  p_recorded_by   UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id UUID;
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin', 'staff') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  -- Get or create savings account for the member
  SELECT id INTO v_account_id FROM savings_accounts WHERE user_id = p_user_id;

  IF v_account_id IS NULL THEN
    INSERT INTO savings_accounts (user_id, balance, status)
    VALUES (p_user_id, 0, 'active')
    RETURNING id INTO v_account_id;
  END IF;

  -- Record the contribution
  INSERT INTO savings_contributions
    (account_id, user_id, request_id, amount, payment_method, reference, recorded_by, contributed_at)
  VALUES
    (v_account_id, p_user_id, NULL, p_amount, p_payment_method, p_reference, p_recorded_by, p_date);

  -- Update account balance
  UPDATE savings_accounts
  SET balance     = balance + p_amount,
      updated_at  = now()
  WHERE id = v_account_id;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_record_savings_direct(UUID, DECIMAL, VARCHAR, VARCHAR, TIMESTAMPTZ, UUID) TO authenticated;


-- ============================================================
-- Migration: 87_member_name_fields.sql
-- ============================================================

-- Add first_name, middle_name, last_name to profiles
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS first_name VARCHAR,
  ADD COLUMN IF NOT EXISTS middle_name VARCHAR,
  ADD COLUMN IF NOT EXISTS last_name VARCHAR;

-- Update handle_new_user to populate name fields from metadata
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, first_name, middle_name, last_name, phone, role, account_status, employee_id)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', 'Unknown'),
    NEW.raw_user_meta_data->>'first_name',
    NEW.raw_user_meta_data->>'middle_name',
    NEW.raw_user_meta_data->>'last_name',
    NEW.raw_user_meta_data->>'phone',
    'member',
    'active',
    NEW.raw_user_meta_data->>'employee_id'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- RPC to check email availability (checks auth.users, requires service role in app context)
-- Called from admin UI to validate email before creating a member
CREATE OR REPLACE FUNCTION is_email_available(p_email TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN NOT EXISTS (
    SELECT 1 FROM auth.users WHERE email = lower(trim(p_email))
  );
END;
$$;

GRANT EXECUTE ON FUNCTION is_email_available(TEXT) TO authenticated;


-- ============================================================
-- Migration: 88_add_requires_onboarding.sql
-- ============================================================

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS requires_onboarding BOOLEAN NOT NULL DEFAULT false;


-- ============================================================
-- Migration: 89_fix_staff_post_deposit_overflow.sql
-- ============================================================

-- Migration 89: Redefine staff_post_deposit with proper overflow cascade.
-- Previous version dumped the full amount onto the current share with no overflow
-- logic, causing overpayment on a single share instead of auto-opening new ones.

DROP FUNCTION IF EXISTS staff_post_deposit(UUID, DECIMAL, VARCHAR, TIMESTAMPTZ, VARCHAR, UUID);

CREATE OR REPLACE FUNCTION staff_post_deposit(
  p_user_id      UUID,
  p_amount       DECIMAL(15,2),
  p_destination  VARCHAR,   -- 'shares' or 'savings'
  p_date         TIMESTAMPTZ,
  p_reference    VARCHAR,
  p_recorded_by  UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_share        equity_shares%ROWTYPE;
  v_remaining    DECIMAL(15,2);
  v_to_credit    DECIMAL(15,2);
  v_leftover     DECIMAL(15,2);
  v_share_price  DECIMAL(15,2);
  v_max_shares   INT;
  v_share_count  INT;
  v_next_number  INT;
  v_new_share_id UUID;
  v_savings_id   UUID;
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin', 'staff') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;

  -- ── SAVINGS path ─────────────────────────────────────────────────────────────
  IF p_destination = 'savings' THEN
    SELECT id INTO v_savings_id
    FROM savings_accounts
    WHERE user_id = p_user_id
    LIMIT 1;

    IF v_savings_id IS NULL THEN
      RAISE EXCEPTION 'No savings account found for this member';
    END IF;

    INSERT INTO savings_deposit_requests
      (user_id, savings_account_id, amount, payment_method, reference, status,
       reviewed_by, reviewed_at, created_at, updated_at)
    VALUES
      (p_user_id, v_savings_id, p_amount, 'cash', p_reference, 'approved',
       p_recorded_by, p_date, p_date, p_date);

    RETURN;
  END IF;

  -- ── SHARES path with overflow cascade ────────────────────────────────────────
  v_leftover := p_amount;

  -- Walk existing in-progress shares in order
  FOR v_share IN
    SELECT * FROM equity_shares
    WHERE user_id = p_user_id
      AND status = 'in_progress'
    ORDER BY share_number ASC
  LOOP
    EXIT WHEN v_leftover <= 0;

    v_remaining := v_share.target_amount - v_share.paid_amount;
    v_to_credit := LEAST(v_leftover, v_remaining);

    INSERT INTO equity_contributions
      (user_id, share_id, amount, payment_method, reference, recorded_by, contribution_at)
    VALUES
      (p_user_id, v_share.id, v_to_credit, 'cash', p_reference, p_recorded_by, p_date);

    v_leftover := v_leftover - v_to_credit;
  END LOOP;

  -- Auto-open new shares for any remaining amount
  IF v_leftover > 0 THEN
    SELECT COALESCE(config_value::DECIMAL, 5000) INTO v_share_price
    FROM system_config WHERE config_key = 'share_price';

    SELECT COALESCE(config_value::INT, 10) INTO v_max_shares
    FROM system_config WHERE config_key = 'max_shares_per_member';

    LOOP
      EXIT WHEN v_leftover <= 0;

      SELECT COUNT(*) INTO v_share_count
      FROM equity_shares
      WHERE user_id = p_user_id AND status != 'cancelled';

      EXIT WHEN v_share_count >= v_max_shares;

      SELECT COALESCE(MAX(share_number), 0) + 1 INTO v_next_number
      FROM equity_shares WHERE user_id = p_user_id;

      INSERT INTO equity_shares (user_id, share_number, target_amount)
      VALUES (p_user_id, v_next_number, v_share_price)
      RETURNING id INTO v_new_share_id;

      v_to_credit := LEAST(v_leftover, v_share_price);

      INSERT INTO equity_contributions
        (user_id, share_id, amount, payment_method, reference, recorded_by, contribution_at)
      VALUES
        (p_user_id, v_new_share_id, v_to_credit, 'cash', p_reference, p_recorded_by, p_date);

      v_leftover := v_leftover - v_to_credit;
    END LOOP;

    -- Max shares reached: credit remainder to last share (accounting integrity)
    IF v_leftover > 0 THEN
      SELECT id INTO v_new_share_id
      FROM equity_shares
      WHERE user_id = p_user_id AND status != 'cancelled'
      ORDER BY share_number DESC
      LIMIT 1;

      INSERT INTO equity_contributions
        (user_id, share_id, amount, payment_method, reference, recorded_by, contribution_at)
      VALUES
        (p_user_id, v_new_share_id, v_leftover, 'cash', p_reference, p_recorded_by, p_date);
    END IF;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION staff_post_deposit(UUID, DECIMAL, VARCHAR, TIMESTAMPTZ, VARCHAR, UUID) TO authenticated;



-- ============================================================
-- Migration: 90_pos_branch_sync.sql
-- ============================================================

-- Add pos_branch_id to branches for POS sync matching
ALTER TABLE branches
  ADD COLUMN IF NOT EXISTS pos_branch_id VARCHAR UNIQUE;
