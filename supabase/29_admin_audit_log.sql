-- Admin audit log: records admin actions such as impersonation start/end,
-- bulk approvals, config changes, etc.
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id        UUID NOT NULL REFERENCES auth.users(id),
  action          TEXT NOT NULL,
  target_user_id  UUID REFERENCES auth.users(id),
  metadata        JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_admin    ON admin_audit_log(admin_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_target   ON admin_audit_log(target_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_action   ON admin_audit_log(action, created_at DESC);

ALTER TABLE admin_audit_log ENABLE ROW LEVEL SECURITY;

-- Only admin can read the audit log
CREATE POLICY audit_log_admin_read ON admin_audit_log
  FOR SELECT
  USING (get_user_role(auth.uid()) = 'admin');

-- RPC used by the frontend to write audit log entries.
-- Accepts any action string so it can be reused for future admin actions
-- beyond impersonation.
CREATE OR REPLACE FUNCTION log_admin_action(
  p_action          TEXT,
  p_target_user_id  UUID    DEFAULT NULL,
  p_metadata        JSONB   DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin', 'staff') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  INSERT INTO admin_audit_log (admin_id, action, target_user_id, metadata)
  VALUES (auth.uid(), p_action, p_target_user_id, p_metadata)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION log_admin_action(TEXT, UUID, JSONB) TO authenticated;
