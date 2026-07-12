import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useEffectiveUserId } from '../context/ImpersonationContext'
import { toast } from '../lib/toast'
import type {
  SavingsAccount,
  SavingsDepositRequest,
  SavingsContribution,
  SavingsWithdrawalRequest,
  SavingsInterestLog,
  PaymentMethod,
} from '../types'

// ─── Member: own savings account ──────────────────────────────────────────────

export function useSavingsAccount(userId?: string) {
  const effectiveUserId = useEffectiveUserId()
  const targetId = userId ?? effectiveUserId

  return useQuery({
    queryKey: ['savings_account', targetId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('savings_accounts')
        .select('id, user_id, balance, status, opened_at, closed_at, created_at, updated_at')
        .eq('user_id', targetId!)
        .single()

      if (error && error.code === 'PGRST116') return null // no account yet
      if (error) throw error
      return data as SavingsAccount
    },
    enabled: !!targetId,
  })
}

// ─── Member: deposit requests ────────────────────────────────────────────────

export function useSavingsDepositRequests(userId?: string) {
  const effectiveUserId = useEffectiveUserId()
  const targetId = userId ?? effectiveUserId

  return useQuery({
    queryKey: ['savings_deposit_requests', targetId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('savings_deposit_requests')
        .select('id, user_id, account_id, amount, payment_method, reference, receipt_url, notes, status, reviewed_by, reviewed_at, rejection_reason, created_at, updated_at')
        .eq('user_id', targetId!)
        .order('created_at', { ascending: false })

      if (error) throw error
      return data as SavingsDepositRequest[]
    },
    enabled: !!targetId,
  })
}

// ─── Member: approved contributions (deposit history) ────────────────────────

export function useSavingsContributions(accountId: string | null | undefined) {
  return useQuery({
    queryKey: ['savings_contributions', accountId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('savings_contributions')
        .select('id, account_id, user_id, request_id, amount, payment_method, reference, recorded_by, contributed_at, created_at')
        .eq('account_id', accountId!)
        .order('contributed_at', { ascending: false })

      if (error) throw error
      return data as SavingsContribution[]
    },
    enabled: !!accountId,
  })
}

// ─── Member: withdrawal requests ─────────────────────────────────────────────

export function useSavingsWithdrawalRequests(userId?: string) {
  const effectiveUserId = useEffectiveUserId()
  const targetId = userId ?? effectiveUserId

  return useQuery({
    queryKey: ['savings_withdrawal_requests', targetId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('savings_withdrawal_requests')
        .select('id, user_id, account_id, amount, reason, status, reviewed_by, reviewed_at, rejection_reason, created_at, updated_at')
        .eq('user_id', targetId!)
        .order('created_at', { ascending: false })

      if (error) throw error
      return data as SavingsWithdrawalRequest[]
    },
    enabled: !!targetId,
  })
}

// ─── Member: interest history ─────────────────────────────────────────────────

export function useSavingsInterestLogs(accountId: string | null | undefined) {
  return useQuery({
    queryKey: ['savings_interest_logs', accountId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('savings_interest_logs')
        .select('id, account_id, user_id, principal_at_time, interest_earned, period_start, period_end, released_by, created_at')
        .eq('account_id', accountId!)
        .order('created_at', { ascending: false })

      if (error) throw error
      return data as SavingsInterestLog[]
    },
    enabled: !!accountId,
  })
}

// ─── Member: submit savings deposit request ───────────────────────────────────

interface SubmitSavingsDepositInput {
  account_id: string
  amount: number
  payment_method: PaymentMethod
  reference?: string
  receipt_url?: string
  notes?: string
}

export function useSubmitSavingsDeposit() {
  const queryClient = useQueryClient()
  const { user } = useAuth()

  return useMutation({
    mutationFn: async (input: SubmitSavingsDepositInput) => {
      const { data, error } = await supabase
        .from('savings_deposit_requests')
        .insert({
          user_id: user!.id,
          account_id: input.account_id,
          amount: input.amount,
          payment_method: input.payment_method,
          reference: input.reference ?? null,
          receipt_url: input.receipt_url ?? null,
          notes: input.notes ?? null,
        })
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['savings_deposit_requests'] })
      queryClient.invalidateQueries({ queryKey: ['savings_deposit_requests_all'] })
      queryClient.invalidateQueries({ queryKey: ['pending_savings_deposit_count'] })
      toast({ title: 'Deposit request submitted', description: 'Waiting for admin review', variant: 'success' })
    },
  })
}

// ─── Member: submit savings withdrawal request ────────────────────────────────

interface SubmitSavingsWithdrawalInput {
  account_id: string
  amount: number
  reason?: string
}

export function useSubmitSavingsWithdrawal() {
  const queryClient = useQueryClient()
  const { user } = useAuth()

  return useMutation({
    mutationFn: async (input: SubmitSavingsWithdrawalInput) => {
      const { data, error } = await supabase
        .from('savings_withdrawal_requests')
        .insert({
          user_id: user!.id,
          account_id: input.account_id,
          amount: input.amount,
          reason: input.reason ?? null,
        })
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['savings_withdrawal_requests'] })
      queryClient.invalidateQueries({ queryKey: ['savings_withdrawal_requests_all'] })
      queryClient.invalidateQueries({ queryKey: ['pending_savings_withdrawal_count'] })
      toast({ title: 'Withdrawal request submitted', description: 'Waiting for admin review', variant: 'success' })
    },
  })
}

// ─── Admin: all deposit requests (paginated) ──────────────────────────────────

export interface SavingsDepositRequestWithMeta extends SavingsDepositRequest {
  profiles: { full_name: string; employee_id: string | null } | null
}

export interface SavingsDepositRequestsPage {
  rows: SavingsDepositRequestWithMeta[]
  total: number
}

export function useAllSavingsDepositRequests(params?: {
  statusFilter?: string
  page?: number
  pageSize?: number
  search?: string
}) {
  const statusFilter = params?.statusFilter ?? 'all'
  const page = params?.page ?? 0
  const pageSize = params?.pageSize ?? 25
  const search = params?.search ?? ''

  return useQuery({
    queryKey: ['savings_deposit_requests_all', statusFilter, page, pageSize, search],
    queryFn: async (): Promise<SavingsDepositRequestsPage> => {
      const from = page * pageSize
      const to = from + pageSize - 1

      let query = supabase
        .from('savings_deposit_requests')
        .select(
          `*, profiles!savings_deposit_requests_user_id_fkey(full_name, employee_id)`,
          { count: 'exact' }
        )
        .order('created_at', { ascending: false })
        .range(from, to)

      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter)
      }

      const { data, error, count } = await query
      if (error) throw error

      let rows = (data ?? []) as SavingsDepositRequestWithMeta[]

      if (search) {
        const q = search.toLowerCase()
        rows = rows.filter(r =>
          (r.profiles?.full_name ?? '').toLowerCase().includes(q) ||
          (r.profiles?.employee_id ?? '').toLowerCase().includes(q)
        )
      }

      return { rows, total: count ?? 0 }
    },
  })
}

// ─── Admin: all withdrawal requests (paginated) ───────────────────────────────

export interface SavingsWithdrawalRequestWithMeta extends SavingsWithdrawalRequest {
  profiles: { full_name: string; employee_id: string | null } | null
  savings_accounts: { balance: number } | null
}

export interface SavingsWithdrawalRequestsPage {
  rows: SavingsWithdrawalRequestWithMeta[]
  total: number
}

export function useAllSavingsWithdrawalRequests(params?: {
  statusFilter?: string
  page?: number
  pageSize?: number
  search?: string
}) {
  const statusFilter = params?.statusFilter ?? 'all'
  const page = params?.page ?? 0
  const pageSize = params?.pageSize ?? 25
  const search = params?.search ?? ''

  return useQuery({
    queryKey: ['savings_withdrawal_requests_all', statusFilter, page, pageSize, search],
    queryFn: async (): Promise<SavingsWithdrawalRequestsPage> => {
      const from = page * pageSize
      const to = from + pageSize - 1

      let query = supabase
        .from('savings_withdrawal_requests')
        .select(
          `*, profiles!savings_withdrawal_requests_user_id_fkey(full_name, employee_id), savings_accounts!savings_withdrawal_requests_account_id_fkey(balance)`,
          { count: 'exact' }
        )
        .order('created_at', { ascending: false })
        .range(from, to)

      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter)
      }

      const { data, error, count } = await query
      if (error) throw error

      let rows = (data ?? []) as SavingsWithdrawalRequestWithMeta[]

      if (search) {
        const q = search.toLowerCase()
        rows = rows.filter(r =>
          (r.profiles?.full_name ?? '').toLowerCase().includes(q) ||
          (r.profiles?.employee_id ?? '').toLowerCase().includes(q)
        )
      }

      return { rows, total: count ?? 0 }
    },
  })
}

// ─── Admin: pending count badges ─────────────────────────────────────────────

export function usePendingSavingsDepositCount() {
  return useQuery({
    queryKey: ['pending_savings_deposit_count'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('savings_deposit_requests')
        .select('id')
        .eq('status', 'pending')
      if (error) return 0
      return data?.length ?? 0
    },
    refetchInterval: 60_000,
  })
}

export function usePendingSavingsWithdrawalCount() {
  return useQuery({
    queryKey: ['pending_savings_withdrawal_count'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('savings_withdrawal_requests')
        .select('id')
        .eq('status', 'pending')
      if (error) return 0
      return data?.length ?? 0
    },
    refetchInterval: 60_000,
  })
}

// ─── Admin: approve/reject deposit requests ───────────────────────────────────

export function useApproveSavingsDeposit() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (requestId: string) => {
      const { error } = await supabase.rpc('approve_savings_deposit', { p_request_id: requestId })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['savings_deposit_requests_all'] })
      queryClient.invalidateQueries({ queryKey: ['savings_deposit_requests'] })
      queryClient.invalidateQueries({ queryKey: ['savings_account'] })
      queryClient.invalidateQueries({ queryKey: ['savings_contributions'] })
      queryClient.invalidateQueries({ queryKey: ['pending_savings_deposit_count'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      toast({ title: 'Savings deposit approved', variant: 'success' })
    },
  })
}

export function useRejectSavingsDeposit() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ requestId, reason }: { requestId: string; reason: string }) => {
      const { error } = await supabase.rpc('reject_savings_deposit', {
        p_request_id: requestId,
        p_reason: reason,
      })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['savings_deposit_requests_all'] })
      queryClient.invalidateQueries({ queryKey: ['savings_deposit_requests'] })
      queryClient.invalidateQueries({ queryKey: ['pending_savings_deposit_count'] })
      toast({ title: 'Savings deposit rejected', variant: 'info' })
    },
  })
}

// ─── Admin: approve/reject withdrawal requests ────────────────────────────────

export function useApproveSavingsWithdrawal() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (requestId: string) => {
      const { error } = await supabase.rpc('approve_savings_withdrawal', { p_request_id: requestId })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['savings_withdrawal_requests_all'] })
      queryClient.invalidateQueries({ queryKey: ['savings_withdrawal_requests'] })
      queryClient.invalidateQueries({ queryKey: ['savings_account'] })
      queryClient.invalidateQueries({ queryKey: ['pending_savings_withdrawal_count'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      toast({ title: 'Savings withdrawal approved', variant: 'success' })
    },
  })
}

export function useRejectSavingsWithdrawal() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ requestId, reason }: { requestId: string; reason: string }) => {
      const { error } = await supabase.rpc('reject_savings_withdrawal', {
        p_request_id: requestId,
        p_reason: reason,
      })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['savings_withdrawal_requests_all'] })
      queryClient.invalidateQueries({ queryKey: ['savings_withdrawal_requests'] })
      queryClient.invalidateQueries({ queryKey: ['pending_savings_withdrawal_count'] })
      toast({ title: 'Savings withdrawal rejected', variant: 'info' })
    },
  })
}

// ─── Admin: release savings interest ─────────────────────────────────────────

export interface LastInterestRelease {
  period_end: string
  total_interest: number
  account_count: number
  released_at: string
}

export function useLastInterestRelease() {
  return useQuery({
    queryKey: ['last_interest_release'],
    queryFn: async (): Promise<LastInterestRelease | null> => {
      const { data, error } = await supabase
        .from('savings_interest_logs')
        .select('period_end, interest_earned, created_at')
        .order('created_at', { ascending: false })
        .limit(200)

      if (error) throw error
      if (!data || data.length === 0) return null

      // Group by period_end to find the most recent batch
      const latest = data[0].period_end
      const batch = data.filter((r: { period_end: string; interest_earned: number; created_at: string }) => r.period_end === latest)

      return {
        period_end: latest,
        total_interest: batch.reduce((s: number, r: { interest_earned: number }) => s + r.interest_earned, 0),
        account_count: batch.length,
        released_at: data[0].created_at,
      }
    },
    staleTime: 60_000,
  })
}

export function useReleaseSavingsInterest() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('release_savings_interest')
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['last_interest_release'] })
      queryClient.invalidateQueries({ queryKey: ['savings_account'] })
      queryClient.invalidateQueries({ queryKey: ['savings_interest_logs'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      toast({ title: 'Interest released successfully', description: 'All active savings accounts have been credited', variant: 'success' })
    },
  })
}

// ─── Storage helper (reuses deposit-receipts bucket) ─────────────────────────

export async function uploadSavingsReceipt(userId: string, file: File): Promise<string> {
  const MAX_SIZE_MB = 10
  const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'application/pdf']

  if (!ALLOWED_TYPES.includes(file.type)) throw new Error('Only JPG, PNG, and PDF files are accepted.')
  if (file.size > MAX_SIZE_MB * 1024 * 1024) throw new Error(`File size must be under ${MAX_SIZE_MB}MB.`)

  const ext = file.name.split('.').pop()
  const path = `savings/${userId}/${Date.now()}.${ext}`
  const { error } = await supabase.storage.from('deposit-receipts').upload(path, file)
  if (error) throw error
  const { data } = supabase.storage.from('deposit-receipts').getPublicUrl(path)
  return data.publicUrl
}
