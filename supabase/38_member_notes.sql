-- Admin/staff internal notes on members.
-- Not visible to members themselves.

CREATE TABLE IF NOT EXISTS member_notes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  author_id  UUID NOT NULL REFERENCES profiles(id),
  note       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_member_notes_member ON member_notes(member_id, created_at DESC);

ALTER TABLE member_notes ENABLE ROW LEVEL SECURITY;

-- Only admin and staff can read/write notes
CREATE POLICY member_notes_admin ON member_notes
  FOR ALL USING (get_user_role(auth.uid()) IN ('admin', 'staff'));
