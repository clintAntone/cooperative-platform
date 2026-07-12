CREATE TABLE rebate_releases (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_start DATE NOT NULL,
  period_end   DATE NOT NULL,
  rebate_rate  DECIMAL(5,2) NOT NULL,
  total_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  released_by  UUID NOT NULL REFERENCES profiles(id),
  notes        TEXT,
  created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE rebate_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  release_id    UUID NOT NULL REFERENCES rebate_releases(id),
  user_id       UUID NOT NULL REFERENCES profiles(id),
  interest_paid DECIMAL(15,2) NOT NULL,
  rebate_rate   DECIMAL(5,2) NOT NULL,
  rebate_amount DECIMAL(15,2) NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE rebate_releases ENABLE ROW LEVEL SECURITY;
ALTER TABLE rebate_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY rebate_releases_admin ON rebate_releases FOR ALL USING (get_user_role(auth.uid()) IN ('admin','staff'));
CREATE POLICY rebate_releases_read ON rebate_releases FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY rebate_logs_self ON rebate_logs FOR SELECT USING (user_id = auth.uid());
CREATE POLICY rebate_logs_admin ON rebate_logs FOR ALL USING (get_user_role(auth.uid()) IN ('admin','staff'));

-- Extend ledger entry_type (final — includes all types from all migrations)
ALTER TABLE ledger_entries DROP CONSTRAINT IF EXISTS ledger_entries_entry_type_check;
ALTER TABLE ledger_entries ADD CONSTRAINT ledger_entries_entry_type_check CHECK (entry_type IN (
  'equity_contribution','equity_reversal',
  'loan_disbursement','loan_repayment',
  'fee','adjustment',
  'savings_deposit','savings_withdrawal','savings_interest',
  'equity_dividend',
  'share_transfer_out','share_transfer_in',
  'rebate'
));

INSERT INTO system_config (config_key, config_value, value_type, description) VALUES
  ('rebate_rate', '10', 'number', 'Rebate percentage of loan interest paid returned to members')
ON CONFLICT (config_key) DO NOTHING;

CREATE OR REPLACE FUNCTION release_rebates(p_period_start DATE, p_period_end DATE)
RETURNS UUID AS $$
DECLARE
  v_rate        DECIMAL;
  v_release_id  UUID;
  v_total       DECIMAL(15,2) := 0;
  v_rebate      DECIMAL(15,2);
  r             RECORD;
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin') THEN RAISE EXCEPTION 'Access denied'; END IF;

  SELECT COALESCE(config_value::DECIMAL, 10) INTO v_rate
  FROM system_config WHERE config_key = 'rebate_rate';

  -- Create release record
  INSERT INTO rebate_releases (period_start, period_end, rebate_rate, released_by, notes)
  VALUES (p_period_start, p_period_end, v_rate, auth.uid(), 'Loan interest rebate')
  RETURNING id INTO v_release_id;

  -- For each member, compute total interest paid during the period
  FOR r IN
    SELECT
      l.user_id,
      COALESCE(SUM(lrs.interest_due), 0) AS interest_paid
    FROM loan_repayment_schedule lrs
    JOIN loans l ON l.id = lrs.loan_id
    WHERE lrs.status = 'paid'
      AND lrs.paid_at >= p_period_start::TIMESTAMPTZ
      AND lrs.paid_at < (p_period_end + INTERVAL '1 day')::TIMESTAMPTZ
    GROUP BY l.user_id
    HAVING SUM(lrs.interest_due) > 0
  LOOP
    v_rebate := ROUND(r.interest_paid * v_rate / 100.0, 2);

    INSERT INTO rebate_logs (release_id, user_id, interest_paid, rebate_rate, rebate_amount)
    VALUES (v_release_id, r.user_id, r.interest_paid, v_rate, v_rebate);

    -- Credit to savings if exists
    UPDATE savings_accounts SET balance = balance + v_rebate, updated_at = now()
    WHERE user_id = r.user_id AND status = 'active';

    -- Ledger entry
    INSERT INTO ledger_entries (user_id, entry_type, reference_id, reference_table, amount, direction, notes, created_by)
    VALUES (r.user_id, 'rebate', v_release_id, 'rebate_releases', v_rebate, 'credit', 'Loan interest rebate', auth.uid());

    v_total := v_total + v_rebate;
  END LOOP;

  -- Update total on release record
  UPDATE rebate_releases SET total_amount = v_total WHERE id = v_release_id;

  RETURN v_release_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
GRANT EXECUTE ON FUNCTION release_rebates(DATE, DATE) TO authenticated;
