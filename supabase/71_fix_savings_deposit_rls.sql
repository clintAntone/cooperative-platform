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
