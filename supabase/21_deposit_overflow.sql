-- Fix approve_deposit_request: auto-create next share for overflow
-- instead of over-crediting the original share when no next share exists.

CREATE OR REPLACE FUNCTION approve_deposit_request(p_request_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req          deposit_requests%ROWTYPE;
  v_share        equity_shares%ROWTYPE;
  v_remaining    DECIMAL(15,2);
  v_to_credit    DECIMAL(15,2);
  v_leftover     DECIMAL(15,2);
  v_share_price  DECIMAL(15,2);
  v_max_shares   INT;
  v_share_count  INT;
  v_next_number  INT;
  v_new_share_id UUID;
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin','staff') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT * INTO v_req FROM deposit_requests WHERE id = p_request_id;

  IF v_req.status != 'pending' THEN
    RAISE EXCEPTION 'Request is not pending';
  END IF;

  v_leftover := v_req.amount;

  -- Walk through existing in-progress shares starting from the requested one
  FOR v_share IN
    SELECT * FROM equity_shares
    WHERE user_id = v_req.user_id
      AND status = 'in_progress'
      AND (id = v_req.share_id OR share_number > (
            SELECT share_number FROM equity_shares WHERE id = v_req.share_id
          ))
    ORDER BY
      CASE WHEN id = v_req.share_id THEN 0 ELSE 1 END,
      share_number ASC
  LOOP
    EXIT WHEN v_leftover <= 0;

    v_remaining := v_share.target_amount - v_share.paid_amount;
    v_to_credit := LEAST(v_leftover, v_remaining);

    INSERT INTO equity_contributions (user_id, share_id, amount, payment_method, reference, recorded_by)
    VALUES (v_req.user_id, v_share.id, v_to_credit, v_req.payment_method, v_req.reference, auth.uid());

    v_leftover := v_leftover - v_to_credit;
  END LOOP;

  -- If leftover remains, auto-open new shares and credit them
  IF v_leftover > 0 THEN
    -- Read config
    SELECT config_value::DECIMAL INTO v_share_price
    FROM system_config WHERE config_key = 'share_price';

    SELECT config_value::INT INTO v_max_shares
    FROM system_config WHERE config_key = 'max_shares_per_member';

    v_share_price := COALESCE(v_share_price, 5000);
    v_max_shares  := COALESCE(v_max_shares, 10);

    LOOP
      EXIT WHEN v_leftover <= 0;

      -- Count non-cancelled shares
      SELECT COUNT(*) INTO v_share_count
      FROM equity_shares
      WHERE user_id = v_req.user_id AND status != 'cancelled';

      EXIT WHEN v_share_count >= v_max_shares;

      -- Next share number
      SELECT COALESCE(MAX(share_number), 0) + 1 INTO v_next_number
      FROM equity_shares WHERE user_id = v_req.user_id;

      -- Create new share
      INSERT INTO equity_shares (user_id, share_number, target_amount)
      VALUES (v_req.user_id, v_next_number, v_share_price)
      RETURNING id INTO v_new_share_id;

      v_to_credit := LEAST(v_leftover, v_share_price);

      INSERT INTO equity_contributions (user_id, share_id, amount, payment_method, reference, recorded_by)
      VALUES (v_req.user_id, v_new_share_id, v_to_credit, v_req.payment_method, v_req.reference, auth.uid());

      v_leftover := v_leftover - v_to_credit;
    END LOOP;

    -- If still leftover (max shares reached), credit back to original share
    -- This records the excess so accounting doesn't lose the amount.
    IF v_leftover > 0 THEN
      INSERT INTO equity_contributions (user_id, share_id, amount, payment_method, reference, recorded_by)
      VALUES (v_req.user_id, v_req.share_id, v_leftover, v_req.payment_method, v_req.reference, auth.uid());
    END IF;
  END IF;

  -- Mark request approved
  UPDATE deposit_requests
  SET status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
  WHERE id = p_request_id;
END;
$$;

GRANT EXECUTE ON FUNCTION approve_deposit_request(UUID) TO authenticated;
