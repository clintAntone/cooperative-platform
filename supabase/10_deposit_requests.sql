-- Deposit request submitted by member, approved by staff/admin
CREATE TABLE deposit_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id),
  share_id UUID NOT NULL REFERENCES equity_shares(id),
  amount DECIMAL(15,2) NOT NULL CHECK (amount > 0),
  payment_method VARCHAR CHECK (payment_method IN ('cash','bank_transfer','mobile_money')) NOT NULL,
  reference VARCHAR,
  receipt_url VARCHAR,   -- Supabase Storage public URL
  notes TEXT,
  status VARCHAR CHECK (status IN ('pending','approved','rejected')) NOT NULL DEFAULT 'pending',
  reviewed_by UUID REFERENCES profiles(id),
  reviewed_at TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE deposit_requests ENABLE ROW LEVEL SECURITY;

-- Members see only their own requests
CREATE POLICY deposit_requests_member ON deposit_requests
  FOR ALL USING (user_id = auth.uid());

-- Staff/admin see all
CREATE POLICY deposit_requests_admin ON deposit_requests
  FOR ALL USING (get_user_role(auth.uid()) IN ('admin','staff'));

-- On approval: distribute amount starting from the requested share,
-- then overflow into subsequent in-progress shares in order.
CREATE OR REPLACE FUNCTION approve_deposit_request(p_request_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req        deposit_requests%ROWTYPE;
  v_share      equity_shares%ROWTYPE;
  v_remaining  DECIMAL(15,2);
  v_to_credit  DECIMAL(15,2);
  v_leftover   DECIMAL(15,2);
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin','staff') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT * INTO v_req FROM deposit_requests WHERE id = p_request_id;

  IF v_req.status != 'pending' THEN
    RAISE EXCEPTION 'Request is not pending';
  END IF;

  v_leftover := v_req.amount;

  -- Walk through in-progress shares starting from the requested share,
  -- then by share_number order for the same member.
  FOR v_share IN
    SELECT * FROM equity_shares
    WHERE user_id = v_req.user_id
      AND status = 'in_progress'
      AND (id = v_req.share_id OR share_number > (
            SELECT share_number FROM equity_shares WHERE id = v_req.share_id
          ))
    ORDER BY
      CASE WHEN id = v_req.share_id THEN 0 ELSE 1 END,
      share_number ASC
  LOOP
    EXIT WHEN v_leftover <= 0;

    v_remaining := v_share.target_amount - v_share.paid_amount;
    v_to_credit := LEAST(v_leftover, v_remaining);

    INSERT INTO equity_contributions (user_id, share_id, amount, payment_method, reference, recorded_by)
    VALUES (v_req.user_id, v_share.id, v_to_credit, v_req.payment_method, v_req.reference, auth.uid());

    v_leftover := v_leftover - v_to_credit;
  END LOOP;

  -- If any amount remains after all shares are full, credit it to the original share
  -- (this handles edge cases like no next share available)
  IF v_leftover > 0 THEN
    INSERT INTO equity_contributions (user_id, share_id, amount, payment_method, reference, recorded_by)
    VALUES (v_req.user_id, v_req.share_id, v_leftover, v_req.payment_method, v_req.reference, auth.uid());
  END IF;

  -- Mark request approved
  UPDATE deposit_requests
  SET status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
  WHERE id = p_request_id;
END;
$$;

GRANT EXECUTE ON FUNCTION approve_deposit_request(UUID) TO authenticated;

-- Reject function
CREATE OR REPLACE FUNCTION reject_deposit_request(p_request_id UUID, p_reason TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin','staff') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  UPDATE deposit_requests
  SET status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(),
      rejection_reason = p_reason, updated_at = now()
  WHERE id = p_request_id AND status = 'pending';
END;
$$;

GRANT EXECUTE ON FUNCTION reject_deposit_request(UUID, TEXT) TO authenticated;

-- STORAGE SETUP (run in Supabase dashboard or via CLI):
-- 1. Create a storage bucket named: deposit-receipts
-- 2. Set it to PUBLIC (so receipt URLs are accessible)
-- 3. Add RLS policy: authenticated users can upload to folder named after their user ID
--    Policy name: "Members can upload own receipts"
--    Allowed operation: INSERT
--    Policy: (bucket_id = 'deposit-receipts' AND auth.uid()::text = (storage.foldername(name))[1])
