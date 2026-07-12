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
-- Reports / members
CREATE POLICY IF NOT EXISTS profiles_board_read ON profiles
  FOR SELECT USING (get_user_role(auth.uid()) = 'board');

CREATE POLICY IF NOT EXISTS loans_board_read ON loans
  FOR SELECT USING (get_user_role(auth.uid()) = 'board');

CREATE POLICY IF NOT EXISTS loan_applications_board_read ON loan_applications
  FOR SELECT USING (get_user_role(auth.uid()) = 'board');

CREATE POLICY IF NOT EXISTS savings_accounts_board_read ON savings_accounts
  FOR SELECT USING (get_user_role(auth.uid()) = 'board');

CREATE POLICY IF NOT EXISTS branch_income_board_read ON branch_income
  FOR SELECT USING (get_user_role(auth.uid()) = 'board');

CREATE POLICY IF NOT EXISTS branch_expenses_board_read ON branch_expenses
  FOR SELECT USING (get_user_role(auth.uid()) = 'board');
