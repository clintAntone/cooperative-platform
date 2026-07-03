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
