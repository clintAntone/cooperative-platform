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
