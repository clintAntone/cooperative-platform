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
