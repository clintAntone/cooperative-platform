-- Profile completion: additional fields for member identity verification

-- 1. Add new columns to profiles
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS avatar_url        TEXT,
  ADD COLUMN IF NOT EXISTS date_of_birth     DATE,
  ADD COLUMN IF NOT EXISTS address           TEXT,
  ADD COLUMN IF NOT EXISTS civil_status      VARCHAR(20)
    CHECK (civil_status IN ('single','married','widowed','separated','divorced')),
  ADD COLUMN IF NOT EXISTS emergency_contact_name  VARCHAR(255),
  ADD COLUMN IF NOT EXISTS emergency_contact_phone VARCHAR(50),
  ADD COLUMN IF NOT EXISTS profile_completed_at    TIMESTAMPTZ;

-- 2. Allow members (and all authenticated users) to update their own profile row
-- The existing RLS on profiles may only allow reads. Add a self-update policy.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'profiles'
      AND policyname = 'profiles_self_update'
  ) THEN
    CREATE POLICY profiles_self_update ON profiles
      FOR UPDATE
      USING (id = auth.uid())
      WITH CHECK (id = auth.uid());
  END IF;
END$$;

-- 3. Avatars storage bucket (idempotent)
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload/update their own avatar
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'avatars_upload'
  ) THEN
    CREATE POLICY avatars_upload ON storage.objects
      FOR INSERT TO authenticated
      WITH CHECK (
        bucket_id = 'avatars'
        AND (storage.foldername(name))[1] = auth.uid()::text
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'avatars_update'
  ) THEN
    CREATE POLICY avatars_update ON storage.objects
      FOR UPDATE TO authenticated
      USING (
        bucket_id = 'avatars'
        AND (storage.foldername(name))[1] = auth.uid()::text
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'avatars_public_read'
  ) THEN
    CREATE POLICY avatars_public_read ON storage.objects
      FOR SELECT TO public
      USING (bucket_id = 'avatars');
  END IF;
END$$;

-- 4. Update get_all_users_for_admin to include profile_completed_at
DROP FUNCTION IF EXISTS get_all_users_for_admin();
CREATE OR REPLACE FUNCTION get_all_users_for_admin()
RETURNS TABLE (
  id                   UUID,
  full_name            VARCHAR,
  phone                VARCHAR,
  role                 VARCHAR,
  account_status       VARCHAR,
  email                VARCHAR,
  membership_status    VARCHAR,
  completed_shares     INT,
  created_at           TIMESTAMPTZ,
  profile_completed_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin', 'staff') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.full_name,
    p.phone,
    p.role,
    p.account_status,
    u.email::VARCHAR,
    ms.status::VARCHAR       AS membership_status,
    ms.completed_shares,
    p.created_at,
    p.profile_completed_at
  FROM profiles p
  LEFT JOIN auth.users u ON u.id = p.id
  LEFT JOIN membership_status ms ON ms.user_id = p.id
  WHERE p.deleted_at IS NULL
  ORDER BY p.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION get_all_users_for_admin() TO authenticated;

-- 5. New RPC: get a single user's full profile for admin/staff view
CREATE OR REPLACE FUNCTION get_user_for_admin(p_user_id UUID)
RETURNS TABLE (
  id                       UUID,
  full_name                VARCHAR,
  phone                    VARCHAR,
  role                     VARCHAR,
  account_status           VARCHAR,
  email                    VARCHAR,
  employee_id              VARCHAR,
  avatar_url               TEXT,
  date_of_birth            DATE,
  address                  TEXT,
  civil_status             VARCHAR,
  emergency_contact_name   VARCHAR,
  emergency_contact_phone  VARCHAR,
  profile_completed_at     TIMESTAMPTZ,
  membership_status        VARCHAR,
  completed_shares         INT,
  created_at               TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF get_user_role(auth.uid()) NOT IN ('admin', 'staff') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.full_name,
    p.phone,
    p.role,
    p.account_status,
    u.email::VARCHAR,
    p.employee_id,
    p.avatar_url,
    p.date_of_birth,
    p.address,
    p.civil_status,
    p.emergency_contact_name,
    p.emergency_contact_phone,
    p.profile_completed_at,
    ms.status::VARCHAR       AS membership_status,
    ms.completed_shares,
    p.created_at
  FROM profiles p
  LEFT JOIN auth.users u ON u.id = p.id
  LEFT JOIN membership_status ms ON ms.user_id = p.id
  WHERE p.id = p_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION get_user_for_admin(UUID) TO authenticated;
