import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useEffectiveUserId } from '../context/ImpersonationContext'
import { toast } from '../lib/toast'
import type { ShareTransfer } from '../types'

// ─── Member: my share transfers ───────────────────────────────────────────────

export function useMyShareTransfers() {
  const effectiveUserId = useEffectiveUserId()
  return useQuery({
    queryKey: ['share_transfers', 'mine', effectiveUserId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('share_transfers')
        .select('id, share_id, from_user_id, to_user_id, reason, status, reviewed_by, reviewed_at, rejection_reason, created_at, updated_at')
        .or(`from_user_id.eq.${effectiveUserId},to_user_id.eq.${effectiveUserId}`)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as ShareTransfer[]
    },
    enabled: !!effectiveUserId,
  })
}

export function useRequestShareTransfer() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ shareId, toUserId, reason }: { shareId: string; toUserId: string; reason?: string }) => {
      const { data, error } = await supabase.rpc('request_share_transfer', {
        p_share_id: shareId,
        p_to_user_id: toUserId,
        p_reason: reason ?? null,
      })
      if (error) throw error
      return data as string
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['share_transfers'] })
      queryClient.invalidateQueries({ queryKey: ['equity_shares'] })
      toast({ title: 'Transfer requested', description: 'Your transfer request has been submitted for review', variant: 'success' })
    },
  })
}

// ─── Admin: all share transfers ───────────────────────────────────────────────

export interface ShareTransferWithMeta extends ShareTransfer {
  from_profile: { full_name: string; employee_id: string | null } | null
  to_profile: { full_name: string; employee_id: string | null } | null
}

export function useAllShareTransfers(params: {
  statusFilter: string
  page: number
  pageSize: number
  search: string
}) {
  return useQuery({
    queryKey: ['share_transfers', 'all', params],
    queryFn: async () => {
      // Two-step fetch: get transfers, then get profiles
      let query = supabase
        .from('share_transfers')
        .select('id, share_id, from_user_id, to_user_id, reason, status, reviewed_by, reviewed_at, rejection_reason, created_at, updated_at', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(params.page * params.pageSize, (params.page + 1) * params.pageSize - 1)

      if (params.statusFilter !== 'all') {
        query = query.eq('status', params.statusFilter)
      }

      const { data: transfers, error, count } = await query
      if (error) throw error
      if (!transfers || transfers.length === 0) return { rows: [], total: count ?? 0 }

      // Collect all user IDs
      const userIds = Array.from(new Set([
        ...transfers.map((t: ShareTransfer) => t.from_user_id),
        ...transfers.map((t: ShareTransfer) => t.to_user_id),
      ]))

      const { data: profiles, error: profileError } = await supabase
        .from('profiles')
        .select('id, full_name, employee_id')
        .in('id', userIds)
      if (profileError) throw profileError

      const profileMap = Object.fromEntries((profiles ?? []).map((p: any) => [p.id, p]))

      let rows: ShareTransferWithMeta[] = transfers.map((t: ShareTransfer) => ({
        ...t,
        from_profile: profileMap[t.from_user_id] ?? null,
        to_profile: profileMap[t.to_user_id] ?? null,
      }))

      // Client-side search filter
      if (params.search.trim()) {
        const q = params.search.toLowerCase()
        rows = rows.filter(r =>
          r.from_profile?.full_name?.toLowerCase().includes(q) ||
          r.from_profile?.employee_id?.toLowerCase().includes(q) ||
          r.to_profile?.full_name?.toLowerCase().includes(q) ||
          r.to_profile?.employee_id?.toLowerCase().includes(q)
        )
      }

      return { rows, total: count ?? 0 }
    },
  })
}

export function useApproveShareTransfer() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (transferId: string) => {
      const { error } = await supabase.rpc('admin_approve_share_transfer', { p_transfer_id: transferId })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['share_transfers'] })
      queryClient.invalidateQueries({ queryKey: ['equity_shares'] })
      toast({ title: 'Transfer approved', description: 'Share ownership has been updated', variant: 'success' })
    },
  })
}

export function useRejectShareTransfer() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ transferId, reason }: { transferId: string; reason: string }) => {
      const { error } = await supabase.rpc('admin_reject_share_transfer', {
        p_transfer_id: transferId,
        p_reason: reason,
      })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['share_transfers'] })
      toast({ title: 'Transfer rejected', variant: 'success' })
    },
  })
}
