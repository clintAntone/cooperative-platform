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
