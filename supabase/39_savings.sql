-- ─── Savings Module ──────────────────────────────────────────────────────────
-- One savings account per member, opened automatically when first share completes.
-- Deposit flow: member submits request → admin approves → balance updated via trigger.
-- Withdrawal flow: member requests → admin approves → balance deducted in RPC.
-- Interest: released every 6 months via pg_cron calling release_savings_interest().

-- ─── Tables ───────────────────────────────────────────────────────────────────

CREATE TABLE savings_accounts (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL UNIQUE REFERENCES profiles(id),
  balance    DECIMAL(15,2) NOT NULL DEFAULT 0 CHECK (balance >= 0),
  status     VARCHAR CHECK (status IN ('active','closed','dormant')) NOT NULL DEFAULT 'active',
  opened_at  TIMESTAMPTZ DEFAULT now(),
  closed_at  TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE savings_deposit_requests (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES profiles(id),
  account_id       UUID NOT NULL REFERENCES savings_accounts(id),
  amount           DECIMAL(15,2) NOT NULL CHECK (amount > 0),
  payment_method   VARCHAR CHECK (payment_method IN ('cash','bank_transfer','mobile_money')) NOT NULL,
  reference        VARCHAR,
  receipt_url      VARCHAR,
  notes            TEXT,
  status           VARCHAR CHECK (status IN ('pending','approved','rejected')) NOT NULL DEFAULT 'pending',
  reviewed_by      UUID REFERENCES profiles(id),
  reviewed_at      TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);

-- Immutable record created when a deposit request is approved
CREATE TABLE savings_contributions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     UUID NOT NULL REFERENCES savings_accounts(id),
  user_id        UUID NOT NULL REFERENCES profiles(id),
  request_id     UUID REFERENCES savings_deposit_requests(id),
  amount         DECIMAL(15,2) NOT NULL CHECK (amount > 0),
  payment_method VARCHAR NOT NULL,
  reference      VARCHAR,
  recorded_by    UUID REFERENCES profiles(id),
  contributed_at TIMESTAMPTZ DEFAULT now(),
  created_at     TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE savings_withdrawal_requests (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES profiles(id),
  account_id       UUID NOT NULL REFERENCES savings_accounts(id),
  amount           DECIMAL(15,2) NOT NULL CHECK (amount > 0),
  reason           TEXT,
  status           VARCHAR CHECK (status IN ('pending','approved','rejected')) NOT NULL DEFAULT 'pending',
  reviewed_by      UUID REFERENCES profiles(id),
  reviewed_at      TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE savings_interest_logs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        UUID NOT NULL REFERENCES savings_accounts(id),
  user_id           UUID NOT NULL REFERENCES profiles(id),
  principal_at_time DECIMAL(15,2) NOT NULL,
  interest_earned   DECIMAL(15,2) NOT NULL,
  period_start      DATE NOT NULL,
  period_end        DATE NOT NULL,
  released_by       VARCHAR NOT NULL DEFAULT 'system',
  created_at        TIMESTAMPTZ DEFAULT now()
);

-- ─── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE savings_accounts           ENABLE ROW LEVEL SECURITY;
ALTER TABLE savings_deposit_requests   ENABLE ROW LEVEL SECURITY;
ALTER TABLE savings_contributions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE savings_withdrawal_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE savings_interest_logs      ENABLE ROW LEVEL SECURITY;

CREATE POLICY savings_accounts_self ON savings_accounts
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY savings_accounts_admin ON savings_accounts
  FOR ALL USING (get_user_role(auth.uid()) IN ('admin','staff'));

CREATE POLICY savings_deposit_requests_self ON savings_deposit_requests
  FOR ALL USING (user_id = auth.uid());
CREATE POLICY savings_deposit_requests_admin ON savings_deposit_requests
  FOR ALL USING (get_user_role(auth.uid()) IN ('admin','staff'));

CREATE POLICY savings_contributions_self ON savings_contributions
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY savings_contributions_admin ON savings_contributions
  FOR ALL USING (get_user_role(auth.uid()) IN ('admin','staff'));

CREATE POLICY savings_withdrawal_requests_self ON savings_withdrawal_requests
  FOR ALL USING (user_id = auth.uid());
CREATE POLICY savings_withdrawal_requests_admin ON savings_withdrawal_requests
  FOR ALL USING (get_user_role(auth.uid()) IN ('admin','staff'));

CREATE POLICY savings_interest_logs_self ON savings_interest_logs
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY savings_interest_logs_admin ON savings_interest_logs
  FOR ALL USING (get_user_role(auth.uid()) IN ('admin','staff'));

-- ─── Extend ledger entry_type to include savings entries ──────────────────────

ALTER TABLE ledger_entries DROP CONSTRAINT IF EXISTS ledger_entries_entry_type_check;
ALTER TABLE ledger_entries ADD CONSTRAINT ledger_entries_entry_type_check
  CHECK (entry_type IN (
    'equity_contribution','equity_reversal',
    'loan_disbursement','loan_repayment',
    'fee','adjustment',
    'savings_deposit','savings_withdrawal','savings_interest'
  ));

-- ─── Trigger: update balance + ledger when contribution inserted ──────────────

CREATE OR REPLACE FUNCTION savings_on_contribution()
RETURNS TRIGGER AS $$
BEGIN
  -- Update account balance
  UPDATE savings_accounts
  SET balance = balance + NEW.amount, updated_at = now()
  WHERE id = NEW.account_id;

  -- Append ledger entry
  INSERT INTO ledger_entries (user_id, entry_type, reference_id, reference_table, amount, direction, created_by)
  VALUES (NEW.user_id, 'savings_deposit', NEW.id, 'savings_contributions', NEW.amount, 'credit', NEW.recorded_by);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER after_savings_contribution
  AFTER INSERT ON savings_contributions
  FOR EACH ROW EXECUTE FUNCTION savings_on_contribution();

-- ─── Auto-create savings account when first share completes ──────────────────

CREATE OR REPLACE FUNCTION auto_create_savings_account()
RETURNS TRIGGER AS $$
BEGIN
  -- When completed_shares goes from 0 to ≥ 1, open a savings account if not already there
  IF (OLD.completed_shares = 0 OR OLD.completed_shares IS NULL) AND NEW.completed_shares >= 1 THEN
    INSERT INTO savings_accounts (user_id)
    VALUES (NEW.user_id)
    ON CONFLICT (user_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER after_membership_status_update_savings
  AFTER UPDATE ON membership_status
  FOR EACH ROW EXECUTE FUNCTION auto_create_savings_account();

-- ─── RPCs ──────────────────────────────────────────────────────────────────────

-- Approve a savings deposit request
CREATE OR REPLACE FUNCTION approve_savings_deposit(p_request_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req        savings_deposit_requests%ROWTYPE;
  v_weekly_cap DECIMAL(15,2);
  v_weekly_sum DECIMAL(15,2);
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin','staff') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT * INTO v_req FROM savings_deposit_requests WHERE id = p_request_id;

  IF v_req.status != 'pending' THEN
    RAISE EXCEPTION 'Request is not pending';
  END IF;

  -- Check weekly deposit cap
  SELECT COALESCE(config_value::DECIMAL, 0) INTO v_weekly_cap
  FROM system_config WHERE config_key = 'savings_weekly_cap';

  IF v_weekly_cap > 0 THEN
    SELECT COALESCE(SUM(sc.amount), 0) INTO v_weekly_sum
    FROM savings_contributions sc
    WHERE sc.user_id = v_req.user_id
      AND sc.contributed_at >= date_trunc('week', now());

    IF v_weekly_sum + v_req.amount > v_weekly_cap THEN
      RAISE EXCEPTION 'Weekly deposit cap of % would be exceeded (already deposited %)',
        v_weekly_cap, v_weekly_sum;
    END IF;
  END IF;

  -- Create contribution (trigger handles balance update + ledger)
  INSERT INTO savings_contributions (
    account_id, user_id, request_id, amount, payment_method, reference, recorded_by
  )
  VALUES (
    v_req.account_id, v_req.user_id, v_req.id,
    v_req.amount, v_req.payment_method, v_req.reference, auth.uid()
  );

  -- Mark approved
  UPDATE savings_deposit_requests
  SET status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
  WHERE id = p_request_id;
END;
$$;

GRANT EXECUTE ON FUNCTION approve_savings_deposit(UUID) TO authenticated;

-- Reject a savings deposit request
CREATE OR REPLACE FUNCTION reject_savings_deposit(p_request_id UUID, p_reason TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin','staff') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  UPDATE savings_deposit_requests
  SET status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(),
      rejection_reason = p_reason, updated_at = now()
  WHERE id = p_request_id AND status = 'pending';
END;
$$;

GRANT EXECUTE ON FUNCTION reject_savings_deposit(UUID, TEXT) TO authenticated;

-- Approve a savings withdrawal request
CREATE OR REPLACE FUNCTION approve_savings_withdrawal(p_request_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req     savings_withdrawal_requests%ROWTYPE;
  v_balance DECIMAL(15,2);
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin','staff') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT * INTO v_req FROM savings_withdrawal_requests WHERE id = p_request_id;

  IF v_req.status != 'pending' THEN
    RAISE EXCEPTION 'Request is not pending';
  END IF;

  SELECT balance INTO v_balance FROM savings_accounts WHERE id = v_req.account_id;

  IF v_balance < v_req.amount THEN
    RAISE EXCEPTION 'Insufficient balance (balance: %, requested: %)', v_balance, v_req.amount;
  END IF;

  -- Deduct from balance
  UPDATE savings_accounts
  SET balance = balance - v_req.amount, updated_at = now()
  WHERE id = v_req.account_id;

  -- Append ledger entry
  INSERT INTO ledger_entries (user_id, entry_type, reference_id, reference_table, amount, direction, created_by)
  VALUES (v_req.user_id, 'savings_withdrawal', v_req.id, 'savings_withdrawal_requests', v_req.amount, 'debit', auth.uid());

  -- Mark approved
  UPDATE savings_withdrawal_requests
  SET status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
  WHERE id = p_request_id;
END;
$$;

GRANT EXECUTE ON FUNCTION approve_savings_withdrawal(UUID) TO authenticated;

-- Reject a savings withdrawal request
CREATE OR REPLACE FUNCTION reject_savings_withdrawal(p_request_id UUID, p_reason TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin','staff') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  UPDATE savings_withdrawal_requests
  SET status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(),
      rejection_reason = p_reason, updated_at = now()
  WHERE id = p_request_id AND status = 'pending';
END;
$$;

GRANT EXECUTE ON FUNCTION reject_savings_withdrawal(UUID, TEXT) TO authenticated;

-- Release interest to all active savings accounts (called by pg_cron every 6 months)
CREATE OR REPLACE FUNCTION release_savings_interest()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rate         DECIMAL(5,2);
  v_period_start DATE;
  v_period_end   DATE;
  v_account      savings_accounts%ROWTYPE;
  v_interest     DECIMAL(15,2);
BEGIN
  SELECT COALESCE(config_value::DECIMAL, 2.5) INTO v_rate
  FROM system_config WHERE config_key = 'savings_interest_rate';

  v_period_start := (now() - INTERVAL '6 months')::DATE;
  v_period_end   := now()::DATE;

  FOR v_account IN
    SELECT * FROM savings_accounts WHERE status = 'active' AND balance > 0
  LOOP
    v_interest := ROUND(v_account.balance * (v_rate / 100), 2);

    IF v_interest > 0 THEN
      -- Credit interest to balance
      UPDATE savings_accounts
      SET balance = balance + v_interest, updated_at = now()
      WHERE id = v_account.id;

      -- Log interest
      INSERT INTO savings_interest_logs (
        account_id, user_id, principal_at_time, interest_earned,
        period_start, period_end, released_by
      )
      VALUES (
        v_account.id, v_account.user_id, v_account.balance,
        v_interest, v_period_start, v_period_end, 'system'
      );

      -- Append ledger entry
      INSERT INTO ledger_entries (
        user_id, entry_type, reference_id, reference_table, amount, direction, created_by
      )
      SELECT v_account.user_id, 'savings_interest', sil.id, 'savings_interest_logs', v_interest, 'credit', NULL
      FROM savings_interest_logs sil
      WHERE sil.account_id = v_account.id
      ORDER BY sil.created_at DESC
      LIMIT 1;
    END IF;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION release_savings_interest() TO authenticated;

-- ─── New system_config entries ────────────────────────────────────────────────

INSERT INTO system_config (config_key, config_value, value_type, description) VALUES
  ('savings_interest_rate',         '2.5',  'number',  'Interest rate credited per period (default every 6 months)'),
  ('savings_interest_period_months','6',    'number',  'How many months between interest releases'),
  ('savings_min_deposit',           '500',  'number',  'Minimum single savings deposit amount'),
  ('savings_weekly_cap',            '5000', 'number',  'Maximum total savings deposits per member per calendar week'),
  ('savings_required_for_loan',     'true', 'boolean', 'Whether an active savings account is required before a loan application')
ON CONFLICT (config_key) DO NOTHING;

-- ─── pg_cron schedule (run separately in Supabase dashboard if pg_cron is enabled) ──
-- SELECT cron.schedule('release-savings-interest', '0 0 1 */6 *', 'SELECT release_savings_interest()');
