import { useState } from 'react'
import { Modal } from '../../components/ui/Modal'
import { Button } from '../../components/ui/Button'
import { useRequestShareTransfer } from '../../hooks/useShareTransfers'
import { supabase } from '../../lib/supabase'
import { useQuery } from '@tanstack/react-query'
import type { EquityShare } from '../../types'

interface ActiveMember {
  id: string
  full_name: string
  employee_id: string | null
}

function useActiveMembers() {
  return useQuery({
    queryKey: ['active_members_for_transfer'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_active_members_for_transfer')
      if (error) throw error
      return (data ?? []) as ActiveMember[]
    },
    staleTime: 60_000,
  })
}

interface ShareTransferModalProps {
  share: EquityShare
  onClose: () => void
}

export function ShareTransferModal({ share, onClose }: ShareTransferModalProps) {
  const { data: members = [], isLoading: membersLoading } = useActiveMembers()
  const requestTransfer = useRequestShareTransfer()

  const [toUserId, setToUserId] = useState('')
  const [search, setSearch] = useState('')
  const [reason, setReason] = useState('')

  const selectedMember = members.find(m => m.id === toUserId) ?? null

  const filtered = members.filter(m => {
    const q = search.toLowerCase()
    return (
      m.full_name.toLowerCase().includes(q) ||
      (m.employee_id ?? '').toLowerCase().includes(q)
    )
  })

  const handleSubmit = () => {
    if (!toUserId) return
    requestTransfer.mutate(
      { shareId: share.id, toUserId, reason: reason.trim() || undefined },
      {
        onSuccess: () => onClose(),
        onError: (err: any) => alert(err.message ?? 'Failed to submit transfer request'),
      }
    )
  }

  return (
    <Modal isOpen onClose={onClose} title={`Transfer Share #${share.share_number}`} size="sm">
      <div className="space-y-4">
        <p className="text-sm text-gray-600">
          Transfer ownership of <strong>Share #{share.share_number}</strong> to another member.
          An admin will review and approve before the transfer is completed.
        </p>

        {/* Member picker */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Transfer To <span className="text-red-500">*</span>
          </label>

          {membersLoading ? (
            <p className="text-sm text-gray-400">Loading members…</p>
          ) : members.length === 0 ? (
            <p className="text-sm text-gray-400 italic">No eligible members found.</p>
          ) : selectedMember ? (
            /* Selected state — show chosen member with a clear button */
            <div className="flex items-center justify-between gap-2 rounded-lg border border-blue-500 bg-blue-50 px-3 py-2.5">
              <div>
                <p className="text-sm font-medium text-blue-900">{selectedMember.full_name}</p>
                {selectedMember.employee_id && (
                  <p className="text-xs text-blue-600">{selectedMember.employee_id}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => { setToUserId(''); setSearch('') }}
                className="text-blue-400 hover:text-blue-600 text-xs shrink-0"
              >
                Change
              </button>
            </div>
          ) : (
            /* Search + list */
            <div className="rounded-lg border border-gray-300 overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-200 bg-gray-50">
                <svg className="w-4 h-4 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  autoFocus
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search by name or ID…"
                  className="flex-1 bg-transparent text-sm outline-none placeholder-gray-400"
                />
                {search && (
                  <button type="button" onClick={() => setSearch('')} className="text-gray-400">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
              <ul className="max-h-48 overflow-y-auto divide-y divide-gray-100">
                {filtered.length === 0 ? (
                  <li className="px-3 py-3 text-sm text-gray-400 text-center">No members match</li>
                ) : filtered.map(m => (
                  <li key={m.id}>
                    <button
                      type="button"
                      onClick={() => setToUserId(m.id)}
                      className="w-full text-left px-3 py-3 hover:bg-blue-50 active:bg-blue-100 transition-colors"
                    >
                      <p className="text-sm font-medium text-gray-900">{m.full_name}</p>
                      {m.employee_id && (
                        <p className="text-xs text-gray-500 mt-0.5">{m.employee_id}</p>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Reason (optional)</label>
          <textarea
            rows={2}
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="Briefly explain why you're transferring this share…"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          />
        </div>

        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-xs text-yellow-800">
          Only completed shares can be transferred. Transfers require admin approval.
          Once approved, the share is permanently moved to the recipient.
        </div>

        <div className="flex gap-3">
          <Button variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
          <Button
            className="flex-1"
            loading={requestTransfer.isPending}
            disabled={!toUserId}
            onClick={handleSubmit}
          >
            Submit Request
          </Button>
        </div>
      </div>
    </Modal>
  )
}
