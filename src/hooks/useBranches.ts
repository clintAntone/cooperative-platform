import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { toast } from '../lib/toast'
import type { Branch } from '../types'

export function useBranches() {
  return useQuery({
    queryKey: ['branches'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('branches')
        .select('id, name, location, is_active, created_at, updated_at')
        .order('name', { ascending: true })
      if (error) throw error
      return data as Branch[]
    },
  })
}

export function useActiveBranches() {
  return useQuery({
    queryKey: ['branches', 'active'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('branches')
        .select('id, name, location, is_active, created_at, updated_at')
        .eq('is_active', true)
        .order('name', { ascending: true })
      if (error) throw error
      return data as Branch[]
    },
  })
}

export function useCreateBranch() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (params: { name: string; location: string | null }) => {
      const { data, error } = await supabase
        .from('branches')
        .insert({ name: params.name, location: params.location })
        .select('id, name, location, is_active, created_at, updated_at')
        .single()
      if (error) throw error
      return data as Branch
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['branches'] })
      toast({ title: 'Branch created', variant: 'success' })
    },
  })
}

export function useUpdateBranch() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (params: { id: string; name: string; location: string | null; is_active: boolean }) => {
      const { data, error } = await supabase
        .from('branches')
        .update({ name: params.name, location: params.location, is_active: params.is_active, updated_at: new Date().toISOString() })
        .eq('id', params.id)
        .select('id, name, location, is_active, created_at, updated_at')
        .single()
      if (error) throw error
      return data as Branch
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['branches'] })
      toast({ title: 'Branch updated', variant: 'success' })
    },
  })
}

export function useAssignMemberBranch() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ userId, branchId }: { userId: string; branchId: string | null }) => {
      const { error } = await supabase.rpc('assign_member_branch', {
        p_user_id: userId,
        p_branch_id: branchId,
      })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['members'] })
      queryClient.invalidateQueries({ queryKey: ['profile'] })
      toast({ title: 'Branch assigned', variant: 'success' })
    },
  })
}
