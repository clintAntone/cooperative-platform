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
      const { data, error } = await supabase.functions.invoke('pos-branches')
      if (error) throw error
      if (data?.error) throw new Error(data.error)
      return data as Branch[]
    },
    staleTime: 5 * 60 * 1000, // 5 min — sync on every page load but not every render
  })
}

export function useActiveBranches() {
  return useQuery({
    queryKey: ['branches', 'active'],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('pos-branches')
      if (error) throw error
      if (data?.error) throw new Error(data.error)
      return (data as Branch[]).filter(b => b.is_active)
    },
    staleTime: 5 * 60 * 1000,
  })
}

export function useSyncBranches() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('pos-branches')
      if (error) throw error
      if (data?.error) throw new Error(data.error)
      return data as Branch[]
    },
    onSuccess: (data) => {
      queryClient.setQueryData(['branches'], data)
      queryClient.setQueryData(['branches', 'active'], (data as Branch[]).filter(b => b.is_active))
      toast({ title: `Synced ${data.length} branch${data.length !== 1 ? 'es' : ''} from POS`, variant: 'success' })
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
        .select('id, name, location, is_active, report_cutoff_day, created_at, updated_at')
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
    mutationFn: async (params: { id: string; name: string; location: string | null; is_active: boolean; report_cutoff_day: number }) => {
      const { data, error } = await supabase
        .from('branches')
        .update({ name: params.name, location: params.location, is_active: params.is_active, report_cutoff_day: params.report_cutoff_day, updated_at: new Date().toISOString() })
        .eq('id', params.id)
        .select('id, name, location, is_active, report_cutoff_day, created_at, updated_at')
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

export function useBranchIncome(
  branchId: string | null | undefined,
  startDate?: string,
  endDate?: string,
  enabled = true,
) {
  return useQuery({
    queryKey: ['branch_income', branchId, startDate, endDate],
    queryFn: async () => {
      let q = supabase
        .from('branch_income')
        .select('id, branch_id, amount, gross_sales, salary, expenses_total, bills, roi, period_start, period_end, description, distributed, recorded_by, created_at')
        .eq('branch_id', branchId!)
        .order('period_start', { ascending: false })
      if (startDate) q = q.gte('period_start', startDate)
      if (endDate) q = q.lte('period_start', endDate)
      const { data, error } = await q
      if (error) throw error
      return data as BranchIncome[]
    },
    enabled: !!branchId && enabled,
  })
}

export function useBranchExpenses(
  branchId: string | null | undefined,
  startDate?: string,
  endDate?: string,
  enabled = true,
) {
  return useQuery({
    queryKey: ['branch_expenses', branchId, startDate, endDate],
    queryFn: async () => {
      let q = supabase
        .from('branch_expenses')
        .select('id, branch_id, category, amount, period_start, period_end, description, recorded_by, created_at')
        .eq('branch_id', branchId!)
        .order('period_start', { ascending: false })
      if (startDate) q = q.gte('period_start', startDate)
      if (endDate) q = q.lte('period_start', endDate)
      const { data, error } = await q
      if (error) throw error
      return data as BranchExpense[]
    },
    enabled: !!branchId && enabled,
  })
}

export function useUpdateBranchIncome() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (params: {
      id: string
      grossSales: number
      salary: number
      expensesTotal: number
      bills: number
      roi: number | null
      incomeDate: string
      description?: string
    }) => {
      const netProfit = params.grossSales - params.salary - params.expensesTotal - params.bills
      const { error } = await supabase
        .from('branch_income')
        .update({
          amount: netProfit,
          income_date: params.incomeDate,
          period_start: params.incomeDate,
          period_end: params.incomeDate,
          gross_sales: params.grossSales,
          salary: params.salary,
          expenses_total: params.expensesTotal,
          bills: params.bills,
          roi: params.roi,
          description: params.description ?? null,
        })
        .eq('id', params.id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['branch_income'] })
      queryClient.invalidateQueries({ queryKey: ['branch_income_all'] })
      queryClient.invalidateQueries({ queryKey: ['branch_income_summary'] })
      toast({ title: 'Income updated', variant: 'success' })
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
      grossSales?: number | null
      salary?: number | null
      expensesTotal?: number | null
      bills?: number | null
      roi?: number | null
    }) => {
      const { error } = await supabase.rpc('record_branch_income', {
        p_branch_id: params.branchId,
        p_amount: params.amount,
        p_period_start: params.periodStart,
        p_period_end: params.periodEnd,
        p_description: params.description ?? null,
        p_gross_sales: params.grossSales ?? null,
        p_salary: params.salary ?? null,
        p_expenses_total: params.expensesTotal ?? null,
        p_bills: params.bills ?? null,
        p_roi: params.roi ?? null,
      })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['branch_income'] })
      queryClient.invalidateQueries({ queryKey: ['branch_income_all'] })
      queryClient.invalidateQueries({ queryKey: ['branch_income_summary'] })
      toast({ title: 'Income recorded', variant: 'success' })
    },
  })
}

export function useDistributeBranchIncomeForPeriod() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (params: { branchId: string; start: string; end: string }) => {
      const { data, error } = await supabase.rpc('distribute_branch_income_for_period', {
        p_branch_id: params.branchId,
        p_start: params.start,
        p_end: params.end,
      })
      if (error) throw error
      return data as number
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ['branch_income'] })
      queryClient.invalidateQueries({ queryKey: ['branch_income_all'] })
      queryClient.invalidateQueries({ queryKey: ['branch_income_summary'] })
      queryClient.invalidateQueries({ queryKey: ['savings_account'] })
      queryClient.invalidateQueries({ queryKey: ['branch_income_distributions'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      toast({ title: `Distributed ${count} income record${count !== 1 ? 's' : ''} to shareholders`, variant: 'success' })
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
      queryClient.invalidateQueries({ queryKey: ['branch_income_summary'] })
      queryClient.invalidateQueries({ queryKey: ['savings_account'] })
      queryClient.invalidateQueries({ queryKey: ['branch_income_distributions'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      toast({ title: 'Income distributed to all shareholders', variant: 'success' })
    },
  })
}

// ─── Branch income summary (lightweight aggregate for KPI banner) ─────────────

export interface BranchIncomeSummary {
  totalNetProfit: number
  distributedNetProfit: number
  pendingNetProfit: number
  distributableAmount: number  // 50% of pending net profit
  recordCount: number
  pendingCount: number
}

export function useBranchIncomeSummary() {
  return useQuery({
    queryKey: ['branch_income_summary'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('branch_income')
        .select('amount, distributed')
      if (error) throw error
      const rows = data as { amount: number; distributed: boolean }[]
      const totalNetProfit = rows.reduce((s, r) => s + r.amount, 0)
      const distributedNetProfit = rows.filter(r => r.distributed).reduce((s, r) => s + r.amount, 0)
      const pendingNetProfit = rows.filter(r => !r.distributed).reduce((s, r) => s + r.amount, 0)
      return {
        totalNetProfit,
        distributedNetProfit,
        pendingNetProfit,
        distributableAmount: pendingNetProfit * 0.5,
        recordCount: rows.length,
        pendingCount: rows.filter(r => !r.distributed).length,
      } as BranchIncomeSummary
    },
    staleTime: 60 * 1000,
  })
}

// ─── All-branches convenience hooks (used by OverviewPage / BranchKPIPage) ───
// Fetches all branches' income/expenses with an optional date range.

export function useAllBranchIncome(startDate?: string, endDate?: string) {
  return useQuery({
    queryKey: ['branch_income_all', startDate, endDate],
    queryFn: async () => {
      let q = supabase
        .from('branch_income')
        .select('id, branch_id, amount, gross_sales, salary, expenses_total, bills, roi, period_start, period_end, description, distributed, recorded_by, created_at')
        .order('period_start', { ascending: false })
      if (startDate) q = q.gte('period_start', startDate)
      if (endDate) q = q.lte('period_start', endDate)
      const { data, error } = await q
      if (error) throw error
      return data as BranchIncome[]
    },
  })
}

export function useAllBranchExpenses(startDate?: string, endDate?: string) {
  return useQuery({
    queryKey: ['branch_expenses_all', startDate, endDate],
    queryFn: async () => {
      let q = supabase
        .from('branch_expenses')
        .select('id, branch_id, category, amount, period_start, period_end, description, recorded_by, created_at')
        .order('period_start', { ascending: false })
      if (startDate) q = q.gte('period_start', startDate)
      if (endDate) q = q.lte('period_start', endDate)
      const { data, error } = await q
      if (error) throw error
      return data as BranchExpense[]
    },
  })
}

// ─── Branch expenses ──────────────────────────────────────────────────────────

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

// ─── Shareholders: members with at least 1 completed share ───────────────────

export interface Shareholder {
  user_id: string
  full_name: string
  completed_shares: number
}

export function useShareholders() {
  return useQuery({
    queryKey: ['shareholders'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('membership_status')
        .select('user_id, completed_shares, profiles(full_name)')
        .gt('completed_shares', 0)
        .eq('status', 'active')
        .order('completed_shares', { ascending: false })
      if (error) throw error
      return (data as any[]).map(r => ({
        user_id: r.user_id,
        full_name: r.profiles?.full_name ?? 'Unknown',
        completed_shares: r.completed_shares,
      })) as Shareholder[]
    },
    staleTime: 2 * 60 * 1000,
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
