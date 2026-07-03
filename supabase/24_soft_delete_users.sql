-- Soft delete for profiles: instead of hard-deleting, set deleted_at
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

-- RPC for admin to soft-delete a user
CREATE OR REPLACE FUNCTION admin_soft_delete_user(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF get_user_role(auth.uid()) != 'admin' THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  UPDATE profiles
  SET deleted_at = now(), updated_at = now()
  WHERE id = p_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_soft_delete_user(UUID) TO authenticated;

-- RPC to restore a soft-deleted user
CREATE OR REPLACE FUNCTION admin_restore_user(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF get_user_role(auth.uid()) != 'admin' THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  UPDATE profiles
  SET deleted_at = NULL, updated_at = now()
  WHERE id = p_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_restore_user(UUID) TO authenticated;
