-- Equity Tables
CREATE TABLE equity_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  share_number INT NOT NULL,
  target_amount DECIMAL(15,2) NOT NULL,
  paid_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  status VARCHAR CHECK (status IN ('in_progress','completed','cancelled')) NOT NULL DEFAULT 'in_progress',
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, share_number)
);

CREATE TABLE equity_contributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id),
  share_id UUID NOT NULL REFERENCES equity_shares(id),
  amount DECIMAL(15,2) NOT NULL CHECK (amount > 0),
  payment_method VARCHAR CHECK (payment_method IN ('cash','bank_transfer','mobile_money')) NOT NULL,
  reference VARCHAR,
  recorded_by UUID REFERENCES profiles(id),
  contribution_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Auto-update share paid_amount and status on contribution insert
CREATE OR REPLACE FUNCTION update_share_on_contribution()
RETURNS TRIGGER AS $$
DECLARE
  v_share equity_shares%ROWTYPE;
BEGIN
  SELECT * INTO v_share FROM equity_shares WHERE id = NEW.share_id FOR UPDATE;

  UPDATE equity_shares
  SET
    paid_amount = paid_amount + NEW.amount,
    status = CASE WHEN paid_amount + NEW.amount >= target_amount THEN 'completed' ELSE status END,
    completed_at = CASE WHEN paid_amount + NEW.amount >= target_amount THEN now() ELSE completed_at END,
    updated_at = now()
  WHERE id = NEW.share_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER after_contribution_insert
  AFTER INSERT ON equity_contributions
  FOR EACH ROW EXECUTE FUNCTION update_share_on_contribution();
