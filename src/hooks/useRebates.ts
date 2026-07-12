import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useEffectiveUserId } from '../context/ImpersonationContext'
import { toast } from '../lib/toast'
import type { RebateRelease, RebateLog } from '../types'

// ─── Member ───────────────────────────────────────────────────────────────────

export function useMyRebateLogs() {
  const effectiveUserId = useEffectiveUserId()
  return useQuery({
    queryKey: ['rebate_logs', 'mine', effectiveUserId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('rebate_logs')
        .select('id, release_id, user_id, interest_paid, rebate_rate, rebate_amount, created_at')
        .eq('user_id', effectiveUserId!)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as RebateLog[]
    },
    enabled: !!effectiveUserId,
  })
}

// ─── Admin ────────────────────────────────────────────────────────────────────

export function useRebateReleases() {
  return useQuery({
    queryKey: ['rebate_releases'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('rebate_releases')
        .select('id, period_start, period_end, rebate_rate, total_amount, released_by, notes, created_at')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as RebateRelease[]
    },
  })
}

export function useReleaseRebates() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ periodStart, periodEnd }: { periodStart: string; periodEnd: string }) => {
      const { data, error } = await supabase.rpc('release_rebates', {
        p_period_start: periodStart,
        p_period_end: periodEnd,
      })
      if (error) throw error
      return data as string
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rebate_releases'] })
      queryClient.invalidateQueries({ queryKey: ['rebate_logs'] })
      queryClient.invalidateQueries({ queryKey: ['savings_account'] })
      toast({ title: 'Rebates released', description: 'Loan interest rebates have been credited to members', variant: 'success' })
    },
  })
}
