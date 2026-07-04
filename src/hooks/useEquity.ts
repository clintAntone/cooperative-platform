import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { EquityShare, EquityContribution } from '../types'
import { useAuth } from '../context/AuthContext'
import { useEffectiveUserId } from '../context/ImpersonationContext'
import { toast } from '../lib/toast'

export function useEquityShares(userId?: string) {
  const effectiveUserId = useEffectiveUserId()
  const targetId = userId ?? effectiveUserId

  return useQuery({
    queryKey: ['equity_shares', targetId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('equity_shares')
        .select('*')
        .eq('user_id', targetId!)
        .order('share_number', { ascending: true })

      if (error) throw error
      return data as EquityShare[]
    },
    enabled: !!targetId,
  })
}

export function useEquityContributions(shareId: string) {
  return useQuery({
    queryKey: ['equity_contributions', shareId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('equity_contributions')
        .select('*')
        .eq('share_id', shareId)
        .order('contribution_at', { ascending: false })

      if (error) throw error
      return data as EquityContribution[]
    },
    enabled: !!shareId,
  })
}

export function useAllContributions(userId?: string) {
  const effectiveUserId = useEffectiveUserId()
  const targetId = userId ?? effectiveUserId

  return useQuery({
    queryKey: ['equity_contributions_all', targetId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('equity_contributions')
        .select('*')
        .eq('user_id', targetId!)
        .order('contribution_at', { ascending: false })

      if (error) throw error
      return data as EquityContribution[]
    },
    enabled: !!targetId,
  })
}

interface AddContributionInput {
  share_id: string
  amount: number
  payment_method: 'cash' | 'bank_transfer' | 'mobile_money'
  reference?: string
}

export function useAddContribution() {
  const queryClient = useQueryClient()
  const { user } = useAuth()

  return useMutation({
    mutationFn: async (input: AddContributionInput) => {
      const { data, error } = await supabase
        .from('equity_contributions')
        .insert({
          user_id: user!.id,
          share_id: input.share_id,
          amount: input.amount,
          payment_method: input.payment_method,
          reference: input.reference ?? null,
          recorded_by: user!.id,
        })
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['equity_shares'] })
      queryClient.invalidateQueries({ queryKey: ['equity_contributions'] })
      queryClient.invalidateQueries({ queryKey: ['equity_contributions_all'] })
      queryClient.invalidateQueries({ queryKey: ['ledger'] })
      queryClient.invalidateQueries({ queryKey: ['membership_status'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
}

export function useShareLimit(overrideUserId?: string) {
  const { user } = useAuth()
  const targetId = overrideUserId ?? user?.id

  return useQuery({
    queryKey: ['share_limit', targetId],
    queryFn: async () => {
      const [configRes, sharesRes] = await Promise.all([
        supabase
          .from('system_config')
          .select('config_value')
          .eq('config_key', 'max_shares_per_member')
          .single(),
        supabase
          .from('equity_shares')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', targetId!)
          .neq('status', 'cancelled'),
      ])

      const max = configRes.data ? parseInt(configRes.data.config_value) : 10
      const current = sharesRes.count ?? 0
      return { max, current, reached: current >= max }
    },
    enabled: !!targetId,
  })
}

export function useAdminDeleteShare(memberId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (shareId: string) => {
      const { error } = await (supabase.rpc as any)('admin_delete_share', { p_share_id: shareId })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['equity_shares', memberId] })
      queryClient.invalidateQueries({ queryKey: ['member_detail', memberId] })
    },
    onError: (err: any) => {
      toast({ title: err.message ?? 'Cannot delete share', variant: 'error' })
    },
  })
}

// Used by staff/admin to open a share on behalf of a member
export function useAdminCreateShare(memberId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async () => {
      const { data: configs } = await supabase
        .from('system_config')
        .select('config_key, config_value')
        .in('config_key', ['share_price', 'max_shares_per_member'])

      const configMap = Object.fromEntries(
        (configs ?? []).map(c => [c.config_key, c.config_value])
      )
      const sharePrice = parseFloat(configMap['share_price'] ?? '5000')
      const maxShares = parseInt(configMap['max_shares_per_member'] ?? '10')

      const { count } = await supabase
        .from('equity_shares')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', memberId)
        .neq('status', 'cancelled')

      if ((count ?? 0) >= maxShares) {
        throw new Error(`Member has reached the maximum of ${maxShares} shares.`)
      }

      const { data: existing } = await supabase
        .from('equity_shares')
        .select('share_number')
        .eq('user_id', memberId)
        .order('share_number', { ascending: false })
        .limit(1)

      const nextNumber = existing && existing.length > 0 ? existing[0].share_number + 1 : 1

      const { data, error } = await supabase
        .from('equity_shares')
        .insert({ user_id: memberId, share_number: nextNumber, target_amount: sharePrice })
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['equity_shares', memberId] })
      queryClient.invalidateQueries({ queryKey: ['member_detail', memberId] })
    },
  })
}

export function useEquitySummary() {
  const effectiveUserId = useEffectiveUserId()

  return useQuery({
    queryKey: ['equity_summary', effectiveUserId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('equity_shares')
        .select('paid_amount, target_amount, status')
        .eq('user_id', effectiveUserId!)

      if (error) throw error

      const shares = data as { paid_amount: number; target_amount: number; status: string }[]
      const totalInvested = shares.reduce((sum, s) => sum + s.paid_amount, 0)
      const completedShares = shares.filter(s => s.status === 'completed').length
      const totalShares = shares.length

      return { totalInvested, completedShares, totalShares }
    },
    enabled: !!effectiveUserId,
  })
}
