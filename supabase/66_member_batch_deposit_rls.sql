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
