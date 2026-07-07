import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useEffectiveUserId } from '../context/ImpersonationContext'
import { toast } from '../lib/toast'
import type { DepositRequest, PaymentMethod } from '../types'

// ─── Storage helper ───────────────────────────────────────────────────────────

export async function uploadReceipt(userId: string, file: File): Promise<string> {
  const MAX_SIZE_MB = 10
  const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'application/pdf']

  if (!ALLOWED_TYPES.includes(file.type)) {
    throw new Error('Only JPG, PNG, and PDF files are accepted.')
  }
  if (file.size > MAX_SIZE_MB * 1024 * 1024) {
    throw new Error(`File size must be under ${MAX_SIZE_MB}MB.`)
  }

  const ext = file.name.split('.').pop()
  const path = `${userId}/${Date.now()}.${ext}`
  const { error } = await supabase.storage.from('deposit-receipts').upload(path, file)
  if (error) throw error
  const { data } = supabase.storage.from('deposit-receipts').getPublicUrl(path)
  return data.publicUrl
}

// ─── Member: own requests ─────────────────────────────────────────────────────

export function useMyDepositRequests() {
  const effectiveUserId = useEffectiveUserId()

  return useQuery({
    queryKey: ['deposit_requests_mine', effectiveUserId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('deposit_requests')
        .select('id, user_id, share_id, amount, payment_method, reference, receipt_url, notes, status, reviewed_by, reviewed_at, rejection_reason, created_at, updated_at')
        .eq('user_id', effectiveUserId!)
        .order('created_at', { ascending: false })

      if (error) throw error
      return data as DepositRequest[]
    },
    enabled: !!effectiveUserId,
  })
}

// ─── Admin/Staff: all requests with joined profile + share info ───────────────

export interface DepositRequestWithMeta extends DepositRequest {
  profiles: {
    full_name: string
    employee_id: string | null
  } | null
  equity_shares: {
    share_number: number
  } | null
}

export interface DepositRequestsPage {
  rows: DepositRequestWithMeta[]
  total: number
}

export function useAllDepositRequests(params?: {
  statusFilter?: string
  page?: number
  pageSize?: number
  search?: string
  sortKey?: 'amount' | 'created_at'
  sortDir?: 'asc' | 'desc'
  dateFrom?: string
  dateTo?: string
}) {
  const statusFilter = params?.statusFilter
  const page = params?.page ?? 0
  const pageSize = params?.pageSize ?? 25
  const search = params?.search ?? ''
  const sortKey = params?.sortKey ?? 'created_at'
  const sortDir = params?.sortDir ?? 'desc'
  const dateFrom = params?.dateFrom ?? ''
  const dateTo = params?.dateTo ?? ''

  return useQuery({
    queryKey: ['deposit_requests_all', statusFilter, page, pageSize, search, sortKey, sortDir, dateFrom, dateTo],
    queryFn: async (): Promise<DepositRequestsPage> => {
      const from = page * pageSize
      const to = from + pageSize - 1

      let query = supabase
        .from('deposit_requests')
        .select(
          `*, profiles!deposit_requests_user_id_fkey(full_name, employee_id), equity_shares!deposit_requests_share_id_fkey(share_number)`,
          { count: 'exact' }
        )
        .order(sortKey, { ascending: sortDir === 'asc' })
        .range(from, to)

      if (statusFilter && statusFilter !== 'all') {
        query = query.eq('status', statusFilter)
      }
      if (dateFrom) {
        query = query.gte('created_at', dateFrom)
      }
      if (dateTo) {
        query = query.lte('created_at', dateTo + 'T23:59:59')
      }

      const { data, error, count } = await query
      if (error) throw error

      let rows = (data ?? []) as DepositRequestWithMeta[]

      // Search by member name (client-side after server fetch since it's a join field)
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

// ─── Admin: pending deposit count for nav badge ───────────────────────────────

export function usePendingDepositCount() {
  return useQuery({
    queryKey: ['pending_deposit_count'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('deposit_requests')
        .select('id')
        .eq('status', 'pending')
      if (error) return 0
      return data?.length ?? 0
    },
    refetchInterval: 60_000,
  })
}

// ─── Submit deposit request (member) ─────────────────────────────────────────

interface SubmitDepositRequestInput {
  share_id: string
  amount: number
  payment_method: PaymentMethod
  reference?: string
  receipt_url?: string
  notes?: string
}

export function useSubmitDepositRequest() {
  const queryClient = useQueryClient()
  const { user } = useAuth()

  return useMutation({
    mutationFn: async (input: SubmitDepositRequestInput) => {
      const { data, error } = await supabase
        .from('deposit_requests')
        .insert({
          user_id: user!.id,
          share_id: input.share_id,
          amount: input.amount,
          payment_method: input.payment_method,
          reference: input.reference ?? null,
          receipt_url: input.receipt_url ?? null,
          notes: input.notes ?? null,
        })
        .select()
        .single()

      if (error) {
        if (error.code === '23505' && error.message.includes('reference')) {
          throw new Error('This reference number has already been used in a previous deposit request.')
        }
        throw error
      }
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deposit_requests_mine'] })
      queryClient.invalidateQueries({ queryKey: ['deposit_requests_all'] })
      toast({ title: 'Deposit request submitted', description: 'Waiting for admin review', variant: 'success' })
    },
  })
}

// ─── Approve deposit request (admin/staff) ────────────────────────────────────

export function useApproveDepositRequest() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (requestId: string) => {
      const { error } = await supabase.rpc('approve_deposit_request', {
        p_request_id: requestId,
      })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deposit_requests_all'] })
      queryClient.invalidateQueries({ queryKey: ['deposit_requests_mine'] })
      toast({ title: 'Deposit approved', variant: 'success' })
      queryClient.invalidateQueries({ queryKey: ['equity_shares'] })
      queryClient.invalidateQueries({ queryKey: ['equity_contributions'] })
      queryClient.invalidateQueries({ queryKey: ['equity_contributions_all'] })
      queryClient.invalidateQueries({ queryKey: ['equity_summary'] })
      queryClient.invalidateQueries({ queryKey: ['membership_status'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
}

// ─── Reject deposit request (admin/staff) ─────────────────────────────────────

export function useRejectDepositRequest() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ requestId, reason }: { requestId: string; reason: string }) => {
      const { error } = await supabase.rpc('reject_deposit_request', {
        p_request_id: requestId,
        p_reason: reason,
      })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deposit_requests_all'] })
      queryClient.invalidateQueries({ queryKey: ['deposit_requests_mine'] })
      toast({ title: 'Deposit rejected', variant: 'info' })
    },
  })
}

export function useBulkApproveDepositRequests() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (requestIds: string[]) => {
      const results = await Promise.allSettled(
        requestIds.map(id => supabase.rpc('approve_deposit_request', { p_request_id: id }))
      )
      const failed = results.filter(r => r.status === 'rejected').length
      if (failed > 0) throw new Error(`${failed} request(s) could not be approved`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deposit_requests_all'] })
      queryClient.invalidateQueries({ queryKey: ['equity_shares'] })
      queryClient.invalidateQueries({ queryKey: ['equity_summary'] })
      queryClient.invalidateQueries({ queryKey: ['membership_status'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      toast({ title: 'Selected deposits approved', variant: 'success' })
    },
    onError: (err: any) => {
      queryClient.invalidateQueries({ queryKey: ['deposit_requests_all'] })
      toast({ title: err.message ?? 'Bulk approve partially failed', variant: 'error' })
    },
  })
}

export function useBulkRejectDepositRequests() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ requestIds, reason }: { requestIds: string[]; reason: string }) => {
      const results = await Promise.allSettled(
        requestIds.map(id =>
          supabase.rpc('reject_deposit_request', { p_request_id: id, p_reason: reason })
        )
      )
      const failed = results.filter(r => r.status === 'rejected').length
      if (failed > 0) throw new Error(`${failed} request(s) could not be rejected`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deposit_requests_all'] })
      toast({ title: 'Selected deposits rejected', variant: 'info' })
    },
    onError: (err: any) => {
      queryClient.invalidateQueries({ queryKey: ['deposit_requests_all'] })
      toast({ title: err.message ?? 'Bulk reject partially failed', variant: 'error' })
    },
  })
}
