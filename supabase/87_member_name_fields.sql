-- Add first_name, middle_name, last_name to profiles
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS first_name VARCHAR,
  ADD COLUMN IF NOT EXISTS middle_name VARCHAR,
  ADD COLUMN IF NOT EXISTS last_name VARCHAR;

-- Update handle_new_user to populate name fields from metadata
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, first_name, middle_name, last_name, phone, role, account_status, employee_id)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', 'Unknown'),
    NEW.raw_user_meta_data->>'first_name',
    NEW.raw_user_meta_data->>'middle_name',
    NEW.raw_user_meta_data->>'last_name',
    NEW.raw_user_meta_data->>'phone',
    'member',
    'active',
    NEW.raw_user_meta_data->>'employee_id'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- RPC to check email availability (checks auth.users, requires service role in app context)
-- Called from admin UI to validate email before creating a member
CREATE OR REPLACE FUNCTION is_email_available(p_email TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN NOT EXISTS (
    SELECT 1 FROM auth.users WHERE email = lower(trim(p_email))
  );
END;
$$;

GRANT EXECUTE ON FUNCTION is_email_available(TEXT) TO authenticated;
