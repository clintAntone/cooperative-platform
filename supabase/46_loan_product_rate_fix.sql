-- Migration 46: P2 — Align active loan product interest rates with system_config
--
-- The system_config loan_interest_rate is 3.33% per month.
-- Any active loan products created before this was set may still carry
-- a different rate or an annual rate. This migration corrects them.
--
-- IMPORTANT: Review the results of the SELECT below before running the UPDATE.
-- If a product intentionally uses a different rate, exclude it by ID.

-- Preview affected products (run this first):
-- SELECT id, name, interest_rate, interest_rate_period, calculation_method
-- FROM loan_products WHERE is_active = true;

-- Update all active loan products to 3.33% monthly flat rate:
UPDATE loan_products
SET
  interest_rate        = 3.33,
  interest_rate_period = 'monthly',
  calculation_method   = 'flat'
WHERE is_active = true;
