-- Ledger Tables
CREATE TABLE ledger_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id),
  entry_type VARCHAR CHECK (entry_type IN (
    'equity_contribution','equity_reversal',
    'loan_disbursement','loan_repayment',
    'fee','adjustment'
  )) NOT NULL,
  reference_id UUID NOT NULL,
  reference_table VARCHAR NOT NULL,
  amount DECIMAL(15,2) NOT NULL,
  direction VARCHAR CHECK (direction IN ('debit','credit')) NOT NULL,
  notes TEXT,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Append-only: no updates or deletes allowed
CREATE RULE no_update_ledger AS ON UPDATE TO ledger_entries DO INSTEAD NOTHING;
CREATE RULE no_delete_ledger AS ON DELETE TO ledger_entries DO INSTEAD NOTHING;

-- Auto-insert ledger entry on equity contribution
CREATE OR REPLACE FUNCTION ledger_on_contribution()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO ledger_entries (user_id, entry_type, reference_id, reference_table, amount, direction, created_by)
  VALUES (NEW.user_id, 'equity_contribution', NEW.id, 'equity_contributions', NEW.amount, 'credit', NEW.recorded_by);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER after_contribution_ledger
  AFTER INSERT ON equity_contributions
  FOR EACH ROW EXECUTE FUNCTION ledger_on_contribution();

-- Auto-insert ledger entry on loan repayment
CREATE OR REPLACE FUNCTION ledger_on_repayment()
RETURNS TRIGGER AS $$
DECLARE
  v_user_id UUID;
BEGIN
  SELECT user_id INTO v_user_id FROM loans WHERE id = NEW.loan_id;
  INSERT INTO ledger_entries (user_id, entry_type, reference_id, reference_table, amount, direction, created_by)
  VALUES (v_user_id, 'loan_repayment', NEW.id, 'loan_repayments', NEW.amount, 'debit', NEW.recorded_by);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER after_repayment_ledger
  AFTER INSERT ON loan_repayments
  FOR EACH ROW EXECUTE FUNCTION ledger_on_repayment();
