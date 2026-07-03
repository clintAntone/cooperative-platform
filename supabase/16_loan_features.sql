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
