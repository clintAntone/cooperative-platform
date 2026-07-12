CREATE TABLE damayan_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title             VARCHAR NOT NULL,
  description       TEXT,
  affected_member_id UUID REFERENCES profiles(id),
  event_date        DATE NOT NULL,
  assessment_amount DECIMAL(15,2) NOT NULL CHECK (assessment_amount > 0),
  status            VARCHAR CHECK (status IN ('active','closed')) NOT NULL DEFAULT 'active',
  created_by        UUID NOT NULL REFERENCES profiles(id),
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE damayan_assessments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    UUID NOT NULL REFERENCES damayan_events(id),
  user_id     UUID NOT NULL REFERENCES profiles(id),
  amount_due  DECIMAL(15,2) NOT NULL,
  amount_paid DECIMAL(15,2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  status      VARCHAR CHECK (status IN ('pending','paid','waived')) NOT NULL DEFAULT 'pending',
  paid_at     TIMESTAMPTZ,
  notes       TEXT,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE(event_id, user_id)
);

ALTER TABLE damayan_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE damayan_assessments ENABLE ROW LEVEL SECURITY;

-- All authenticated members can read events
CREATE POLICY damayan_events_read ON damayan_events FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY damayan_events_admin ON damayan_events FOR ALL USING (get_user_role(auth.uid()) IN ('admin','staff'));

-- Members see their own assessments; admin/staff see all
CREATE POLICY damayan_assessments_self ON damayan_assessments FOR SELECT USING (user_id = auth.uid());
CREATE POLICY damayan_assessments_admin ON damayan_assessments FOR ALL USING (get_user_role(auth.uid()) IN ('admin','staff'));

-- create_damayan_event: creates event + generates assessments for all active members
CREATE OR REPLACE FUNCTION create_damayan_event(
  p_title TEXT, p_description TEXT, p_affected_member_id UUID,
  p_event_date DATE, p_assessment_amount DECIMAL
)
RETURNS UUID AS $$
DECLARE
  v_event_id UUID;
  v_member RECORD;
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin','staff') THEN RAISE EXCEPTION 'Access denied'; END IF;

  INSERT INTO damayan_events (title, description, affected_member_id, event_date, assessment_amount, created_by)
  VALUES (p_title, p_description, p_affected_member_id, p_event_date, p_assessment_amount, auth.uid())
  RETURNING id INTO v_event_id;

  -- Generate assessment for every active member (except the affected member)
  FOR v_member IN
    SELECT id FROM profiles
    WHERE account_status = 'active' AND role = 'member'
      AND (p_affected_member_id IS NULL OR id != p_affected_member_id)
  LOOP
    INSERT INTO damayan_assessments (event_id, user_id, amount_due)
    VALUES (v_event_id, v_member.id, p_assessment_amount)
    ON CONFLICT (event_id, user_id) DO NOTHING;
  END LOOP;

  RETURN v_event_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
GRANT EXECUTE ON FUNCTION create_damayan_event(TEXT, TEXT, UUID, DATE, DECIMAL) TO authenticated;

-- record_damayan_payment: marks an assessment as paid
CREATE OR REPLACE FUNCTION record_damayan_payment(p_assessment_id UUID, p_notes TEXT DEFAULT NULL)
RETURNS VOID AS $$
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin','staff') THEN RAISE EXCEPTION 'Access denied'; END IF;
  UPDATE damayan_assessments
  SET status = 'paid', amount_paid = amount_due, paid_at = now(), notes = p_notes, updated_at = now()
  WHERE id = p_assessment_id AND status = 'pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'Assessment not found or already processed'; END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
GRANT EXECUTE ON FUNCTION record_damayan_payment(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION waive_damayan_assessment(p_assessment_id UUID, p_notes TEXT DEFAULT NULL)
RETURNS VOID AS $$
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin') THEN RAISE EXCEPTION 'Access denied'; END IF;
  UPDATE damayan_assessments
  SET status = 'waived', notes = p_notes, updated_at = now()
  WHERE id = p_assessment_id AND status = 'pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'Assessment not found or already processed'; END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
GRANT EXECUTE ON FUNCTION waive_damayan_assessment(UUID, TEXT) TO authenticated;
