-- Migration 84: Also auto-create equity share on INSERT into profiles when role = 'member'
-- Migration 73 handles role changes (UPDATE), but new registrations are direct inserts
-- with role = 'member', so the UPDATE trigger never fires for them.

CREATE OR REPLACE FUNCTION auto_create_equity_share_on_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_share_price DECIMAL(15,2);
BEGIN
  IF NEW.role <> 'member' THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(config_value::DECIMAL, 5000) INTO v_share_price
  FROM system_config
  WHERE config_key = 'share_price'
  LIMIT 1;

  v_share_price := COALESCE(v_share_price, 5000);

  INSERT INTO equity_shares (user_id, share_number, target_amount, paid_amount, status)
  VALUES (NEW.id, 1, v_share_price, 0, 'active');

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_create_equity_share_on_insert ON profiles;

CREATE TRIGGER trg_auto_create_equity_share_on_insert
  AFTER INSERT ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION auto_create_equity_share_on_insert();
