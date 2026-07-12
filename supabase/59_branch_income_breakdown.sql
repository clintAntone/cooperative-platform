-- Migration 59: Add gross_sales, salary, expenses_total, roi to branch_income
--
-- net_profit (the distributable amount) = gross_sales - salary - expenses_total
-- roi is stored as a percentage (user-entered, informational)

ALTER TABLE branch_income
  ADD COLUMN IF NOT EXISTS gross_sales     DECIMAL(15,2),
  ADD COLUMN IF NOT EXISTS salary          DECIMAL(15,2),
  ADD COLUMN IF NOT EXISTS expenses_total  DECIMAL(15,2),
  ADD COLUMN IF NOT EXISTS roi             DECIMAL(8,2);

-- ─── Update record_branch_income() to accept new fields ──────────────────────
DROP FUNCTION IF EXISTS record_branch_income(UUID, DECIMAL, DATE, DATE, TEXT);

CREATE OR REPLACE FUNCTION record_branch_income(
  p_branch_id      UUID,
  p_amount         DECIMAL,
  p_period_start   DATE,
  p_period_end     DATE,
  p_description    TEXT    DEFAULT NULL,
  p_gross_sales    DECIMAL DEFAULT NULL,
  p_salary         DECIMAL DEFAULT NULL,
  p_expenses_total DECIMAL DEFAULT NULL,
  p_roi            DECIMAL DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_income_id UUID;
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin','staff') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  INSERT INTO branch_income (
    branch_id, amount, period_start, period_end, description,
    gross_sales, salary, expenses_total, roi, recorded_by
  )
  VALUES (
    p_branch_id, p_amount, p_period_start, p_period_end, p_description,
    p_gross_sales, p_salary, p_expenses_total, p_roi, auth.uid()
  )
  RETURNING id INTO v_income_id;

  RETURN v_income_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION record_branch_income(UUID, DECIMAL, DATE, DATE, TEXT, DECIMAL, DECIMAL, DECIMAL, DECIMAL) TO authenticated;
