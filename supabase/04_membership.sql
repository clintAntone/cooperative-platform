-- Membership Tables
CREATE TABLE membership_status (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) UNIQUE,
  status VARCHAR CHECK (status IN ('pending','active','suspended','inactive')) NOT NULL DEFAULT 'pending',
  completed_shares INT NOT NULL DEFAULT 0,
  last_evaluated_at TIMESTAMPTZ DEFAULT now(),
  reason VARCHAR,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE membership_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id),
  from_status VARCHAR,
  to_status VARCHAR NOT NULL,
  reason TEXT,
  changed_at TIMESTAMPTZ DEFAULT now()
);

-- Function to evaluate membership for a user
CREATE OR REPLACE FUNCTION evaluate_membership(p_user_id UUID)
RETURNS VOID AS $$
DECLARE
  v_completed_shares INT;
  v_current_status VARCHAR;
  v_new_status VARCHAR;
  v_has_active_default BOOLEAN;
  v_lapse_on_default BOOLEAN;
BEGIN
  SELECT COUNT(*) INTO v_completed_shares
  FROM equity_shares
  WHERE user_id = p_user_id AND status = 'completed';

  SELECT (config_value = 'true') INTO v_lapse_on_default
  FROM system_config WHERE config_key = 'membership_lapse_on_default';

  SELECT EXISTS(
    SELECT 1 FROM loans WHERE user_id = p_user_id AND status = 'defaulted'
  ) INTO v_has_active_default;

  IF v_completed_shares = 0 THEN
    v_new_status := 'pending';
  ELSIF v_lapse_on_default AND v_has_active_default THEN
    v_new_status := 'suspended';
  ELSE
    v_new_status := 'active';
  END IF;

  SELECT status INTO v_current_status
  FROM membership_status WHERE user_id = p_user_id;

  IF v_current_status IS NULL THEN
    INSERT INTO membership_status (user_id, status, completed_shares, last_evaluated_at)
    VALUES (p_user_id, v_new_status, v_completed_shares, now());
  ELSIF v_current_status != v_new_status THEN
    INSERT INTO membership_history (user_id, from_status, to_status)
    VALUES (p_user_id, v_current_status, v_new_status);

    UPDATE membership_status
    SET status = v_new_status,
        completed_shares = v_completed_shares,
        last_evaluated_at = now(),
        updated_at = now()
    WHERE user_id = p_user_id;
  ELSE
    UPDATE membership_status
    SET completed_shares = v_completed_shares,
        last_evaluated_at = now(),
        updated_at = now()
    WHERE user_id = p_user_id;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Trigger membership evaluation when a share is completed
CREATE OR REPLACE FUNCTION trigger_membership_evaluation()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'completed' AND (OLD.status IS DISTINCT FROM 'completed') THEN
    PERFORM evaluate_membership(NEW.user_id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER on_share_completed
  AFTER UPDATE ON equity_shares
  FOR EACH ROW EXECUTE FUNCTION trigger_membership_evaluation();
