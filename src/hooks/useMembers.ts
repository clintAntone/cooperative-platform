import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { toast } from '../lib/toast'
import type { Profile, EquityShare, EquityContribution, MembershipStatus, DepositRequest } from '../types'

// ─── Member row (includes membership summary fields) ─────────────────────────

export interface MemberRow extends Profile {
  membership_status: MembershipStatus | null
  total_invested: number
  completed_shares: number
}

export interface MembersPage {
  rows: MemberRow[]
  total: number
}

export function useMembers(params?: {
  page?: number
  pageSize?: number
  search?: string
  sortKey?: 'full_name' | 'created_at'
  sortDir?: 'asc' | 'desc'
}) {
  const page = params?.page ?? 0
  const pageSize = params?.pageSize ?? 20
  const search = params?.search ?? ''
  const sortKey = params?.sortKey ?? 'full_name'
  const sortDir = params?.sortDir ?? 'asc'

  return useQuery({
    queryKey: ['members_list', page, pageSize, search, sortKey, sortDir],
    queryFn: async (): Promise<MembersPage> => {
      const from = page * pageSize
      const to = from + pageSize - 1

      let query = supabase
        .from('profiles')
        .select(
          `*, membership_status(status, completed_shares, last_evaluated_at, reason, updated_at)`,
          { count: 'exact' }
        )
        .in('role', ['member', 'collector'])
        .order(sortKey, { ascending: sortDir === 'asc' })
        .range(from, to)

      if (search) {
        query = query.or(`full_name.ilike.%${search}%,employee_id.ilike.%${search}%`)
      }

      const { data, error, count } = await query
      if (error) throw error

      const profileIds = (data ?? []).map((p: any) => p.id)
      if (profileIds.length === 0) return { rows: [], total: count ?? 0 }

      const { data: shares } = await supabase
        .from('equity_shares')
        .select('user_id, paid_amount, target_amount, status')
        .in('user_id', profileIds)

      const equityMap: Record<string, { totalInvested: number; completedShares: number }> = {}
      for (const s of shares ?? []) {
        if (!equityMap[s.user_id]) equityMap[s.user_id] = { totalInvested: 0, completedShares: 0 }
        equityMap[s.user_id].totalInvested += s.paid_amount ?? 0
        const target = s.target_amount ?? 0
        if (target > 0) {
          equityMap[s.user_id].completedShares += Math.min((s.paid_amount ?? 0) / target, 1)
        }
      }

      return {
        rows: (data ?? []).map((p: any) => ({
          ...p,
          membership_status: p.membership_status ?? null,
          total_invested: equityMap[p.id]?.totalInvested ?? 0,
          completed_shares: equityMap[p.id]?.completedShares ?? 0,
        })) as MemberRow[],
        total: count ?? 0,
      }
    },
  })
}

// ─── Single member detail ─────────────────────────────────────────────────────

export interface MemberDetail {
  profile: Profile
  membershipStatus: MembershipStatus | null
  equityShares: EquityShare[]
  contributions: EquityContribution[]
  depositRequests: DepositRequest[]
}

export function useMemberDetail(userId: string) {
  return useQuery({
    queryKey: ['member_detail', userId],
    queryFn: async () => {
      const [profileRes, sharesRes, contribRes, depositsRes] = await Promise.all([
        supabase
          .from('profiles')
          .select('id, full_name, phone, role, account_status, employee_id, avatar_url, date_of_birth, address, civil_status, emergency_contact_name, emergency_contact_phone, profile_completed_at, created_at, updated_at')
          .eq('id', userId)
          .single(),
        supabase
          .from('equity_shares')
          .select('id, user_id, share_number, target_amount, paid_amount, status, completed_at, created_at, updated_at')
          .eq('user_id', userId)
          .order('share_number', { ascending: true }),
        supabase
          .from('equity_contributions')
          .select('*, deposit_requests(receipt_url)')
          .eq('user_id', userId)
          .order('contribution_at', { ascending: false }),
        supabase
          .from('deposit_requests')
          .select('id, user_id, share_id, amount, payment_method, reference, receipt_url, notes, status, reviewed_by, reviewed_at, rejection_reason, created_at, updated_at')
          .eq('user_id', userId)
          .order('created_at', { ascending: false }),
      ])

      if (profileRes.error) throw profileRes.error

      // Fetch membership status separately (best effort)
      const { data: ms } = await supabase
        .from('membership_status')
        .select('id, user_id, status, completed_shares, last_evaluated_at, reason, updated_at')
        .eq('user_id', userId)
        .maybeSingle()

      return {
        profile: profileRes.data as Profile,
        membershipStatus: ms as MembershipStatus | null,
        equityShares: (sharesRes.data ?? []) as EquityShare[],
        contributions: (contribRes.data ?? []) as EquityContribution[],
        depositRequests: (depositsRes.data ?? []) as DepositRequest[],
      } as MemberDetail
    },
    enabled: !!userId,
  })
}

export function useBulkUpdateMembershipStatus() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      userIds,
      status,
      reason,
    }: {
      userIds: string[]
      status: 'active' | 'suspended'
      reason: string
    }) => {
      const results = await Promise.allSettled(
        userIds.map(id =>
          supabase.rpc('admin_set_membership_status', {
            p_user_id: id,
            p_status: status,
            p_reason: reason,
          })
        )
      )
      const failed = results.filter(r => r.status === 'rejected').length
      if (failed > 0) throw new Error(`${failed} member(s) failed to update`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['members_list'] })
      queryClient.invalidateQueries({ queryKey: ['member_list_report'] })
      toast({ title: 'Member statuses updated', variant: 'success' })
    },
    onError: (err: any) => {
      queryClient.invalidateQueries({ queryKey: ['members_list'] })
      toast({ title: err.message ?? 'Bulk update partially failed', variant: 'error' })
    },
  })
}
