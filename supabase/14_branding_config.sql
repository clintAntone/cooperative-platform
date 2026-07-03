-- Insert branding config keys if they don't already exist
INSERT INTO system_config (config_key, config_value, value_type, description)
VALUES
  ('app_name',    'CoopFinance',  'string', 'Name of the application shown in the sidebar and browser title'),
  ('app_vision',  '',             'string', 'Vision statement of the cooperative'),
  ('app_mission', '',             'string', 'Mission statement of the cooperative'),
  ('app_logo_url','',             'string', 'URL to the uploaded cooperative logo image')
ON CONFLICT (config_key) DO NOTHING;

-- Create branding storage bucket (public, so logo URLs work without auth)
INSERT INTO storage.buckets (id, name, public)
VALUES ('branding', 'branding', true)
ON CONFLICT (id) DO NOTHING;

-- Anyone authenticated can read branding assets (logo is public anyway)
CREATE POLICY "branding_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'branding');

-- Only admins can upload/update/delete branding assets
CREATE POLICY "branding_admin_insert"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'branding'
    AND get_user_role(auth.uid()) = 'admin'
  );

CREATE POLICY "branding_admin_update"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'branding'
    AND get_user_role(auth.uid()) = 'admin'
  );

CREATE POLICY "branding_admin_delete"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'branding'
    AND get_user_role(auth.uid()) = 'admin'
  );
