-- Migration 73: Auto-create one empty equity share when a user's role is set to 'member'
-- This fires when admin accepts a user (assigns member role via admin_update_user_role).
-- The share is created with paid_amount = 0 and status = 'active', so the member
-- is considered "pending" until they complete paying it.

CREATE OR REPLACE FUNCTION auto_create_equity_share_on_member()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_share_price  DECIMAL(15,2);
  v_share_count  INT;
BEGIN
  -- Only fire when role changes TO 'member'
  IF NEW.role <> 'member' OR OLD.role = 'member' THEN
    RETURN NEW;
  END IF;

  -- Check if the member already has any equity shares
  SELECT COUNT(*) INTO v_share_count
  FROM equity_shares
  WHERE user_id = NEW.id;

  IF v_share_count > 0 THEN
    RETURN NEW;
  END IF;

  -- Read share price from system_config (default 5000 if not found)
  SELECT COALESCE(config_value::DECIMAL, 5000) INTO v_share_price
  FROM system_config
  WHERE config_key = 'share_price'
  LIMIT 1;

  v_share_price := COALESCE(v_share_price, 5000);

  -- Create one empty share
  INSERT INTO equity_shares (user_id, share_number, target_amount, paid_amount, status)
  VALUES (NEW.id, 1, v_share_price, 0, 'active');

  RETURN NEW;
END;
$$;

-- Drop trigger if it already exists, then recreate
DROP TRIGGER IF EXISTS trg_auto_create_equity_share ON profiles;

CREATE TRIGGER trg_auto_create_equity_share
  AFTER UPDATE OF role ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION auto_create_equity_share_on_member();
