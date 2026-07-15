import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useEffectiveUserId } from '../context/ImpersonationContext'
import { toast } from '../lib/toast'
import type { RebateRelease, RebateLog } from '../types'

// ─── Preview ──────────────────────────────────────────────────────────────────

export interface RebatePreviewRow {
  userId: string
  fullName: string
  interestPaid: number
  rebateAmount: number
}

export interface RebatePreview {
  rate: number
  rows: RebatePreviewRow[]
  grandTotal: number
}

export function useRebatePreview(periodStart: string, periodEnd: string) {
  const enabled = !!periodStart && !!periodEnd && periodStart < periodEnd
  return useQuery({
    queryKey: ['rebate_preview', periodStart, periodEnd],
    queryFn: async (): Promise<RebatePreview> => {
      // 1. Fetch rebate rate
      const { data: configData } = await supabase
        .from('system_config')
        .select('config_value')
        .eq('config_key', 'rebate_rate')
        .single()
      const rate = parseFloat(configData?.config_value ?? '10')

      // 2. Fetch paid schedule rows in range
      const { data: schedules, error } = await supabase
        .from('loan_repayment_schedules')
        .select('loan_id, interest_due, paid_at')
        .eq('status', 'paid')
        .gte('paid_at', periodStart)
        .lte('paid_at', periodEnd)
      if (error) throw error
      if (!schedules || schedules.length === 0) return { rate, rows: [], grandTotal: 0 }

      // 3. Get loan → user_id mapping
      const loanIds = [...new Set((schedules as any[]).map(s => s.loan_id))]
      const { data: loans } = await supabase
        .from('loans')
        .select('id, user_id')
        .in('id', loanIds)
      const loanUserMap: Record<string, string> = {}
      for (const l of loans ?? []) loanUserMap[l.id] = l.user_id

      // 4. Group interest by user
      const byUser: Record<string, number> = {}
      for (const s of schedules as any[]) {
        const uid = loanUserMap[s.loan_id]
        if (!uid) continue
        byUser[uid] = (byUser[uid] ?? 0) + s.interest_due
      }

      // 5. Fetch member names
      const userIds = Object.keys(byUser)
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name')
        .in('id', userIds)
      const nameMap: Record<string, string> = {}
      for (const p of profiles ?? []) nameMap[p.id] = p.full_name

      const rows: RebatePreviewRow[] = userIds.map(uid => ({
        userId: uid,
        fullName: nameMap[uid] ?? 'Unknown',
        interestPaid: byUser[uid],
        rebateAmount: Math.round(byUser[uid] * (rate / 100) * 100) / 100,
      }))
      rows.sort((a, b) => a.fullName.localeCompare(b.fullName))

      return { rate, rows, grandTotal: rows.reduce((s, r) => s + r.rebateAmount, 0) }
    },
    enabled,
    staleTime: 30_000,
  })
}

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
