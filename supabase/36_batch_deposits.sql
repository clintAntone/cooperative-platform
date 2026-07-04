-- Add collector role
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('admin', 'member', 'staff', 'collector'));

-- Batch deposit: one receipt covering multiple members
CREATE TABLE IF NOT EXISTS batch_deposits (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference      VARCHAR,
  payment_method VARCHAR CHECK (payment_method IN ('cash','bank_transfer','mobile_money')) NOT NULL,
  receipt_url    VARCHAR,
  notes          TEXT,
  total_amount   DECIMAL(15,2) NOT NULL CHECK (total_amount > 0),
  status         VARCHAR CHECK (status IN ('pending','approved','rejected')) NOT NULL DEFAULT 'pending',
  submitted_by   UUID NOT NULL REFERENCES profiles(id),
  reviewed_by    UUID REFERENCES profiles(id),
  reviewed_at    TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at     TIMESTAMPTZ DEFAULT now(),
  updated_at     TIMESTAMPTZ DEFAULT now()
);

-- Individual member entries within a batch
CREATE TABLE IF NOT EXISTS batch_deposit_items (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id           UUID NOT NULL REFERENCES batch_deposits(id) ON DELETE CASCADE,
  user_id            UUID NOT NULL REFERENCES profiles(id),
  amount             DECIMAL(15,2) NOT NULL CHECK (amount > 0),
  deposit_request_id UUID REFERENCES deposit_requests(id),
  created_at         TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE batch_deposits ENABLE ROW LEVEL SECURITY;
ALTER TABLE batch_deposit_items ENABLE ROW LEVEL SECURITY;

-- Collectors/members see their own submitted batches
CREATE POLICY batch_deposits_submitter ON batch_deposits
  FOR ALL USING (submitted_by = auth.uid());

-- Admin/staff see all batches
CREATE POLICY batch_deposits_admin ON batch_deposits
  FOR ALL USING (get_user_role(auth.uid()) IN ('admin','staff'));

-- Items: follow the batch for submitter
CREATE POLICY batch_deposit_items_submitter ON batch_deposit_items
  FOR ALL USING (
    batch_id IN (SELECT id FROM batch_deposits WHERE submitted_by = auth.uid())
  );

-- Items: admin/staff see all
CREATE POLICY batch_deposit_items_admin ON batch_deposit_items
  FOR ALL USING (get_user_role(auth.uid()) IN ('admin','staff'));

-- Items: members can see items where they are the beneficiary
CREATE POLICY batch_deposit_items_member ON batch_deposit_items
  FOR SELECT USING (user_id = auth.uid());

-- Also allow collector role to access deposit_requests (read own)
CREATE POLICY deposit_requests_collector ON deposit_requests
  FOR SELECT USING (
    get_user_role(auth.uid()) = 'collector' AND user_id = auth.uid()
  );

-- Approve batch: creates + approves a deposit_request per item
CREATE OR REPLACE FUNCTION approve_batch_deposit(p_batch_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch  batch_deposits%ROWTYPE;
  v_item   batch_deposit_items%ROWTYPE;
  v_share_id UUID;
  v_request_id UUID;
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin','staff') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT * INTO v_batch FROM batch_deposits WHERE id = p_batch_id;

  IF v_batch.status != 'pending' THEN
    RAISE EXCEPTION 'Batch is not pending';
  END IF;

  FOR v_item IN
    SELECT * FROM batch_deposit_items WHERE batch_id = p_batch_id
  LOOP
    -- Find member's first in-progress share
    SELECT id INTO v_share_id
    FROM equity_shares
    WHERE user_id = v_item.user_id AND status = 'in_progress'
    ORDER BY share_number ASC
    LIMIT 1;

    IF v_share_id IS NULL THEN
      RAISE EXCEPTION 'Member % has no active equity share', v_item.user_id;
    END IF;

    -- Create the deposit request
    INSERT INTO deposit_requests (user_id, share_id, amount, payment_method, reference, receipt_url, notes, status)
    VALUES (
      v_item.user_id,
      v_share_id,
      v_item.amount,
      v_batch.payment_method,
      v_batch.reference,
      v_batch.receipt_url,
      v_batch.notes,
      'pending'
    )
    RETURNING id INTO v_request_id;

    -- Link it back to the item
    UPDATE batch_deposit_items SET deposit_request_id = v_request_id WHERE id = v_item.id;

    -- Approve it (reuse existing logic)
    PERFORM approve_deposit_request(v_request_id);
  END LOOP;

  UPDATE batch_deposits
  SET status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
  WHERE id = p_batch_id;
END;
$$;

GRANT EXECUTE ON FUNCTION approve_batch_deposit(UUID) TO authenticated;

-- Reject batch
CREATE OR REPLACE FUNCTION reject_batch_deposit(p_batch_id UUID, p_reason TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin','staff') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  UPDATE batch_deposits
  SET status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(),
      rejection_reason = p_reason, updated_at = now()
  WHERE id = p_batch_id AND status = 'pending';
END;
$$;

GRANT EXECUTE ON FUNCTION reject_batch_deposit(UUID, TEXT) TO authenticated;

-- Allow collector role to read profiles (for member search in batch form)
CREATE POLICY profiles_collector_read ON profiles
  FOR SELECT USING (get_user_role(auth.uid()) = 'collector');

-- Update admin_update_user_role to accept 'collector' as a valid role
CREATE OR REPLACE FUNCTION admin_update_user_role(
  p_target_user_id UUID,
  p_new_role        VARCHAR
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF get_user_role(auth.uid()) != 'admin' THEN
    RAISE EXCEPTION 'Only admins can change user roles';
  END IF;

  IF p_new_role NOT IN ('admin', 'staff', 'member', 'collector') THEN
    RAISE EXCEPTION 'Invalid role: %', p_new_role;
  END IF;

  UPDATE profiles
  SET role = p_new_role, updated_at = now()
  WHERE id = p_target_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_update_user_role(UUID, VARCHAR) TO authenticated;
