-- Users and Roles
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name VARCHAR NOT NULL,
  phone VARCHAR,
  role VARCHAR CHECK (role IN ('admin','member','staff')) NOT NULL DEFAULT 'member',
  account_status VARCHAR CHECK (account_status IN ('active','suspended','inactive')) NOT NULL DEFAULT 'active',
  employee_id VARCHAR UNIQUE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, phone, role, account_status, employee_id)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', 'Unknown'),
    NEW.raw_user_meta_data->>'phone',
    'member',
    'active',
    NEW.raw_user_meta_data->>'employee_id'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
