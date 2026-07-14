import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

/** Monthly equity contributions for the last 12 months */
export function useMonthlyContributions() {
  return useQuery({
    queryKey: ['monthly_contributions'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('equity_contributions')
        .select('amount, created_at')
        .gte('created_at', new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString())
        .order('created_at', { ascending: true })
      if (error) throw error

      // Group by month
      const map: Record<string, number> = {}
      for (const row of data as { amount: number; created_at: string }[]) {
        const d = new Date(row.created_at)
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
        map[key] = (map[key] ?? 0) + row.amount
      }
      return Object.entries(map)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, amount]) => ({
          month: new Date(month + '-01').toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
          amount,
        }))
    },
    staleTime: 60_000,
  })
}

/** New member registrations grouped by month for the last 12 months */
export function useMonthlyNewMembers() {
  return useQuery({
    queryKey: ['monthly_new_members'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('created_at')
        .in('role', ['member', 'collector'])
        .gte('created_at', new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString())
        .order('created_at', { ascending: true })
      if (error) throw error

      const map: Record<string, number> = {}
      for (const row of data as { created_at: string }[]) {
        const d = new Date(row.created_at)
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
        map[key] = (map[key] ?? 0) + 1
      }
      return Object.entries(map)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, count]) => ({
          month: new Date(month + '-01').toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
          count,
        }))
    },
    staleTime: 60_000,
  })
}
