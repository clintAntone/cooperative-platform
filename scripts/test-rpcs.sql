-- ============================================================
-- RPC Smoke Tests — run in Supabase SQL Editor (as service_role or admin)
-- Each block prints PASS or FAIL.
-- Run sections individually or all at once.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- SECTION 1: Accounting guards (critical fixes from migration 61)
-- ─────────────────────────────────────────────────────────────

-- 1a. Dividend double-release guard
DO $$
DECLARE v_count INT;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM information_schema.table_constraints
  WHERE table_name = 'equity_dividend_logs'
    AND constraint_type = 'UNIQUE'
    AND constraint_name LIKE '%share_period%';
  RAISE NOTICE '[1a] Dividend UNIQUE constraint: %', CASE WHEN v_count > 0 THEN 'PASS' ELSE 'FAIL — constraint missing' END;
END $$;

-- 1b. Rebate double-release guard
DO $$
DECLARE v_count INT;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM information_schema.table_constraints
  WHERE table_name = 'rebate_releases'
    AND constraint_type = 'UNIQUE'
    AND constraint_name LIKE '%period%';
  RAISE NOTICE '[1b] Rebate UNIQUE constraint: %', CASE WHEN v_count > 0 THEN 'PASS' ELSE 'FAIL — constraint missing' END;
END $$;

-- 1c. Savings interest idempotency constraint
DO $$
DECLARE v_count INT;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM information_schema.table_constraints
  WHERE table_name = 'savings_interest_logs'
    AND constraint_type = 'UNIQUE'
    AND constraint_name LIKE '%period%';
  RAISE NOTICE '[1c] Savings interest UNIQUE constraint: %', CASE WHEN v_count > 0 THEN 'PASS' ELSE 'FAIL — constraint missing' END;
END $$;

-- 1d. Ledger entry_type includes all expected types
DO $$
DECLARE v_check_clause TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_check_clause
  FROM pg_constraint
  WHERE conrelid = 'ledger_entries'::regclass
    AND conname = 'ledger_entries_entry_type_check';

  RAISE NOTICE '[1d] ledger damayan_collection: %',
    CASE WHEN v_check_clause LIKE '%damayan_collection%' THEN 'PASS' ELSE 'FAIL' END;
  RAISE NOTICE '[1d] ledger loan_disbursement_liability: %',
    CASE WHEN v_check_clause LIKE '%loan_disbursement_liability%' THEN 'PASS' ELSE 'FAIL' END;
  RAISE NOTICE '[1d] ledger loan_repayment_principal: %',
    CASE WHEN v_check_clause LIKE '%loan_repayment_principal%' THEN 'PASS' ELSE 'FAIL' END;
  RAISE NOTICE '[1d] ledger loan_repayment_interest: %',
    CASE WHEN v_check_clause LIKE '%loan_repayment_interest%' THEN 'PASS' ELSE 'FAIL' END;
END $$;

-- ─────────────────────────────────────────────────────────────
-- SECTION 2: RPC existence checks
-- ─────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_rpcs TEXT[] := ARRAY[
    'release_equity_dividend',
    'release_rebates',
    'release_savings_interest',
    'record_damayan_payment',
    'admin_approve_loan_application',
    'record_loan_repayment',
    'mark_overdue_installments',
    'distribute_branch_income',
    'verify_savings_balance',
    'verify_loan_outstanding',
    'admin_deactivate_member',
    'get_loan_aging_report'
  ];
  v_rpc TEXT;
  v_count INT;
BEGIN
  FOREACH v_rpc IN ARRAY v_rpcs LOOP
    SELECT COUNT(*) INTO v_count
    FROM pg_proc
    WHERE proname = v_rpc;
    RAISE NOTICE '[2] RPC %: %', v_rpc, CASE WHEN v_count > 0 THEN 'PASS' ELSE 'FAIL — not found' END;
  END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────────
-- SECTION 3: Table structure checks
-- ─────────────────────────────────────────────────────────────

-- 3a. branch_income has new breakdown columns
DO $$
DECLARE v_count INT;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM information_schema.columns
  WHERE table_name = 'branch_income'
    AND column_name IN ('gross_sales','salary','expenses_total','roi');
  RAISE NOTICE '[3a] branch_income breakdown columns (expect 4): %',
    CASE WHEN v_count = 4 THEN 'PASS' ELSE format('FAIL — only %s found', v_count) END;
END $$;

-- 3b. branches has report_cutoff_day
DO $$
DECLARE v_count INT;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM information_schema.columns
  WHERE table_name = 'branches' AND column_name = 'report_cutoff_day';
  RAISE NOTICE '[3b] branches.report_cutoff_day: %', CASE WHEN v_count > 0 THEN 'PASS' ELSE 'FAIL' END;
END $$;

-- 3c. savings_interest_logs has period_end unique
DO $$
DECLARE v_count INT;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM information_schema.table_constraints tc
  JOIN information_schema.constraint_column_usage ccu USING (constraint_name, table_name)
  WHERE tc.table_name = 'savings_interest_logs'
    AND tc.constraint_type = 'UNIQUE'
    AND ccu.column_name = 'period_end';
  RAISE NOTICE '[3c] savings_interest_logs (account_id, period_end) UNIQUE: %',
    CASE WHEN v_count > 0 THEN 'PASS' ELSE 'FAIL' END;
END $$;

-- ─────────────────────────────────────────────────────────────
-- SECTION 4: Loan aging report (read-only smoke test)
-- ─────────────────────────────────────────────────────────────

DO $$
DECLARE v_count INT;
BEGIN
  -- Just verify the function executes without error
  -- (needs to run as an authenticated role that has admin/staff/board)
  RAISE NOTICE '[4] get_loan_aging_report: run manually as admin role to confirm output';
END $$;

-- ─────────────────────────────────────────────────────────────
-- SECTION 5: Reconciliation helpers
-- ─────────────────────────────────────────────────────────────

-- 5a. verify_savings_balance — check all accounts for drift
DO $$
DECLARE
  v_out_of_sync INT := 0;
  r RECORD;
BEGIN
  FOR r IN
    SELECT sa.id FROM savings_accounts sa WHERE sa.status = 'active'
  LOOP
    -- Can only call if running as a role that passes the get_user_role check.
    -- Uncomment to run interactively:
    -- SELECT COUNT(*) INTO v_ct FROM verify_savings_balance(r.id) WHERE NOT is_reconciled;
    -- v_out_of_sync := v_out_of_sync + v_ct;
    NULL;
  END LOOP;
  RAISE NOTICE '[5a] verify_savings_balance: run as admin role with: SELECT * FROM verify_savings_balance(''<account_uuid>'')';
END $$;

-- 5b. verify_loan_outstanding — counts active loans where outstanding drifted from schedule
DO $$
DECLARE
  v_drift_count INT;
BEGIN
  RAISE NOTICE '[5b] verify_loan_outstanding: run as admin role with: SELECT * FROM verify_loan_outstanding(''<loan_uuid>'')';

  SELECT COUNT(*) INTO v_drift_count
  FROM (
    SELECT l.id
    FROM loans l
    LEFT JOIN loan_repayment_schedule lrs
      ON lrs.loan_id = l.id
      AND lrs.status IN ('pending', 'overdue', 'partial')
    WHERE l.status = 'active'
    GROUP BY l.id, l.outstanding
    HAVING ABS(
      l.outstanding - COALESCE(SUM(
        CASE
          WHEN lrs.status IN ('pending', 'overdue') THEN lrs.total_due
          WHEN lrs.status = 'partial'               THEN lrs.total_due - lrs.amount_paid
          ELSE 0
        END
      ), 0)
    ) >= 0.01
  ) drifted;

  RAISE NOTICE '[5b] Active loans with outstanding drift >= ¢1: % (expect 0)', v_drift_count;
END $$;

-- ─────────────────────────────────────────────────────────────
-- SECTION 6: Ledger double-entry check
-- Each loan disbursement should have exactly 2 ledger entries
-- ─────────────────────────────────────────────────────────────

DO $$
DECLARE v_single INT;
BEGIN
  SELECT COUNT(*) INTO v_single
  FROM (
    SELECT reference_id
    FROM ledger_entries
    WHERE entry_type IN ('loan_disbursement', 'loan_disbursement_liability')
    GROUP BY reference_id
    HAVING COUNT(*) < 2
  ) sub;
  RAISE NOTICE '[6] Loan disbursements with single-sided ledger entry: % (expect 0 for new loans)',
    v_single;
END $$;

-- ─────────────────────────────────────────────────────────────
-- SECTION 7: RLS policy existence check
-- ─────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_tables TEXT[] := ARRAY[
    'equity_shares', 'equity_contributions', 'deposit_requests',
    'loans', 'loan_repayments', 'loan_applications',
    'savings_accounts', 'savings_contributions', 'savings_deposit_requests', 'savings_withdrawal_requests',
    'branch_income', 'branch_income_distributions',
    'damayan_events', 'damayan_assessments',
    'rebate_releases', 'rebate_logs',
    'equity_dividend_logs', 'ledger_entries'
  ];
  v_tbl TEXT;
  v_count INT;
BEGIN
  FOREACH v_tbl IN ARRAY v_tables LOOP
    SELECT COUNT(*) INTO v_count FROM pg_policies WHERE tablename = v_tbl;
    RAISE NOTICE '[7] RLS policies on %: %',
      v_tbl, CASE WHEN v_count > 0 THEN format('PASS (%s policies)', v_count) ELSE 'FAIL — no policies' END;
  END LOOP;
END $$;
