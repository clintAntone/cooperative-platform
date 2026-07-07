import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { toast } from '../lib/toast'

export interface MemberNote {
  id: string
  member_id: string
  author_id: string
  note: string
  created_at: string
  updated_at: string
  author_name?: string
}

export function useMemberNotes(memberId: string) {
  return useQuery({
    queryKey: ['member_notes', memberId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('member_notes')
        .select('id, member_id, author_id, note, created_at, updated_at')
        .eq('member_id', memberId)
        .order('created_at', { ascending: false })
      if (error) throw error

      const notes = (data ?? []) as MemberNote[]
      if (notes.length === 0) return notes

      // Two-step: fetch author names
      const authorIds = [...new Set(notes.map(n => n.author_id))]
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name')
        .in('id', authorIds)

      const nameMap = Object.fromEntries((profiles ?? []).map((p: any) => [p.id, p.full_name]))
      return notes.map(n => ({ ...n, author_name: nameMap[n.author_id] ?? 'Unknown' }))
    },
    enabled: !!memberId,
  })
}

export function useAddMemberNote(memberId: string) {
  const queryClient = useQueryClient()
  const { user } = useAuth()

  return useMutation({
    mutationFn: async (note: string) => {
      const { error } = await supabase.from('member_notes').insert({
        member_id: memberId,
        author_id: user!.id,
        note,
      })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['member_notes', memberId] })
      toast({ title: 'Note added', variant: 'success' })
    },
    onError: (err: any) => {
      toast({ title: err.message ?? 'Failed to add note', variant: 'error' })
    },
  })
}

export function useDeleteMemberNote(memberId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (noteId: string) => {
      const { error } = await supabase
        .from('member_notes')
        .delete()
        .eq('id', noteId)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['member_notes', memberId] })
      toast({ title: 'Note deleted', variant: 'info' })
    },
    onError: (err: any) => {
      toast({ title: err.message ?? 'Failed to delete note', variant: 'error' })
    },
  })
}
