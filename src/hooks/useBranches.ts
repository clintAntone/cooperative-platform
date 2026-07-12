import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useEffectiveUserId } from '../context/ImpersonationContext'
import { toast } from '../lib/toast'
import type { Branch, BranchIncome, BranchIncomeDistribution, BranchExpense } from '../types'

// ─── Branches ─────────────────────────────────────────────────────────────────

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

// ─── Branch income ────────────────────────────────────────────────────────────

export function useBranchIncome(branchId: string | null | undefined) {
  return useQuery({
    queryKey: ['branch_income', branchId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('branch_income')
        .select('id, branch_id, amount, period_start, period_end, description, distributed, recorded_by, created_at')
        .eq('branch_id', branchId!)
        .order('period_end', { ascending: false })
      if (error) throw error
      return data as BranchIncome[]
    },
    enabled: !!branchId,
  })
}

export function useAllBranchIncome() {
  return useQuery({
    queryKey: ['branch_income_all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('branch_income')
        .select('id, branch_id, amount, period_start, period_end, description, distributed, recorded_by, created_at')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as BranchIncome[]
    },
  })
}

export function useRecordBranchIncome() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (params: {
      branchId: string
      amount: number
      periodStart: string
      periodEnd: string
      description?: string
    }) => {
      const { error } = await supabase.rpc('record_branch_income', {
        p_branch_id: params.branchId,
        p_amount: params.amount,
        p_period_start: params.periodStart,
        p_period_end: params.periodEnd,
        p_description: params.description ?? null,
      })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['branch_income'] })
      queryClient.invalidateQueries({ queryKey: ['branch_income_all'] })
      toast({ title: 'Income recorded', variant: 'success' })
    },
  })
}

export function useDistributeBranchIncome() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (incomeId: string) => {
      const { error } = await supabase.rpc('distribute_branch_income', { p_income_id: incomeId })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['branch_income'] })
      queryClient.invalidateQueries({ queryKey: ['branch_income_all'] })
      queryClient.invalidateQueries({ queryKey: ['savings_account'] })
      queryClient.invalidateQueries({ queryKey: ['branch_income_distributions'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      toast({ title: 'Income distributed to all shareholders', variant: 'success' })
    },
  })
}

// ─── Branch expenses ──────────────────────────────────────────────────────────

export function useAllBranchExpenses() {
  return useQuery({
    queryKey: ['branch_expenses_all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('branch_expenses')
        .select('id, branch_id, category, amount, period_start, period_end, description, recorded_by, created_at')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as BranchExpense[]
    },
  })
}

export function useRecordBranchExpense() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (params: {
      branchId: string
      category: string
      amount: number
      periodStart: string
      periodEnd: string
      description?: string
    }) => {
      const { error } = await supabase.rpc('record_branch_expense', {
        p_branch_id: params.branchId,
        p_category: params.category,
        p_amount: params.amount,
        p_period_start: params.periodStart,
        p_period_end: params.periodEnd,
        p_description: params.description ?? null,
      })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['branch_expenses_all'] })
      toast({ title: 'Expense recorded', variant: 'success' })
    },
  })
}

// ─── Member: my income distributions ─────────────────────────────────────────

export function useMyBranchIncomeDistributions() {
  const effectiveUserId = useEffectiveUserId()
  return useQuery({
    queryKey: ['branch_income_distributions', effectiveUserId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('branch_income_distributions')
        .select('id, income_id, user_id, share_count, amount, created_at')
        .eq('user_id', effectiveUserId!)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as BranchIncomeDistribution[]
    },
    enabled: !!effectiveUserId,
  })
}
