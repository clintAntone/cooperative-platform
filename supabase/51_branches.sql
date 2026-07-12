CREATE TABLE branches (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       VARCHAR NOT NULL,
  location   TEXT,
  is_active  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE branches ENABLE ROW LEVEL SECURITY;
-- All authenticated can read branches; admin manages
CREATE POLICY branches_read ON branches FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY branches_admin ON branches FOR ALL USING (get_user_role(auth.uid()) = 'admin');

-- Add branch_id to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id);

-- Assign member to a branch
CREATE OR REPLACE FUNCTION assign_member_branch(p_user_id UUID, p_branch_id UUID)
RETURNS VOID AS $$
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin','staff') THEN RAISE EXCEPTION 'Access denied'; END IF;
  UPDATE profiles SET branch_id = p_branch_id, updated_at = now() WHERE id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
GRANT EXECUTE ON FUNCTION assign_member_branch(UUID, UUID) TO authenticated;
