import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

/**
 * Returns the member's maximum eligible loan amount based on:
 *   completedShares × sharePrice × ratio
 * where ratio depends on membership tenure (new vs senior).
 * Returns null while loading.
 */
export function useLoanEligibility() {
  const { user } = useAuth()

  return useQuery({
    queryKey: ['loan_eligibility', user?.id],
    queryFn: async () => {
      if (!user) return null

      const [configRes, profileRes, sharesRes] = await Promise.all([
        supabase
          .from('system_config')
          .select('config_key, config_value')
          .in('config_key', [
            'loan_ratio_new_member',
            'loan_ratio_senior_member',
            'loan_ratio_tenure_months',
            'share_price',
          ]),
        supabase
          .from('profiles')
          .select('created_at')
          .eq('id', user.id)
          .single(),
        supabase
          .from('equity_shares')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .eq('status', 'completed'),
      ])

      const cfg: Record<string, string> = {}
      ;(configRes.data ?? []).forEach((c: { config_key: string; config_value: string }) => {
        cfg[c.config_key] = c.config_value
      })

      const sharePrice = parseFloat(cfg.share_price ?? '5000')
      const ratioNew = parseFloat(cfg.loan_ratio_new_member ?? '1')
      const ratioSenior = parseFloat(cfg.loan_ratio_senior_member ?? '3')
      const tenureMonths = parseInt(cfg.loan_ratio_tenure_months ?? '12')

      let ratio = ratioNew
      if (profileRes.data) {
        const monthsAsMember =
          (Date.now() - new Date(profileRes.data.created_at).getTime()) /
          (1000 * 60 * 60 * 24 * 30.44)
        if (monthsAsMember >= tenureMonths) ratio = ratioSenior
      }

      const completedShares = sharesRes.count ?? 0
      return completedShares * sharePrice * ratio
    },
    enabled: !!user?.id,
    staleTime: 60_000,
  })
}
