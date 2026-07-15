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
