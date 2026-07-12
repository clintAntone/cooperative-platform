CREATE TABLE share_transfers (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  share_id         UUID NOT NULL REFERENCES equity_shares(id),
  from_user_id     UUID NOT NULL REFERENCES profiles(id),
  to_user_id       UUID NOT NULL REFERENCES profiles(id),
  reason           TEXT,
  status           VARCHAR CHECK (status IN ('pending','approved','rejected')) NOT NULL DEFAULT 'pending',
  reviewed_by      UUID REFERENCES profiles(id),
  reviewed_at      TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE share_transfers ENABLE ROW LEVEL SECURITY;
CREATE POLICY share_transfers_self ON share_transfers FOR SELECT USING (from_user_id = auth.uid() OR to_user_id = auth.uid());
CREATE POLICY share_transfers_insert ON share_transfers FOR INSERT WITH CHECK (from_user_id = auth.uid());
CREATE POLICY share_transfers_admin ON share_transfers FOR ALL USING (get_user_role(auth.uid()) IN ('admin','staff'));

-- Extend ledger entry_type
ALTER TABLE ledger_entries DROP CONSTRAINT IF EXISTS ledger_entries_entry_type_check;
ALTER TABLE ledger_entries ADD CONSTRAINT ledger_entries_entry_type_check CHECK (entry_type IN (
  'equity_contribution','equity_reversal',
  'loan_disbursement','loan_repayment',
  'fee','adjustment',
  'savings_deposit','savings_withdrawal','savings_interest',
  'equity_dividend',
  'share_transfer_out','share_transfer_in'
));

CREATE OR REPLACE FUNCTION request_share_transfer(p_share_id UUID, p_to_user_id UUID, p_reason TEXT DEFAULT NULL)
RETURNS UUID AS $$
DECLARE
  v_share equity_shares%ROWTYPE;
  v_transfer_id UUID;
BEGIN
  SELECT * INTO v_share FROM equity_shares WHERE id = p_share_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Share not found'; END IF;
  IF v_share.user_id != auth.uid() THEN RAISE EXCEPTION 'You do not own this share'; END IF;
  IF v_share.status != 'completed' THEN RAISE EXCEPTION 'Only completed shares can be transferred'; END IF;

  -- Check no pending transfer for this share
  IF EXISTS (SELECT 1 FROM share_transfers WHERE share_id = p_share_id AND status = 'pending') THEN
    RAISE EXCEPTION 'A pending transfer already exists for this share';
  END IF;

  IF p_to_user_id = auth.uid() THEN RAISE EXCEPTION 'Cannot transfer share to yourself'; END IF;

  INSERT INTO share_transfers (share_id, from_user_id, to_user_id, reason)
  VALUES (p_share_id, auth.uid(), p_to_user_id, p_reason)
  RETURNING id INTO v_transfer_id;

  RETURN v_transfer_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
GRANT EXECUTE ON FUNCTION request_share_transfer(UUID, UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION admin_approve_share_transfer(p_transfer_id UUID)
RETURNS VOID AS $$
DECLARE
  v_t share_transfers%ROWTYPE;
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin','staff') THEN RAISE EXCEPTION 'Access denied'; END IF;
  SELECT * INTO v_t FROM share_transfers WHERE id = p_transfer_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transfer not found'; END IF;
  IF v_t.status != 'pending' THEN RAISE EXCEPTION 'Transfer is not pending'; END IF;

  -- Move the share
  UPDATE equity_shares SET user_id = v_t.to_user_id, updated_at = now() WHERE id = v_t.share_id;

  -- Ledger entries
  INSERT INTO ledger_entries (user_id, entry_type, reference_id, reference_table, amount, direction, notes, created_by)
  SELECT v_t.from_user_id, 'share_transfer_out', v_t.id, 'share_transfers', es.target_amount, 'debit', 'Share transferred out', auth.uid()
  FROM equity_shares es WHERE es.id = v_t.share_id;

  INSERT INTO ledger_entries (user_id, entry_type, reference_id, reference_table, amount, direction, notes, created_by)
  SELECT v_t.to_user_id, 'share_transfer_in', v_t.id, 'share_transfers', es.target_amount, 'credit', 'Share received via transfer', auth.uid()
  FROM equity_shares es WHERE es.id = v_t.share_id;

  UPDATE share_transfers SET status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
  WHERE id = p_transfer_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
GRANT EXECUTE ON FUNCTION admin_approve_share_transfer(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION admin_reject_share_transfer(p_transfer_id UUID, p_reason TEXT)
RETURNS VOID AS $$
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin','staff') THEN RAISE EXCEPTION 'Access denied'; END IF;
  UPDATE share_transfers
  SET status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(), rejection_reason = p_reason, updated_at = now()
  WHERE id = p_transfer_id AND status = 'pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'Transfer not found or not pending'; END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
GRANT EXECUTE ON FUNCTION admin_reject_share_transfer(UUID, TEXT) TO authenticated;
