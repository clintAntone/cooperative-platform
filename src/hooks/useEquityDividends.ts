import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useEffectiveUserId } from '../context/ImpersonationContext'
import { toast } from '../lib/toast'
import type { EquityDividendLog } from '../types'

export function useEquityDividendLogs(userId?: string) {
  const effectiveUserId = useEffectiveUserId()
  const targetId = userId ?? effectiveUserId
  return useQuery({
    queryKey: ['equity_dividend_logs', targetId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('equity_dividend_logs')
        .select('id, share_id, user_id, share_value, dividend_earned, period_start, period_end, released_by, created_at')
        .eq('user_id', targetId!)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as EquityDividendLog[]
    },
    enabled: !!targetId,
  })
}

export interface LastDividendRelease {
  period_end: string
  total_dividend: number
  share_count: number
  released_at: string
}

export function useLastDividendRelease() {
  return useQuery({
    queryKey: ['last_dividend_release'],
    queryFn: async (): Promise<LastDividendRelease | null> => {
      const { data, error } = await supabase
        .from('equity_dividend_logs')
        .select('period_end, dividend_earned, created_at')
        .order('created_at', { ascending: false })
        .limit(500)
      if (error) throw error
      if (!data || data.length === 0) return null
      const latest = data[0].period_end
      const batch = data.filter((r: any) => r.period_end === latest)
      return {
        period_end: latest,
        total_dividend: batch.reduce((s: number, r: any) => s + r.dividend_earned, 0),
        share_count: batch.length,
        released_at: data[0].created_at,
      }
    },
    staleTime: 60_000,
  })
}

export function useReleaseDividends() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('release_equity_dividend')
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['last_dividend_release'] })
      queryClient.invalidateQueries({ queryKey: ['equity_dividend_logs'] })
      queryClient.invalidateQueries({ queryKey: ['savings_account'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      toast({ title: 'Dividends released', description: 'All completed shares have been credited', variant: 'success' })
    },
  })
}
