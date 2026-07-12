import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useEffectiveUserId } from '../context/ImpersonationContext'
import { toast } from '../lib/toast'
import type { DamayanEvent, DamayanAssessment } from '../types'

// ─── Member ───────────────────────────────────────────────────────────────────

export function useDamayanEvents() {
  return useQuery({
    queryKey: ['damayan_events'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('damayan_events')
        .select('id, title, description, affected_member_id, event_date, assessment_amount, status, created_by, created_at, updated_at')
        .order('event_date', { ascending: false })
      if (error) throw error
      return data as DamayanEvent[]
    },
  })
}

export function useMyDamayanAssessments() {
  const effectiveUserId = useEffectiveUserId()
  return useQuery({
    queryKey: ['damayan_assessments', 'mine', effectiveUserId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('damayan_assessments')
        .select('id, event_id, user_id, amount_due, amount_paid, status, paid_at, notes, created_at, updated_at')
        .eq('user_id', effectiveUserId!)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as DamayanAssessment[]
    },
    enabled: !!effectiveUserId,
  })
}

// ─── Admin ────────────────────────────────────────────────────────────────────

export interface DamayanAssessmentWithMeta extends DamayanAssessment {
  profile: { full_name: string; employee_id: string | null } | null
}

export function useAllDamayanAssessments(eventId: string | null) {
  return useQuery({
    queryKey: ['damayan_assessments', 'event', eventId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('damayan_assessments')
        .select('id, event_id, user_id, amount_due, amount_paid, status, paid_at, notes, created_at, updated_at')
        .eq('event_id', eventId!)
        .order('created_at', { ascending: true })
      if (error) throw error
      if (!data || data.length === 0) return [] as DamayanAssessmentWithMeta[]

      const userIds = data.map((a: DamayanAssessment) => a.user_id)
      const { data: profiles, error: profileError } = await supabase
        .from('profiles')
        .select('id, full_name, employee_id')
        .in('id', userIds)
      if (profileError) throw profileError

      const profileMap = Object.fromEntries((profiles ?? []).map((p: any) => [p.id, p]))
      return data.map((a: DamayanAssessment) => ({
        ...a,
        profile: profileMap[a.user_id] ?? null,
      })) as DamayanAssessmentWithMeta[]
    },
    enabled: !!eventId,
  })
}

export function useCreateDamayanEvent() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (params: {
      title: string
      description: string | null
      affected_member_id: string | null
      event_date: string
      assessment_amount: number
    }) => {
      const { data, error } = await supabase.rpc('create_damayan_event', {
        p_title: params.title,
        p_description: params.description,
        p_affected_member_id: params.affected_member_id,
        p_event_date: params.event_date,
        p_assessment_amount: params.assessment_amount,
      })
      if (error) throw error
      return data as string
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['damayan_events'] })
      queryClient.invalidateQueries({ queryKey: ['damayan_assessments'] })
      toast({ title: 'Event created', description: 'Damayan event and assessments have been generated', variant: 'success' })
    },
  })
}

export function useRecordDamayanPayment() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ assessmentId, notes }: { assessmentId: string; notes?: string }) => {
      const { error } = await supabase.rpc('record_damayan_payment', {
        p_assessment_id: assessmentId,
        p_notes: notes ?? null,
      })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['damayan_assessments'] })
      toast({ title: 'Payment recorded', variant: 'success' })
    },
  })
}

export function useWaiveDamayanAssessment() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ assessmentId, notes }: { assessmentId: string; notes?: string }) => {
      const { error } = await supabase.rpc('waive_damayan_assessment', {
        p_assessment_id: assessmentId,
        p_notes: notes ?? null,
      })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['damayan_assessments'] })
      toast({ title: 'Assessment waived', variant: 'success' })
    },
  })
}
