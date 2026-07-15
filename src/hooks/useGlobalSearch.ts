import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

export interface SearchMember {
  id: string
  full_name: string
  employee_id: string | null
  account_status: string
}

export interface SearchLoan {
  id: string
  user_id: string
  amount_requested: number
  status: string
  member_name: string
}

export interface SearchDeposit {
  id: string
  user_id: string
  amount: number
  status: string
  member_name: string
}

export interface GlobalSearchResults {
  members: SearchMember[]
  loans: SearchLoan[]
  deposits: SearchDeposit[]
}

export function useGlobalSearch(query: string) {
  return useQuery({
    queryKey: ['global_search', query],
    queryFn: async (): Promise<GlobalSearchResults> => {
      // Step 1: Find matching member profiles
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name, employee_id, account_status')
        .eq('role', 'member')
        .or(`full_name.ilike.%${query}%,employee_id.ilike.%${query}%`)
        .limit(6)

      const members = (profiles ?? []) as SearchMember[]
      const memberIds = members.map(m => m.id)

      if (memberIds.length === 0) {
        return { members, loans: [], deposits: [] }
      }

      // Step 2: Fetch their loan apps and deposit requests in parallel
      // (two-step because loan_applications.user_id → auth.users → profiles cannot be FK-joined)
      const [loansRes, depositsRes] = await Promise.all([
        supabase
          .from('loan_applications')
          .select('id, user_id, amount_requested, status')
          .in('user_id', memberIds)
          .not('status', 'eq', 'draft')
          .order('created_at', { ascending: false })
          .limit(5),
        supabase
          .from('equity_deposit_requests')
          .select('id, user_id, amount, status')
          .in('user_id', memberIds)
          .order('created_at', { ascending: false })
          .limit(5),
      ])

      const nameMap = Object.fromEntries(members.map(m => [m.id, m.full_name]))

      return {
        members,
        loans: (loansRes.data ?? []).map(l => ({
          ...l,
          member_name: nameMap[l.user_id] ?? '',
        })),
        deposits: (depositsRes.data ?? []).map(d => ({
          ...d,
          member_name: nameMap[d.user_id] ?? '',
        })),
      }
    },
    enabled: query.length >= 2,
    staleTime: 10_000,
  })
}
