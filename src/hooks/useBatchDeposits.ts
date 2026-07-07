import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { toast } from '../lib/toast'

export interface BatchDepositItem {
  id: string
  batch_id: string
  user_id: string
  amount: number
  deposit_request_id: string | null
  created_at: string
  // joined
  member_name?: string
}

export interface BatchDeposit {
  id: string
  reference: string | null
  payment_method: string
  receipt_url: string | null
  notes: string | null
  total_amount: number
  status: 'pending' | 'approved' | 'rejected'
  submitted_by: string
  reviewed_by: string | null
  reviewed_at: string | null
  rejection_reason: string | null
  created_at: string
  updated_at: string
  // joined
  submitter_name?: string
  items?: BatchDepositItem[]
}

// Collector: submit a new batch
export function useSubmitBatchDeposit() {
  const queryClient = useQueryClient()
  const { user } = useAuth()

  return useMutation({
    mutationFn: async (input: {
      reference?: string
      payment_method: 'cash' | 'bank_transfer' | 'mobile_money'
      receipt_url?: string
      notes?: string
      items: { user_id: string; amount: number }[]
    }) => {
      const total_amount = input.items.reduce((sum, i) => sum + i.amount, 0)

      const { data: batch, error: batchError } = await supabase
        .from('batch_deposits')
        .insert({
          reference: input.reference ?? null,
          payment_method: input.payment_method,
          receipt_url: input.receipt_url ?? null,
          notes: input.notes ?? null,
          total_amount,
          submitted_by: user!.id,
        })
        .select()
        .single()

      if (batchError) throw batchError

      const { error: itemsError } = await supabase
        .from('batch_deposit_items')
        .insert(input.items.map(item => ({
          batch_id: batch.id,
          user_id: item.user_id,
          amount: item.amount,
        })))

      if (itemsError) throw itemsError
      return batch
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['batch_deposits'] })
      toast({ title: 'Batch deposit submitted', description: 'Waiting for admin review', variant: 'success' })
    },
    onError: (err: any) => {
      toast({ title: err.message ?? 'Failed to submit batch deposit', variant: 'error' })
    },
  })
}

// Collector: own batch history
export function useMyBatchDeposits() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['batch_deposits', 'mine', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('batch_deposits')
        .select('id, reference, payment_method, receipt_url, notes, total_amount, status, submitted_by, reviewed_by, reviewed_at, rejection_reason, created_at, updated_at')
        .eq('submitted_by', user!.id)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as BatchDeposit[]
    },
    enabled: !!user?.id,
  })
}

// Admin: all batches with submitter name and item count
export function useAllBatchDeposits(status?: 'pending' | 'approved' | 'rejected') {
  return useQuery({
    queryKey: ['batch_deposits', 'all', status],
    queryFn: async () => {
      let query = supabase
        .from('batch_deposits')
        .select('*, batch_deposit_items(id, user_id, amount, deposit_request_id)')
        .order('created_at', { ascending: false })

      if (status) query = query.eq('status', status)

      const { data, error } = await query
      if (error) throw error

      // Two-step: fetch submitter names
      const submitterIds = [...new Set((data ?? []).map((b: any) => b.submitted_by))]
      const { data: profiles } = submitterIds.length > 0
        ? await supabase.from('profiles').select('id, full_name').in('id', submitterIds)
        : { data: [] }

      const nameMap = Object.fromEntries((profiles ?? []).map((p: any) => [p.id, p.full_name]))

      return (data ?? []).map((b: any) => ({
        ...b,
        submitter_name: nameMap[b.submitted_by] ?? 'Unknown',
        items: b.batch_deposit_items ?? [],
      })) as BatchDeposit[]
    },
  })
}

// Admin: single batch detail with member names
export function useBatchDepositDetail(batchId: string) {
  return useQuery({
    queryKey: ['batch_deposit_detail', batchId],
    queryFn: async () => {
      const { data: batch, error } = await supabase
        .from('batch_deposits')
        .select('*, batch_deposit_items(*)')
        .eq('id', batchId)
        .single()

      if (error) throw error

      const items = (batch.batch_deposit_items ?? []) as BatchDepositItem[]
      const memberIds = items.map((i: any) => i.user_id)

      const { data: profiles } = memberIds.length > 0
        ? await supabase.from('profiles').select('id, full_name').in('id', memberIds)
        : { data: [] }

      const nameMap = Object.fromEntries((profiles ?? []).map((p: any) => [p.id, p.full_name]))

      // Fetch submitter name
      const { data: submitterProfile } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', batch.submitted_by)
        .single()

      return {
        ...batch,
        submitter_name: submitterProfile?.full_name ?? 'Unknown',
        items: items.map((i: any) => ({
          ...i,
          member_name: nameMap[i.user_id] ?? 'Unknown',
        })),
      } as BatchDeposit
    },
    enabled: !!batchId,
  })
}

// Admin: approve batch
export function useApproveBatchDeposit() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (batchId: string) => {
      const { error } = await supabase.rpc('approve_batch_deposit', { p_batch_id: batchId })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['batch_deposits'] })
      queryClient.invalidateQueries({ queryKey: ['deposit_requests_all'] })
      toast({ title: 'Batch approved', description: 'All member deposits have been recorded', variant: 'success' })
    },
    onError: (err: any) => {
      toast({ title: err.message ?? 'Failed to approve batch', variant: 'error' })
    },
  })
}

// Admin: reject batch
export function useRejectBatchDeposit() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ batchId, reason }: { batchId: string; reason: string }) => {
      const { error } = await supabase.rpc('reject_batch_deposit', { p_batch_id: batchId, p_reason: reason })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['batch_deposits'] })
      toast({ title: 'Batch rejected', variant: 'success' })
    },
    onError: (err: any) => {
      toast({ title: err.message ?? 'Failed to reject batch', variant: 'error' })
    },
  })
}
