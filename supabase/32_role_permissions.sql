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
