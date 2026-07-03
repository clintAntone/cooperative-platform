-- System Configuration Tables
CREATE TABLE system_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_key VARCHAR UNIQUE NOT NULL,
  config_value VARCHAR NOT NULL,
  value_type VARCHAR CHECK (value_type IN ('string','number','boolean','enum')) NOT NULL,
  description TEXT,
  updated_by UUID REFERENCES auth.users(id),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE system_config_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_key VARCHAR NOT NULL,
  old_value VARCHAR,
  new_value VARCHAR NOT NULL,
  changed_by UUID REFERENCES auth.users(id),
  changed_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO system_config (config_key, config_value, value_type, description) VALUES
  ('currency_code', 'PHP', 'string', 'ISO currency code (e.g. PHP, USD, SGD)'),
  ('currency_symbol', '₱', 'string', 'Currency symbol shown in the UI (e.g. ₱, $, S$)'),
  ('share_price', '5000.00', 'number', 'Cost of one full equity share'),
  ('min_installment_amount', '100.00', 'number', 'Minimum allowed installment payment'),
  ('installment_frequency', 'weekly', 'enum', 'Allowed payment cadence: weekly, biweekly, monthly'),
  ('max_shares_per_member', '10', 'number', 'Cap on shares a single member can hold'),
  ('loan_to_equity_ratio', '2.0', 'number', 'Max loan amount relative to completed share value'),
  ('min_shares_for_loan', '1', 'number', 'Minimum completed shares required to apply for a loan'),
  ('max_loan_term_months', '36', 'number', 'Maximum repayment period in months'),
  ('loan_interest_rate', '12', 'number', 'Annual interest rate percentage'),
  ('interest_calculation_method', 'reducing_balance', 'enum', 'flat or reducing_balance'),
  ('grace_period_days', '7', 'number', 'Days before a missed payment triggers a flag'),
  ('loan_default_threshold_days', '30', 'number', 'Days overdue before a loan is marked defaulted'),
  ('membership_lapse_on_default', 'true', 'boolean', 'Whether loan default suspends membership');
