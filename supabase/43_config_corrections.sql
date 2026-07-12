-- Correct system_config values based on owner review.

-- Equity shares: minimum weekly installment
UPDATE system_config SET config_value = '250',
  description = 'Minimum deposit installment per week for equity shares'
WHERE config_key = 'min_installment_amount';

-- Savings: separate minimum deposit from minimum balance
UPDATE system_config SET config_value = '100',
  description = 'Minimum single savings deposit amount'
WHERE config_key = 'savings_min_deposit';

INSERT INTO system_config (config_key, config_value, value_type, description) VALUES
  ('savings_min_balance', '500', 'number',
   'Minimum balance that must remain in a savings account (cannot withdraw below this)')
ON CONFLICT (config_key) DO NOTHING;

-- Loans: corrected interest rate and max term
UPDATE system_config SET config_value = '3.33',
  description = 'Monthly loan interest rate (%)'
WHERE config_key = 'loan_interest_rate';

INSERT INTO system_config (config_key, config_value, value_type, description) VALUES
  ('max_loan_term_months', '6', 'number',
   'Maximum allowed loan repayment term in months')
ON CONFLICT (config_key) DO NOTHING;

-- Loan amount formula: collateral-based (replaces multiplier for first-time loans)
-- Max = borrower completed shares value + borrower savings balance
--       + co-maker completed shares value + co-maker savings balance
INSERT INTO system_config (config_key, config_value, value_type, description) VALUES
  ('loan_amount_formula', 'collateral', 'enum',
   'How max loan is computed: collateral = (borrower shares + savings) + (co-maker shares + savings)')
ON CONFLICT (config_key) DO NOTHING;
