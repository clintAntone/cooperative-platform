import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useEffectiveUserId } from '../context/ImpersonationContext'

/**
 * Computes the collateral-based loan max for the borrower + selected co-makers:
 *   max = borrower_shares_value + borrower_savings + co-maker_shares_value
 * Co-maker savings are NOT included — only their completed shares count as collateral.
 *
 * Uses a SECURITY DEFINER RPC (get_completed_share_totals) to read co-maker share
 * values, because members cannot read other members' equity_shares via RLS.
 * Matches the server-side formula in admin_approve_loan_application().
 */
export function useCollateralMax(coMakerIds: string[]) {
  const effectiveUserId = useEffectiveUserId()
  const allIds = [effectiveUserId, ...coMakerIds].filter(Boolean) as string[]

  return useQuery({
    queryKey: ['collateral_max', effectiveUserId, coMakerIds],
    queryFn: async () => {
      if (!effectiveUserId) return null

      // Use SECURITY DEFINER RPC so co-maker share values are readable
      // (members cannot read other members' equity_shares via RLS directly)
      const [sharesRes, savingsRes] = await Promise.all([
        supabase.rpc('get_completed_share_totals', { p_user_ids: allIds }),
        supabase
          .from('savings_accounts')
          .select('user_id, balance')
          .eq('user_id', effectiveUserId)
          .eq('status', 'active'),
      ])

      if (sharesRes.error) throw sharesRes.error
      if (savingsRes.error) throw savingsRes.error

      const sharesByUser: Record<string, number> = {}
      ;(sharesRes.data ?? []).forEach((r: { user_id: string; total_shares: number }) => {
        sharesByUser[r.user_id] = r.total_shares
      })

      const borrowerShares = sharesByUser[effectiveUserId] ?? 0
      const borrowerSavings = (savingsRes.data?.[0] as { balance: number } | undefined)?.balance ?? 0
      const coMakerShares = coMakerIds.reduce((s, id) => s + (sharesByUser[id] ?? 0), 0)

      return {
        total: borrowerShares + borrowerSavings + coMakerShares,
        borrowerShares,
        borrowerSavings,
        coMakerShares,
      }
    },
    enabled: !!effectiveUserId,
    staleTime: 30_000,
  })
}

/**
 * Returns the member's maximum eligible loan amount based on:
 *   completedShares × sharePrice × ratio
 * where ratio depends on membership tenure (new vs senior).
 * Returns null while loading.
 */
export function useLoanEligibility() {
  const effectiveUserId = useEffectiveUserId()

  return useQuery({
    queryKey: ['loan_eligibility', effectiveUserId],
    queryFn: async () => {
      if (!effectiveUserId) return null

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
          .eq('id', effectiveUserId)
          .single(),
        supabase
          .from('equity_shares')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', effectiveUserId)
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
    enabled: !!effectiveUserId,
    staleTime: 60_000,
  })
}
