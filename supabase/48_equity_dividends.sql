-- Extend ledger entry_type
ALTER TABLE ledger_entries DROP CONSTRAINT IF EXISTS ledger_entries_entry_type_check;
ALTER TABLE ledger_entries ADD CONSTRAINT ledger_entries_entry_type_check CHECK (entry_type IN (
  'equity_contribution','equity_reversal',
  'loan_disbursement','loan_repayment',
  'fee','adjustment',
  'savings_deposit','savings_withdrawal','savings_interest',
  'equity_dividend'
));

CREATE TABLE equity_dividend_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  share_id UUID NOT NULL REFERENCES equity_shares(id),
  user_id UUID NOT NULL REFERENCES profiles(id),
  share_value DECIMAL(15,2) NOT NULL,
  dividend_earned DECIMAL(15,2) NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  released_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE equity_dividend_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY dividend_logs_self ON equity_dividend_logs FOR SELECT USING (user_id = auth.uid());
CREATE POLICY dividend_logs_admin ON equity_dividend_logs FOR ALL USING (get_user_role(auth.uid()) IN ('admin','staff'));

-- system_config entries
INSERT INTO system_config (config_key, config_value, value_type, description) VALUES
  ('equity_dividend_rate', '5', 'number', 'Dividend rate (%) applied to completed share value per period'),
  ('equity_dividend_period_months', '12', 'number', 'Dividend release cadence in months (default annual)')
ON CONFLICT (config_key) DO NOTHING;

-- release_equity_dividend(): admin triggers annually
-- Credits dividend to savings_accounts.balance if member has one, always logs to ledger
CREATE OR REPLACE FUNCTION release_equity_dividend()
RETURNS INT AS $$
DECLARE
  v_rate        DECIMAL;
  v_period_end  DATE := CURRENT_DATE;
  v_count       INT := 0;
  v_period_start DATE;
  v_dividend    DECIMAL(15,2);
  r             RECORD;
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin') THEN
    RAISE EXCEPTION 'Access denied — only admin can release dividends';
  END IF;

  SELECT COALESCE(config_value::DECIMAL, 5) INTO v_rate
  FROM system_config WHERE config_key = 'equity_dividend_rate';

  FOR r IN
    SELECT es.id AS share_id, es.user_id, es.target_amount
    FROM equity_shares es
    WHERE es.status = 'completed'
  LOOP
    -- Period start: last dividend for this share, or 1 year ago
    SELECT COALESCE(MAX(period_end), v_period_end - INTERVAL '1 year')
    INTO v_period_start
    FROM equity_dividend_logs WHERE share_id = r.share_id;

    v_dividend := ROUND(r.target_amount * v_rate / 100.0, 2);

    INSERT INTO equity_dividend_logs (share_id, user_id, share_value, dividend_earned, period_start, period_end, released_by)
    VALUES (r.share_id, r.user_id, r.target_amount, v_dividend, v_period_start::DATE, v_period_end, auth.uid());

    -- Credit to savings account if exists
    UPDATE savings_accounts
    SET balance = balance + v_dividend, updated_at = now()
    WHERE user_id = r.user_id AND status = 'active';

    -- Ledger entry
    INSERT INTO ledger_entries (user_id, entry_type, reference_id, reference_table, amount, direction, notes, created_by)
    VALUES (r.user_id, 'equity_dividend', r.share_id, 'equity_shares', v_dividend, 'credit', 'Equity share dividend', auth.uid());

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION release_equity_dividend() TO authenticated;
