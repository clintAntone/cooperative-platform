import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

export function useAppBranding() {
  const query = useQuery({
    queryKey: ['app_branding'],
    queryFn: async () => {
      const { data } = await supabase
        .from('system_config')
        .select('config_key, config_value')
        .in('config_key', ['app_name', 'app_logo_url'])
      const map = Object.fromEntries((data ?? []).map(r => [r.config_key, r.config_value]))
      return { name: map['app_name'] || '', logoUrl: map['app_logo_url'] || '' }
    },
    staleTime: 60_000,
  })

  useEffect(() => {
    if (query.data?.name) {
      document.title = query.data.name
    }
  }, [query.data?.name])

  return query
}
