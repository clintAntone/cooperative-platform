import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { formatCurrency } from '../lib/utils'

export function useCurrency() {
  const { data: symbol = '₱' } = useQuery({
    queryKey: ['currency_symbol'],
    queryFn: async () => {
      const { data } = await supabase
        .from('system_config')
        .select('config_value')
        .eq('config_key', 'currency_symbol')
        .maybeSingle()
      return data?.config_value ?? '₱'
    },
    staleTime: Infinity, // currency rarely changes — cached for the session
  })

  return {
    symbol,
    format: (amount: number) => formatCurrency(amount, symbol),
  }
}
