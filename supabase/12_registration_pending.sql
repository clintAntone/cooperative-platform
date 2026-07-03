-- Redefines handle_new_user() to include employee_id from metadata.
-- New users register as 'active' immediately (employee ID verification happens client-side).
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
