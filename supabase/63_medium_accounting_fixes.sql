-- Migration 63: MEDIUM-priority accounting fixes
--
-- 10. Branch distribution snapshot — use period_end share count, not live count
-- 11. Savings balance reconciliation — verify_savings_balance() helper
-- 12. Loan outstanding reconciliation — verify_loan_outstanding() helper
-- 13. Member exit/withdrawal process — admin_deactivate_member() RPC

-- ─── Issue 10: Branch distribution — use period-end share snapshot ────────────
-- Members who completed a share AFTER the income period end should NOT receive
-- a distribution for that period.

CREATE OR REPLACE FUNCTION distribute_branch_income(p_income_id UUID)
RETURNS INT AS $$
DECLARE
  v_income        branch_income%ROWTYPE;
  v_total_shares  INT;
  v_per_share     DECIMAL(15,2);
  v_count         INT := 0;
  r               RECORD;
  v_member_amount DECIMAL(15,2);
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin') THEN
    RAISE EXCEPTION 'Access denied — only admin can distribute income';
  END IF;

  SELECT * INTO v_income FROM branch_income WHERE id = p_income_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Income record not found'; END IF;
  IF v_income.distributed THEN RAISE EXCEPTION 'This income has already been distributed'; END IF;

  -- Count total completed shares as of the income period_end date
  -- (members who completed shares AFTER period_end are excluded)
  SELECT COALESCE(SUM(share_count), 0) INTO v_total_shares
  FROM (
    SELECT COUNT(*) AS share_count
    FROM equity_shares es
    JOIN profiles p ON p.id = es.user_id
    WHERE es.status = 'completed'
      AND (es.completed_at IS NULL OR es.completed_at::DATE <= v_income.period_end)
      AND p.account_status = 'active'
      AND p.role IN ('member', 'collector')
    GROUP BY es.user_id
  ) sub;

  IF v_total_shares = 0 THEN
    RAISE EXCEPTION 'No members with completed shares found for the period ending %', v_income.period_end;
  END IF;

  v_per_share := v_income.amount / v_total_shares;

  FOR r IN
    SELECT es.user_id, COUNT(*) AS share_count
    FROM equity_shares es
    JOIN profiles p ON p.id = es.user_id
    WHERE es.status = 'completed'
      AND (es.completed_at IS NULL OR es.completed_at::DATE <= v_income.period_end)
      AND p.account_status = 'active'
      AND p.role IN ('member', 'collector')
    GROUP BY es.user_id
  LOOP
    v_member_amount := ROUND(v_per_share * r.share_count, 2);

    INSERT INTO branch_income_distributions (income_id, user_id, share_count, amount)
    VALUES (p_income_id, r.user_id, r.share_count::INT, v_member_amount)
    ON CONFLICT (income_id, user_id) DO NOTHING;

    UPDATE savings_accounts
    SET balance = balance + v_member_amount, updated_at = now()
    WHERE user_id = r.user_id AND status = 'active';

    INSERT INTO ledger_entries (
      user_id, entry_type, reference_id, reference_table, amount, direction, notes, created_by
    ) VALUES (
      r.user_id, 'branch_income', p_income_id, 'branch_income',
      v_member_amount, 'credit', 'Branch income distribution', auth.uid()
    );

    v_count := v_count + 1;
  END LOOP;

  UPDATE branch_income SET distributed = true WHERE id = p_income_id;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
GRANT EXECUTE ON FUNCTION distribute_branch_income(UUID) TO authenticated;

-- ─── Issue 11: Savings balance reconciliation helper ─────────────────────────

CREATE OR REPLACE FUNCTION verify_savings_balance(p_account_id UUID)
RETURNS TABLE(
  account_id        UUID,
  stored_balance    DECIMAL(15,2),
  computed_balance  DECIMAL(15,2),
  difference        DECIMAL(15,2),
  is_reconciled     BOOLEAN
) AS $$
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin', 'staff') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  WITH
  deposits AS (
    SELECT COALESCE(SUM(sc.amount), 0)::DECIMAL(15,2) AS total
    FROM savings_contributions sc
    WHERE sc.account_id = p_account_id
  ),
  withdrawals AS (
    SELECT COALESCE(SUM(swr.amount), 0)::DECIMAL(15,2) AS total
    FROM savings_withdrawal_requests swr
    WHERE swr.account_id = p_account_id AND swr.status = 'approved'
  ),
  interest AS (
    SELECT COALESCE(SUM(sil.interest_earned), 0)::DECIMAL(15,2) AS total
    FROM savings_interest_logs sil
    WHERE sil.account_id = p_account_id
  ),
  distributions AS (
    SELECT COALESCE(SUM(bid.amount), 0)::DECIMAL(15,2) AS total
    FROM branch_income_distributions bid
    JOIN savings_accounts sa ON sa.user_id = bid.user_id
    WHERE sa.id = p_account_id
  ),
  dividends AS (
    SELECT COALESCE(SUM(edl.dividend_earned), 0)::DECIMAL(15,2) AS total
    FROM equity_dividend_logs edl
    JOIN savings_accounts sa ON sa.user_id = edl.user_id
    WHERE sa.id = p_account_id
  ),
  rebates_earned AS (
    SELECT COALESCE(SUM(rl.rebate_amount), 0)::DECIMAL(15,2) AS total
    FROM rebate_logs rl
    JOIN savings_accounts sa ON sa.user_id = rl.user_id
    WHERE sa.id = p_account_id
  )
  SELECT
    sa.id,
    sa.balance,
    (d.total + i.total + dist.total + div.total + reb.total - w.total)::DECIMAL(15,2) AS computed_balance,
    (sa.balance - (d.total + i.total + dist.total + div.total + reb.total - w.total))::DECIMAL(15,2) AS difference,
    ABS(sa.balance - (d.total + i.total + dist.total + div.total + reb.total - w.total)) < 0.01
  FROM savings_accounts sa, deposits d, withdrawals w, interest i, distributions dist, dividends div, rebates_earned reb
  WHERE sa.id = p_account_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
GRANT EXECUTE ON FUNCTION verify_savings_balance(UUID) TO authenticated;

-- ─── Issue 12: Loan outstanding reconciliation helper ─────────────────────────

CREATE OR REPLACE FUNCTION verify_loan_outstanding(p_loan_id UUID)
RETURNS TABLE(
  loan_id               UUID,
  stored_outstanding    DECIMAL(15,2),
  computed_outstanding  DECIMAL(15,2),
  difference            DECIMAL(15,2),
  is_reconciled         BOOLEAN
) AS $$
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin', 'staff') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  SELECT
    l.id,
    l.outstanding,
    -- Outstanding = sum of unpaid amounts on non-waived installments
    COALESCE(SUM(
      CASE
        WHEN lrs.status IN ('pending','overdue') THEN lrs.total_due
        WHEN lrs.status = 'partial'              THEN lrs.total_due - lrs.amount_paid
        ELSE 0
      END
    ), 0)::DECIMAL(15,2) AS computed_outstanding,
    (l.outstanding - COALESCE(SUM(
      CASE
        WHEN lrs.status IN ('pending','overdue') THEN lrs.total_due
        WHEN lrs.status = 'partial'              THEN lrs.total_due - lrs.amount_paid
        ELSE 0
      END
    ), 0))::DECIMAL(15,2) AS difference,
    ABS(l.outstanding - COALESCE(SUM(
      CASE
        WHEN lrs.status IN ('pending','overdue') THEN lrs.total_due
        WHEN lrs.status = 'partial'              THEN lrs.total_due - lrs.amount_paid
        ELSE 0
      END
    ), 0)) < 0.01
  FROM loans l
  LEFT JOIN loan_repayment_schedule lrs ON lrs.loan_id = l.id
  WHERE l.id = p_loan_id
  GROUP BY l.id, l.outstanding;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
GRANT EXECUTE ON FUNCTION verify_loan_outstanding(UUID) TO authenticated;

-- ─── Issue 13: Member exit / withdrawal process ───────────────────────────────

CREATE OR REPLACE FUNCTION admin_deactivate_member(p_user_id UUID, p_reason TEXT DEFAULT NULL)
RETURNS JSONB AS $$
DECLARE
  v_active_loans    INT;
  v_damayan_arrears DECIMAL(15,2);
  v_savings_balance DECIMAL(15,2);
  v_result          JSONB;
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin') THEN
    RAISE EXCEPTION 'Access denied — only admin can deactivate members';
  END IF;

  -- Block if the member has active loans
  SELECT COUNT(*) INTO v_active_loans
  FROM loans WHERE user_id = p_user_id AND status IN ('active','defaulted');

  IF v_active_loans > 0 THEN
    RAISE EXCEPTION 'Cannot deactivate: member has % active/defaulted loan(s). Settle all loans first.', v_active_loans;
  END IF;

  -- Record outstanding damayan arrears for audit
  SELECT COALESCE(SUM(amount_due - amount_paid), 0) INTO v_damayan_arrears
  FROM damayan_assessments
  WHERE user_id = p_user_id AND status = 'pending';

  -- Capture savings balance before closing
  SELECT COALESCE(balance, 0) INTO v_savings_balance
  FROM savings_accounts WHERE user_id = p_user_id AND status = 'active';

  -- Close savings account
  UPDATE savings_accounts
  SET status = 'closed', closed_at = now(), updated_at = now()
  WHERE user_id = p_user_id AND status = 'active';

  -- Suspend pending damayan assessments (write them off)
  UPDATE damayan_assessments
  SET status = 'waived', notes = COALESCE(notes || ' | ', '') || 'Waived on member exit', updated_at = now()
  WHERE user_id = p_user_id AND status = 'pending';

  -- Mark all in-progress shares as cancelled
  UPDATE equity_shares
  SET status = 'cancelled', updated_at = now()
  WHERE user_id = p_user_id AND status = 'in_progress';

  -- Set profile to inactive
  UPDATE profiles
  SET account_status = 'inactive', updated_at = now()
  WHERE id = p_user_id;

  -- Build result summary
  v_result := jsonb_build_object(
    'user_id',          p_user_id,
    'reason',           p_reason,
    'savings_closed',   v_savings_balance,
    'damayan_written_off', v_damayan_arrears,
    'deactivated_at',   now()
  );

  -- Ledger note if savings were closed with a balance (manual payout needed)
  IF v_savings_balance > 0 THEN
    INSERT INTO ledger_entries (user_id, entry_type, reference_id, reference_table, amount, direction, notes, created_by)
    VALUES (p_user_id, 'adjustment', p_user_id, 'profiles', v_savings_balance, 'credit',
            'Member exit — savings balance payout pending: ' || v_savings_balance::TEXT, auth.uid());
  END IF;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
GRANT EXECUTE ON FUNCTION admin_deactivate_member(UUID, TEXT) TO authenticated;

-- ─── Issue 14: Loan aging / delinquency report ────────────────────────────────

CREATE OR REPLACE FUNCTION get_loan_aging_report()
RETURNS TABLE(
  bucket            TEXT,
  loan_count        INT,
  total_outstanding DECIMAL(15,2),
  loan_ids          UUID[]
) AS $$
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin', 'staff', 'board') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  SELECT
    CASE
      WHEN l.status = 'completed' THEN 'Completed'
      WHEN MAX(COALESCE(lrs.due_date, l.due_date)) >= CURRENT_DATE THEN 'Current'
      WHEN MAX(COALESCE(lrs.due_date, l.due_date)) >= CURRENT_DATE - 30 THEN '1–30 days'
      WHEN MAX(COALESCE(lrs.due_date, l.due_date)) >= CURRENT_DATE - 60 THEN '31–60 days'
      WHEN MAX(COALESCE(lrs.due_date, l.due_date)) >= CURRENT_DATE - 90 THEN '61–90 days'
      ELSE '90+ days'
    END AS bucket,
    COUNT(DISTINCT l.id)::INT AS loan_count,
    SUM(l.outstanding)::DECIMAL(15,2) AS total_outstanding,
    ARRAY_AGG(DISTINCT l.id) AS loan_ids
  FROM loans l
  LEFT JOIN loan_repayment_schedule lrs ON lrs.loan_id = l.id AND lrs.status IN ('pending','overdue','partial')
  WHERE l.status IN ('active','defaulted','completed')
  GROUP BY
    CASE
      WHEN l.status = 'completed' THEN 'Completed'
      WHEN MAX(COALESCE(lrs.due_date, l.due_date)) >= CURRENT_DATE THEN 'Current'
      WHEN MAX(COALESCE(lrs.due_date, l.due_date)) >= CURRENT_DATE - 30 THEN '1–30 days'
      WHEN MAX(COALESCE(lrs.due_date, l.due_date)) >= CURRENT_DATE - 60 THEN '31–60 days'
      WHEN MAX(COALESCE(lrs.due_date, l.due_date)) >= CURRENT_DATE - 90 THEN '61–90 days'
      ELSE '90+ days'
    END
  ORDER BY MIN(COALESCE(lrs.due_date, l.due_date));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
GRANT EXECUTE ON FUNCTION get_loan_aging_report() TO authenticated;
