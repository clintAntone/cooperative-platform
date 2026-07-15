import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { toast } from '../lib/toast'

export interface CustomRole {
  id: string
  name: string
  color: string
  description: string | null
  created_at: string
}

export function useCustomRoles() {
  return useQuery({
    queryKey: ['custom_roles'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('custom_roles')
        .select('id, name, color, description, created_at')
        .order('name')
      if (error) throw error
      return data as CustomRole[]
    },
    staleTime: 60_000,
  })
}

export function useCreateCustomRole() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { name: string; color: string; description?: string }) => {
      const { error } = await supabase.from('custom_roles').insert({
        name: input.name.trim(),
        color: input.color,
        description: input.description?.trim() || null,
      })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['custom_roles'] })
      toast({ title: 'Role created', variant: 'success' })
    },
    onError: (err: any) => {
      toast({ title: err?.message ?? 'Failed to create role', variant: 'error' })
    },
  })
}

export function useDeleteCustomRole() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (roleId: string) => {
      const { error } = await supabase.from('custom_roles').delete().eq('id', roleId)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['custom_roles'] })
      queryClient.invalidateQueries({ queryKey: ['members'] })
      toast({ title: 'Role deleted', variant: 'info' })
    },
    onError: (err: any) => {
      toast({ title: err?.message ?? 'Failed to delete role', variant: 'error' })
    },
  })
}

export function useAssignCustomRole() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ userId, customRoleId }: { userId: string; customRoleId: string | null }) => {
      const { error } = await supabase.rpc('admin_assign_custom_role', {
        p_user_id: userId,
        p_custom_role_id: customRoleId,
      })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['members'] })
      queryClient.invalidateQueries({ queryKey: ['profile'] })
      toast({ title: 'Role assigned', variant: 'success' })
    },
  })
}
