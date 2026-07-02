import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { Profile, EquityShare, EquityContribution, MembershipStatus, DepositRequest } from '../types'

// ─── Member row (includes membership summary fields) ─────────────────────────

export interface MemberRow extends Profile {
  membership_status: MembershipStatus | null
  total_invested: number
  completed_shares: number
}

export function useMembers() {
  return useQuery({
    queryKey: ['members_list'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select(
          `*, membership_status(status, completed_shares, last_evaluated_at, reason, updated_at)`
        )
        .eq('role', 'member')
        .order('full_name', { ascending: true })

      if (error) throw error

      // Also fetch equity summary per user
      const profileIds = (data ?? []).map((p: any) => p.id)
      if (profileIds.length === 0) return [] as MemberRow[]

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

      return (data ?? []).map((p: any) => ({
        ...p,
        membership_status: p.membership_status ?? null,
        total_invested: equityMap[p.id]?.totalInvested ?? 0,
        completed_shares: equityMap[p.id]?.completedShares ?? 0,
      })) as MemberRow[]
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
          .select('*')
          .eq('id', userId)
          .single(),
        supabase
          .from('equity_shares')
          .select('*')
          .eq('user_id', userId)
          .order('share_number', { ascending: true }),
        supabase
          .from('equity_contributions')
          .select('*, deposit_requests(receipt_url)')
          .eq('user_id', userId)
          .order('contribution_at', { ascending: false }),
        supabase
          .from('deposit_requests')
          .select('*')
          .eq('user_id', userId)
          .order('created_at', { ascending: false }),
      ])

      if (profileRes.error) throw profileRes.error

      // Fetch membership status separately (best effort)
      const { data: ms } = await supabase
        .from('membership_status')
        .select('*')
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
