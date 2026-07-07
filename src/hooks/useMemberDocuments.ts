import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { toast } from '../lib/toast'

export type DocumentType = 'government_id' | 'proof_of_address' | 'other'

export interface MemberDocument {
  id: string
  user_id: string
  document_type: DocumentType
  file_name: string
  file_url: string
  uploaded_at: string
}

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  government_id: 'Government ID',
  proof_of_address: 'Proof of Address',
  other: 'Other',
}

const MAX_SIZE_MB = 10
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'application/pdf']

async function uploadDocumentFile(userId: string, file: File): Promise<string> {
  if (!ALLOWED_TYPES.includes(file.type)) {
    throw new Error('Only JPG, PNG, and PDF files are accepted.')
  }
  if (file.size > MAX_SIZE_MB * 1024 * 1024) {
    throw new Error(`File size must be under ${MAX_SIZE_MB}MB.`)
  }
  const ext = file.name.split('.').pop()
  const path = `${userId}/${Date.now()}.${ext}`
  const { error } = await supabase.storage.from('member-documents').upload(path, file)
  if (error) throw error
  const { data } = supabase.storage.from('member-documents').getPublicUrl(path)
  return data.publicUrl
}

// Member: own documents
export function useMyDocuments() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['member_documents', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('member_documents')
        .select('id, user_id, document_type, file_name, file_url, uploaded_at')
        .eq('user_id', user!.id)
        .order('uploaded_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as MemberDocument[]
    },
    enabled: !!user?.id,
  })
}

// Admin/staff: view a specific member's documents
export function useMemberDocuments(memberId: string) {
  return useQuery({
    queryKey: ['member_documents', memberId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('member_documents')
        .select('id, user_id, document_type, file_name, file_url, uploaded_at')
        .eq('user_id', memberId)
        .order('uploaded_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as MemberDocument[]
    },
    enabled: !!memberId,
  })
}

// Member: upload a document
export function useUploadDocument() {
  const queryClient = useQueryClient()
  const { user } = useAuth()

  return useMutation({
    mutationFn: async ({ file, documentType }: { file: File; documentType: DocumentType }) => {
      const fileUrl = await uploadDocumentFile(user!.id, file)
      const { error } = await supabase.from('member_documents').insert({
        user_id: user!.id,
        document_type: documentType,
        file_name: file.name,
        file_url: fileUrl,
      })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['member_documents', user?.id] })
      toast({ title: 'Document uploaded', variant: 'success' })
    },
    onError: (err: any) => {
      toast({ title: err.message ?? 'Upload failed', variant: 'error' })
    },
  })
}

// Member: delete a document
export function useDeleteDocument() {
  const queryClient = useQueryClient()
  const { user } = useAuth()

  return useMutation({
    mutationFn: async (documentId: string) => {
      const { error } = await supabase
        .from('member_documents')
        .delete()
        .eq('id', documentId)
        .eq('user_id', user!.id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['member_documents'] })
      toast({ title: 'Document removed', variant: 'info' })
    },
    onError: (err: any) => {
      toast({ title: err.message ?? 'Delete failed', variant: 'error' })
    },
  })
}
