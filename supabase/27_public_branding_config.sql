-- Allow unauthenticated (anon) users to read branding config keys.
-- Needed so the login/register pages can display the app name and logo
-- before a session exists.
CREATE POLICY config_public_branding ON system_config
  FOR SELECT
  USING (config_key IN ('app_name', 'app_logo_url'));
