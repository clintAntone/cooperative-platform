-- Sort deposits breakdown most-recent first.

DROP FUNCTION IF EXISTS get_savings_deposits_breakdown(UUID);

CREATE OR REPLACE FUNCTION get_savings_deposits_breakdown(p_account_id UUID)
RETURNS TABLE (
  contribution_id   UUID,
  request_id        UUID,
  contributed_at    TIMESTAMPTZ,
  amount            DECIMAL(15,2),
  days_held         INTEGER,
  accrued_interest  DECIMAL(15,2),
  reference         VARCHAR
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_period_start       TIMESTAMPTZ;
  v_had_prior_interest BOOLEAN;
  v_period_days        INTEGER;
  v_rate               DECIMAL(5,2);
  v_period_months      INT;
  v_total_period_days  DECIMAL(10,4);
BEGIN
  SELECT created_at INTO v_period_start
  FROM savings_interest_logs
  WHERE account_id = p_account_id
  ORDER BY created_at DESC LIMIT 1;

  v_had_prior_interest := v_period_start IS NOT NULL;

  IF NOT v_had_prior_interest THEN
    SELECT MIN(sc2.contributed_at) INTO v_period_start
    FROM savings_contributions sc2
    WHERE sc2.account_id = p_account_id;
  END IF;

  IF v_period_start IS NULL THEN RETURN; END IF;

  v_period_days := FLOOR(EXTRACT(EPOCH FROM (now() - v_period_start)) / 86400)::INTEGER;
  IF v_period_days = 0 THEN RETURN; END IF;

  SELECT COALESCE(config_value::DECIMAL, 2.5) INTO v_rate
  FROM system_config WHERE config_key = 'savings_interest_rate';

  SELECT COALESCE(config_value::INT, 6) INTO v_period_months
  FROM system_config WHERE config_key = 'savings_interest_period_months';

  v_total_period_days := v_period_months * (365.0 / 12.0);

  RETURN QUERY
  SELECT
    sc.id                                                                       AS contribution_id,
    sc.request_id                                                               AS request_id,
    sc.contributed_at,
    sc.amount,
    FLOOR(EXTRACT(EPOCH FROM (now() - sc.contributed_at)) / 86400)::INTEGER    AS days_held,
    ROUND(
      sc.amount
      * (v_rate / 100.0)
      * (FLOOR(EXTRACT(EPOCH FROM (now() - sc.contributed_at)) / 86400)::DECIMAL / v_total_period_days)
    , 2)                                                                        AS accrued_interest,
    sdr.reference                                                               AS reference
  FROM savings_contributions sc
  LEFT JOIN savings_deposit_requests sdr ON sdr.id = sc.request_id
  WHERE sc.account_id = p_account_id
    AND (NOT v_had_prior_interest OR sc.contributed_at > v_period_start)
  ORDER BY sc.contributed_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION get_savings_deposits_breakdown(UUID) TO authenticated;
