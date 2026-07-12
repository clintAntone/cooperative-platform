import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useEffectiveUserId } from '../context/ImpersonationContext'
import { toast } from '../lib/toast'
import type { EquityDividendLog } from '../types'

export interface DividendPreviewRow {
  userId: string
  fullName: string
  shareCount: number
  totalShareValue: number
  dividendAmount: number
}

export interface DividendPreview {
  rate: number
  rows: DividendPreviewRow[]
  grandTotal: number
}

export function useDividendPreview() {
  return useQuery({
    queryKey: ['dividend_preview'],
    queryFn: async (): Promise<DividendPreview> => {
      // 1. Fetch dividend rate from system_config
      const { data: configData } = await supabase
        .from('system_config')
        .select('config_key, config_value')
        .eq('config_key', 'equity_dividend_rate')
        .single()
      const rate = parseFloat(configData?.config_value ?? '5')

      // 2. Fetch all completed shares (two-step to avoid auth.users join limitation)
      const { data: shares, error: sharesError } = await supabase
        .from('equity_shares')
        .select('id, user_id, target_amount')
        .eq('status', 'completed')
      if (sharesError) throw sharesError
      if (!shares || shares.length === 0) return { rate, rows: [], grandTotal: 0 }

      // 3. Fetch member names
      const userIds = [...new Set(shares.map((s: any) => s.user_id))]
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name')
        .in('id', userIds)
      const nameMap: Record<string, string> = {}
      for (const p of profiles ?? []) nameMap[p.id] = p.full_name

      // 4. Group by user
      const byUser: Record<string, { shareCount: number; totalShareValue: number }> = {}
      for (const s of shares as any[]) {
        if (!byUser[s.user_id]) byUser[s.user_id] = { shareCount: 0, totalShareValue: 0 }
        byUser[s.user_id].shareCount += 1
        byUser[s.user_id].totalShareValue += s.target_amount
      }

      const rows: DividendPreviewRow[] = Object.entries(byUser).map(([userId, v]) => ({
        userId,
        fullName: nameMap[userId] ?? 'Unknown',
        shareCount: v.shareCount,
        totalShareValue: v.totalShareValue,
        dividendAmount: Math.round(v.totalShareValue * (rate / 100) * 100) / 100,
      }))
      rows.sort((a, b) => a.fullName.localeCompare(b.fullName))

      const grandTotal = rows.reduce((s, r) => s + r.dividendAmount, 0)
      return { rate, rows, grandTotal }
    },
    staleTime: 30_000,
  })
}

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
