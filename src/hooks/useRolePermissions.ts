import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { toast } from '../lib/toast'
import type { PermissionKey } from '../lib/permissions'

// ─── Custom role permissions ──────────────────────────────────────────────────

export interface CustomRolePermission {
  id: string
  custom_role_id: string
  permission_key: PermissionKey
  enabled: boolean
}

/** Fetch all custom role permissions (for the permissions page — loads all roles at once) */
export function useAllCustomRolePermissions() {
  return useQuery({
    queryKey: ['custom_role_permissions'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('custom_role_permissions')
        .select('id, custom_role_id, permission_key, enabled')
      if (error) throw error
      return (data ?? []) as CustomRolePermission[]
    },
    staleTime: 60_000,
  })
}

export function useUpdateCustomRolePermission() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      custom_role_id,
      permission_key,
      enabled,
    }: {
      custom_role_id: string
      permission_key: PermissionKey
      enabled: boolean
    }) => {
      const { data: { user } } = await supabase.auth.getUser()
      const { error } = await supabase
        .from('custom_role_permissions')
        .upsert(
          { custom_role_id, permission_key, enabled, updated_by: user?.id, updated_at: new Date().toISOString() },
          { onConflict: 'custom_role_id,permission_key' }
        )
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['custom_role_permissions'] })
      toast({ title: 'Permission updated', variant: 'success' })
    },
    onError: (err: any) => {
      toast({ title: err.message ?? 'Failed to update permission', variant: 'error' })
    },
  })
}

export interface RolePermission {
  id: string
  role: 'staff' | 'member' | 'board'
  permission_key: PermissionKey
  enabled: boolean
  updated_at: string
}

export function useRolePermissions() {
  return useQuery({
    queryKey: ['role_permissions'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('role_permissions')
        .select('id, role, permission_key, enabled, updated_by, updated_at')
      if (error) throw error
      return (data ?? []) as RolePermission[]
    },
    staleTime: 60_000,
  })
}

/** Returns a function that checks whether a role has a given permission. Admin always returns true. */
export function useCanPermission() {
  const { data: permissions = [] } = useRolePermissions()
  return (role: 'staff' | 'member' | 'board' | 'admin', key: PermissionKey): boolean => {
    if (role === 'admin') return true
    const found = permissions.find(p => p.role === role && p.permission_key === key)
    return found ? found.enabled : true // default to allowed if not configured
  }
}

export function useUpdateRolePermission() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      role,
      permission_key,
      enabled,
    }: {
      role: 'staff' | 'member' | 'board'
      permission_key: PermissionKey
      enabled: boolean
    }) => {
      const { data: { user } } = await supabase.auth.getUser()
      const { error } = await supabase
        .from('role_permissions')
        .upsert(
          { role, permission_key, enabled, updated_by: user?.id, updated_at: new Date().toISOString() },
          { onConflict: 'role,permission_key' }
        )
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['role_permissions'] })
      toast({ title: 'Permission updated', variant: 'success' })
    },
    onError: (err: any) => {
      toast({ title: err.message ?? 'Failed to update permission', variant: 'error' })
    },
  })
}
