-- Migration 54: Rework branches as cooperative business ventures
--
-- Branches are NOT member chapters. They are businesses owned by the cooperative
-- (e.g., a store, a farm). Income from each branch is distributed to ALL members
-- with completed equity shares, proportional to their share count.
--
-- Changes from migration 51:
--   - Remove branch_id from profiles (members don't belong to branches)
--   - Remove assign_member_branch() RPC
--   - Add branch_income and branch_income_distributions tables
--   - Add record_branch_income() and distribute_branch_income() RPCs

-- Remove member-branch assignment (wrong concept)
ALTER TABLE profiles DROP COLUMN IF EXISTS branch_id;
DROP FUNCTION IF EXISTS assign_member_branch(UUID, UUID);

-- Extend ledger entry_type to include branch income distribution
ALTER TABLE ledger_entries DROP CONSTRAINT IF EXISTS ledger_entries_entry_type_check;
ALTER TABLE ledger_entries ADD CONSTRAINT ledger_entries_entry_type_check CHECK (entry_type IN (
  'equity_contribution','equity_reversal',
  'loan_disbursement','loan_repayment',
  'fee','adjustment',
  'savings_deposit','savings_withdrawal','savings_interest',
  'equity_dividend',
  'share_transfer_out','share_transfer_in',
  'rebate',
  'branch_income'
));

-- ─── branch_income: income recorded per branch per period ─────────────────────
CREATE TABLE branch_income (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id    UUID NOT NULL REFERENCES branches(id),
  amount       DECIMAL(15,2) NOT NULL CHECK (amount > 0),
  period_start DATE NOT NULL,
  period_end   DATE NOT NULL,
  description  TEXT,
  distributed  BOOLEAN NOT NULL DEFAULT false,
  recorded_by  UUID NOT NULL REFERENCES profiles(id),
  created_at   TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE branch_income ENABLE ROW LEVEL SECURITY;
CREATE POLICY branch_income_read ON branch_income FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY branch_income_admin ON branch_income FOR ALL USING (get_user_role(auth.uid()) IN ('admin','staff'));

-- ─── branch_income_distributions: per-member share of a branch income record ──
CREATE TABLE branch_income_distributions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  income_id    UUID NOT NULL REFERENCES branch_income(id),
  user_id      UUID NOT NULL REFERENCES profiles(id),
  share_count  INT NOT NULL,
  amount       DECIMAL(15,2) NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE(income_id, user_id)
);

ALTER TABLE branch_income_distributions ENABLE ROW LEVEL SECURITY;
CREATE POLICY branch_dist_self ON branch_income_distributions FOR SELECT USING (user_id = auth.uid());
CREATE POLICY branch_dist_admin ON branch_income_distributions FOR ALL USING (get_user_role(auth.uid()) IN ('admin','staff'));

-- ─── record_branch_income(): admin records income for a branch ────────────────
CREATE OR REPLACE FUNCTION record_branch_income(
  p_branch_id   UUID,
  p_amount      DECIMAL,
  p_period_start DATE,
  p_period_end   DATE,
  p_description  TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_income_id UUID;
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin','staff') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  INSERT INTO branch_income (branch_id, amount, period_start, period_end, description, recorded_by)
  VALUES (p_branch_id, p_amount, p_period_start, p_period_end, p_description, auth.uid())
  RETURNING id INTO v_income_id;

  RETURN v_income_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
GRANT EXECUTE ON FUNCTION record_branch_income(UUID, DECIMAL, DATE, DATE, TEXT) TO authenticated;

-- ─── distribute_branch_income(): divide income among all shareholders ─────────
-- Distribution is proportional to each member's completed share count.
-- Credits are added to each member's savings account (if active).
CREATE OR REPLACE FUNCTION distribute_branch_income(p_income_id UUID)
RETURNS INT AS $$
DECLARE
  v_income     branch_income%ROWTYPE;
  v_total_shares INT;
  v_per_share  DECIMAL(15,2);
  v_count      INT := 0;
  r            RECORD;
  v_member_amount DECIMAL(15,2);
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin') THEN
    RAISE EXCEPTION 'Access denied — only admin can distribute income';
  END IF;

  SELECT * INTO v_income FROM branch_income WHERE id = p_income_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Income record not found'; END IF;
  IF v_income.distributed THEN RAISE EXCEPTION 'This income has already been distributed'; END IF;

  -- Count total completed shares across all active members
  SELECT COALESCE(SUM(share_count), 0) INTO v_total_shares
  FROM (
    SELECT COUNT(*) AS share_count
    FROM equity_shares es
    JOIN profiles p ON p.id = es.user_id
    WHERE es.status = 'completed'
      AND p.account_status = 'active'
      AND p.role = 'member'
    GROUP BY es.user_id
  ) sub;

  IF v_total_shares = 0 THEN
    RAISE EXCEPTION 'No members with completed shares found';
  END IF;

  v_per_share := v_income.amount / v_total_shares;

  -- Distribute to each member proportional to their share count
  FOR r IN
    SELECT es.user_id, COUNT(*) AS share_count
    FROM equity_shares es
    JOIN profiles p ON p.id = es.user_id
    WHERE es.status = 'completed'
      AND p.account_status = 'active'
      AND p.role = 'member'
    GROUP BY es.user_id
  LOOP
    v_member_amount := ROUND(v_per_share * r.share_count, 2);

    INSERT INTO branch_income_distributions (income_id, user_id, share_count, amount)
    VALUES (p_income_id, r.user_id, r.share_count::INT, v_member_amount)
    ON CONFLICT (income_id, user_id) DO NOTHING;

    -- Credit to savings account if exists
    UPDATE savings_accounts
    SET balance = balance + v_member_amount, updated_at = now()
    WHERE user_id = r.user_id AND status = 'active';

    -- Ledger entry
    INSERT INTO ledger_entries (
      user_id, entry_type, reference_id, reference_table, amount, direction, notes, created_by
    ) VALUES (
      r.user_id, 'branch_income', p_income_id, 'branch_income',
      v_member_amount, 'credit', 'Branch income distribution', auth.uid()
    );

    v_count := v_count + 1;
  END LOOP;

  -- Mark as distributed
  UPDATE branch_income SET distributed = true WHERE id = p_income_id;

  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
GRANT EXECUTE ON FUNCTION distribute_branch_income(UUID) TO authenticated;
