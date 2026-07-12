-- branch_expenses: categorized expense records per branch per period
CREATE TABLE branch_expenses (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id   UUID NOT NULL REFERENCES branches(id),
  category    VARCHAR CHECK (category IN ('salary','utilities','rent','supplies','maintenance','other')) NOT NULL DEFAULT 'other',
  amount      DECIMAL(15,2) NOT NULL CHECK (amount > 0),
  period_start DATE NOT NULL,
  period_end   DATE NOT NULL,
  description TEXT,
  recorded_by UUID NOT NULL REFERENCES profiles(id),
  created_at  TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE branch_expenses ENABLE ROW LEVEL SECURITY;
-- All authenticated users can read (members see branch financials)
CREATE POLICY branch_expenses_read ON branch_expenses FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY branch_expenses_admin ON branch_expenses FOR ALL USING (get_user_role(auth.uid()) IN ('admin','staff'));

CREATE OR REPLACE FUNCTION record_branch_expense(
  p_branch_id    UUID,
  p_category     VARCHAR,
  p_amount       DECIMAL,
  p_period_start DATE,
  p_period_end   DATE,
  p_description  TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE v_id UUID;
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin','staff') THEN RAISE EXCEPTION 'Access denied'; END IF;
  INSERT INTO branch_expenses (branch_id, category, amount, period_start, period_end, description, recorded_by)
  VALUES (p_branch_id, p_category, p_amount, p_period_start, p_period_end, p_description, auth.uid())
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
GRANT EXECUTE ON FUNCTION record_branch_expense(UUID, VARCHAR, DECIMAL, DATE, DATE, TEXT) TO authenticated;
