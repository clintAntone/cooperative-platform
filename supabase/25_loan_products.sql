-- Loan Products table
-- Admins define reusable loan product templates; members select one when applying.
-- Also adds loan_product_id FK to loan_applications.

CREATE TABLE IF NOT EXISTS loan_products (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                text NOT NULL,
  description         text,
  interest_rate       numeric(5, 2) NOT NULL,
  min_amount          numeric(12, 2) NOT NULL DEFAULT 0,
  max_amount          numeric(12, 2),
  min_term_months     int NOT NULL DEFAULT 1,
  max_term_months     int NOT NULL DEFAULT 36,
  calculation_method  text NOT NULL DEFAULT 'reducing_balance'
                        CHECK (calculation_method IN ('flat', 'reducing_balance')),
  is_active           boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid REFERENCES auth.users (id)
);

-- Row-level security
ALTER TABLE loan_products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "loan_products_select" ON loan_products;
DROP POLICY IF EXISTS "loan_products_insert" ON loan_products;
DROP POLICY IF EXISTS "loan_products_update" ON loan_products;
DROP POLICY IF EXISTS "loan_products_delete" ON loan_products;

-- All authenticated users can read active products (members need this to apply)
CREATE POLICY "loan_products_select"
  ON loan_products FOR SELECT
  TO authenticated
  USING (
    is_active = true
    OR get_user_role(auth.uid()) IN ('admin', 'staff')
  );

-- Only admin / staff can insert
CREATE POLICY "loan_products_insert"
  ON loan_products FOR INSERT
  TO authenticated
  WITH CHECK (get_user_role(auth.uid()) IN ('admin', 'staff'));

-- Only admin / staff can update (e.g. toggle active, edit details)
CREATE POLICY "loan_products_update"
  ON loan_products FOR UPDATE
  TO authenticated
  USING (get_user_role(auth.uid()) IN ('admin', 'staff'));

-- Only admin can delete
CREATE POLICY "loan_products_delete"
  ON loan_products FOR DELETE
  TO authenticated
  USING (get_user_role(auth.uid()) = 'admin');

-- Add loan_product_id to loan_applications
ALTER TABLE loan_applications
  ADD COLUMN IF NOT EXISTS loan_product_id uuid REFERENCES loan_products (id);
