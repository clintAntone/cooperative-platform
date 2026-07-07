-- Member document uploads (gov ID, proof of address, etc.)
-- Members upload via their profile page; admin/staff view in member detail.

CREATE TABLE IF NOT EXISTS member_documents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  document_type VARCHAR CHECK (document_type IN ('government_id', 'proof_of_address', 'other')) NOT NULL,
  file_name     TEXT NOT NULL,
  file_url      TEXT NOT NULL,
  uploaded_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_member_documents_user ON member_documents(user_id, uploaded_at DESC);

ALTER TABLE member_documents ENABLE ROW LEVEL SECURITY;

-- Members can manage their own documents
CREATE POLICY member_documents_self ON member_documents
  FOR ALL USING (user_id = auth.uid());

-- Admin and staff can view all documents
CREATE POLICY member_documents_admin ON member_documents
  FOR SELECT USING (get_user_role(auth.uid()) IN ('admin', 'staff'));

-- Storage bucket: member-documents
-- Run in Supabase dashboard or via CLI:
--   supabase storage create member-documents --public false
-- Then add policy: allow authenticated users to upload to their own folder (user_id/*)
-- and allow admin/staff to read all.
