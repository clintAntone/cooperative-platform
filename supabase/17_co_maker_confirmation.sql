-- Add status tracking to loan_co_makers
ALTER TABLE loan_co_makers
  ADD COLUMN IF NOT EXISTS status VARCHAR CHECK (status IN ('pending', 'confirmed', 'declined')) NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS responded_at TIMESTAMPTZ;

-- Allow co-maker to update their own status
CREATE POLICY co_makers_respond ON loan_co_makers FOR UPDATE
  USING (co_maker_user_id = auth.uid())
  WITH CHECK (co_maker_user_id = auth.uid());

-- RPC: co-maker responds to their request
CREATE OR REPLACE FUNCTION respond_to_co_maker_request(
  p_application_id UUID,
  p_status         VARCHAR
)
RETURNS VOID AS $$
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
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RPC: fetch co-maker requests for the current user (with applicant details)
CREATE OR REPLACE FUNCTION get_my_co_maker_requests()
RETURNS TABLE(
  id               UUID,
  application_id   UUID,
  status           VARCHAR,
  responded_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ,
  applicant_name   VARCHAR,
  amount_requested DECIMAL,
  term_months      INT,
  purpose          TEXT,
  application_status VARCHAR
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    lcm.id,
    lcm.application_id,
    lcm.status,
    lcm.responded_at,
    lcm.created_at,
    p.full_name AS applicant_name,
    la.amount_requested,
    la.term_months,
    la.purpose,
    la.status AS application_status
  FROM loan_co_makers lcm
  JOIN loan_applications la ON la.id = lcm.application_id
  JOIN profiles p ON p.id = la.user_id
  WHERE lcm.co_maker_user_id = auth.uid()
  ORDER BY lcm.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
