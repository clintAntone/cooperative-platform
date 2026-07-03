-- Extend loan_products with interest period, equal_principal method, and fee columns

-- Allow equal_principal as a calculation method
ALTER TABLE loan_products DROP CONSTRAINT IF EXISTS loan_products_calculation_method_check;
ALTER TABLE loan_products ADD CONSTRAINT loan_products_calculation_method_check
  CHECK (calculation_method IN ('flat', 'reducing_balance', 'equal_principal'));

-- Interest rate period (monthly or annual)
ALTER TABLE loan_products
  ADD COLUMN IF NOT EXISTS interest_rate_period TEXT NOT NULL DEFAULT 'annual'
    CHECK (interest_rate_period IN ('monthly', 'annual'));

-- Fee columns
ALTER TABLE loan_products
  ADD COLUMN IF NOT EXISTS processing_fee_type TEXT CHECK (processing_fee_type IN ('fixed', 'percentage')),
  ADD COLUMN IF NOT EXISTS processing_fee_value NUMERIC,
  ADD COLUMN IF NOT EXISTS insurance_type TEXT CHECK (insurance_type IN ('fixed', 'percentage')),
  ADD COLUMN IF NOT EXISTS insurance_value NUMERIC,
  ADD COLUMN IF NOT EXISTS service_fee_type TEXT CHECK (service_fee_type IN ('fixed', 'percentage')),
  ADD COLUMN IF NOT EXISTS service_fee_value NUMERIC,
  ADD COLUMN IF NOT EXISTS cbu_type TEXT CHECK (cbu_type IN ('fixed', 'percentage')),
  ADD COLUMN IF NOT EXISTS cbu_value NUMERIC;
