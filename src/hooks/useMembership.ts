import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { MembershipStatus, MembershipHistory } from '../types'
import { useAuth } from '../context/AuthContext'

export function useMembershipStatus(userId?: string) {
  const { user } = useAuth()
  const targetId = userId ?? user?.id

  return useQuery({
    queryKey: ['membership_status', targetId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('membership_status')
        .select('*')
        .eq('user_id', targetId!)
        .single()

      if (error) {
        if (error.code === 'PGRST116') return null // Not found
        throw error
      }
      return data as MembershipStatus
    },
    enabled: !!targetId,
  })
}

export function useMembershipHistory(userId?: string) {
  const { user } = useAuth()
  const targetId = userId ?? user?.id

  return useQuery({
    queryKey: ['membership_history', targetId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('membership_history')
        .select('*')
        .eq('user_id', targetId!)
        .order('changed_at', { ascending: false })

      if (error) throw error
      return data as MembershipHistory[]
    },
    enabled: !!targetId,
  })
}

export function useAllMemberships() {
  return useQuery({
    queryKey: ['all_memberships'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('membership_status')
        .select('*, profiles(full_name, phone, role)')
        .order('updated_at', { ascending: false })

      if (error) throw error
      return data
    },
  })
}

export function useMembershipBreakdown() {
  return useQuery({
    queryKey: ['membership_breakdown'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('membership_status')
        .select('status')

      if (error) throw error

      const breakdown = { pending: 0, active: 0, suspended: 0, inactive: 0 }
      data.forEach((row: { status: string }) => {
        const s = row.status as keyof typeof breakdown
        if (s in breakdown) breakdown[s]++
      })

      return breakdown
    },
  })
}
