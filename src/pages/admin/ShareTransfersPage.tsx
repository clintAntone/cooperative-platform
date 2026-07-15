import { useState } from 'react'
import { Header } from '../../components/layout/Header'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import {
  useAllShareTransfers,
  useApproveShareTransfer,
  useRejectShareTransfer,
} from '../../hooks/useShareTransfers'
import type { ShareTransferWithMeta } from '../../hooks/useShareTransfers'
import { formatDateTime } from '../../lib/utils'
import { PageGuide } from '../../components/shared/PageGuide'

const statusColors: Record<string, string> = {
  pending:  'bg-yellow-100 text-yellow-800',
  approved: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
}

const PAGE_SIZE = 25

export function ShareTransfersPage() {
  const [statusFilter, setStatusFilter] = useState('pending')
  const [page, setPage] = useState(0)
  const [search, setSearch] = useState('')
  const [approveTarget, setApproveTarget] = useState<ShareTransferWithMeta | null>(null)
  const [rejectTarget, setRejectTarget] = useState<ShareTransferWithMeta | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [detailTransfer, setDetailTransfer] = useState<ShareTransferWithMeta | null>(null)

  const { data, isLoading } = useAllShareTransfers({ statusFilter, page, pageSize: PAGE_SIZE, search })
  const approve = useApproveShareTransfer()
  const reject = useRejectShareTransfer()

  const rows = data?.rows ?? []
  const total = data?.total ?? 0
  const totalPages = Math.ceil(total / PAGE_SIZE)
  const statusTabs = ['pending', 'approved', 'rejected', 'all']

  return (
    <div>
      <Header title="Share Transfers" subtitle="Review and approve member equity share transfer requests" />

      <div className="p-4 sm:p-6 space-y-4">
        <PageGuide
          storageKey="share-transfers"
          steps={[
            'A member can request to transfer ownership of a completed equity share to another active member.',
            'Review the transfer: check both parties are active members and that the reason is valid.',
            'Approve to reassign the share — the new owner takes over all obligations and benefits.',
            'Reject with a reason to decline the transfer request.',
          ]}
          note="Only completed shares can be transferred. Transferred shares retain their paid-in value. Both parties receive a ledger entry (transfer-out / transfer-in)."
        />
        {/* Status filter tabs */}
        <div className="overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0">
          <div className="flex gap-1 w-max min-w-full sm:w-fit border-b border-gray-200">
            {statusTabs.map(s => (
              <button
                key={s}
                onClick={() => { setStatusFilter(s); setPage(0) }}
                className={`px-4 py-2.5 text-sm font-medium capitalize whitespace-nowrap border-b-2 -mb-px transition-colors ${
                  statusFilter === s
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* Search */}
        <div className="relative max-w-sm">
          <input
            type="text"
            placeholder="Search by member name or employee ID…"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(0) }}
            className="w-full border border-gray-300 rounded-lg pl-3 pr-8 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* Mobile cards */}
        <div className="sm:hidden space-y-3">
          {isLoading ? (
            <p className="text-sm text-gray-400 text-center py-8">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">No transfer requests found.</p>
          ) : rows.map(t => (
            <div key={t.id} className="bg-white rounded-xl border border-gray-200 px-4 py-3.5 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs text-gray-500 font-medium">From</p>
                  <p className="text-sm font-semibold text-gray-900">{t.from_profile?.full_name ?? '—'}</p>
                  {t.from_profile?.employee_id && <p className="text-xs text-gray-500">{t.from_profile.employee_id}</p>}
                </div>
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize ${statusColors[t.status]}`}>
                  {t.status}
                </span>
              </div>
              <div>
                <p className="text-xs text-gray-500 font-medium">To</p>
                <p className="text-sm text-gray-800">{t.to_profile?.full_name ?? '—'}</p>
                {t.to_profile?.employee_id && <p className="text-xs text-gray-500">{t.to_profile.employee_id}</p>}
              </div>
              {t.reason && <p className="text-xs text-gray-500 italic">Reason: {t.reason}</p>}
              <p className="text-xs text-gray-400">{formatDateTime(t.created_at)}</p>
              {t.status === 'pending' && (
                <div className="flex gap-2 pt-1">
                  <Button size="sm" className="flex-1" onClick={() => setApproveTarget(t)}>Approve</Button>
                  <Button size="sm" variant="outline" className="flex-1 text-red-600 border-red-200 hover:bg-red-50" onClick={() => { setRejectTarget(t); setRejectReason('') }}>Reject</Button>
                </div>
              )}
              {t.status === 'rejected' && t.rejection_reason && (
                <p className="text-xs text-red-500">Reason: {t.rejection_reason}</p>
              )}
            </div>
          ))}
        </div>

        {/* Desktop table */}
        <Card className="hidden sm:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Date</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">From Member</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">To Member</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Reason</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {isLoading ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-400">Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-400">No transfer requests found.</td></tr>
              ) : rows.map(t => (
                <tr key={t.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => setDetailTransfer(t)}>
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{formatDateTime(t.created_at)}</td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{t.from_profile?.full_name ?? '—'}</p>
                    {t.from_profile?.employee_id && <p className="text-xs text-gray-500">{t.from_profile.employee_id}</p>}
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{t.to_profile?.full_name ?? '—'}</p>
                    {t.to_profile?.employee_id && <p className="text-xs text-gray-500">{t.to_profile.employee_id}</p>}
                  </td>
                  <td className="px-4 py-3 text-gray-500 max-w-xs">
                    <p className="truncate">{t.reason ?? '—'}</p>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize ${statusColors[t.status]}`}>
                      {t.status}
                    </span>
                    {t.status === 'rejected' && t.rejection_reason && (
                      <p className="text-xs text-red-500 mt-0.5 max-w-xs">{t.rejection_reason}</p>
                    )}
                  </td>
                  <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                    {t.status === 'pending' && (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setApproveTarget(t)}
                          className="text-xs text-green-600 hover:text-green-800 font-medium"
                        >
                          Approve
                        </button>
                        <span className="text-gray-300">|</span>
                        <button
                          onClick={() => { setRejectTarget(t); setRejectReason('') }}
                          className="text-xs text-red-600 hover:text-red-800 font-medium"
                        >
                          Reject
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between text-sm text-gray-500">
            <span>Page {page + 1} of {totalPages} · {total} total</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Previous</Button>
              <Button size="sm" variant="outline" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>Next</Button>
            </div>
          </div>
        )}
      </div>

      {/* Detail modal */}
      <Modal isOpen={!!detailTransfer} onClose={() => setDetailTransfer(null)} title="Share Transfer Details" size="lg">
        {detailTransfer && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-xs text-gray-500">{formatDateTime(detailTransfer.created_at)}</p>
              <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold capitalize ${statusColors[detailTransfer.status]}`}>
                {detailTransfer.status}
              </span>
            </div>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm border-t border-gray-100 pt-4">
              <div>
                <dt className="text-xs text-gray-500">From</dt>
                <dd className="font-semibold text-gray-900 mt-0.5">{detailTransfer.from_profile?.full_name ?? '—'}</dd>
                {detailTransfer.from_profile?.employee_id && <dd className="text-xs text-gray-500">{detailTransfer.from_profile.employee_id}</dd>}
              </div>
              <div>
                <dt className="text-xs text-gray-500">To</dt>
                <dd className="font-semibold text-gray-900 mt-0.5">{detailTransfer.to_profile?.full_name ?? '—'}</dd>
                {detailTransfer.to_profile?.employee_id && <dd className="text-xs text-gray-500">{detailTransfer.to_profile.employee_id}</dd>}
              </div>
              {detailTransfer.reason && (
                <div className="col-span-2">
                  <dt className="text-xs text-gray-500">Reason</dt>
                  <dd className="text-gray-800 mt-0.5">{detailTransfer.reason}</dd>
                </div>
              )}
              {detailTransfer.status === 'rejected' && detailTransfer.rejection_reason && (
                <div className="col-span-2">
                  <dt className="text-xs text-red-500">Rejection Reason</dt>
                  <dd className="text-red-700 mt-0.5">{detailTransfer.rejection_reason}</dd>
                </div>
              )}
            </dl>
            {detailTransfer.status === 'pending' && (
              <div className="flex gap-3 pt-2 border-t border-gray-100">
                <Button variant="outline" className="flex-1 text-red-600 border-red-200 hover:bg-red-50"
                  onClick={() => { setDetailTransfer(null); setRejectTarget(detailTransfer); setRejectReason('') }}>
                  Reject
                </Button>
                <Button className="flex-1"
                  onClick={() => { setDetailTransfer(null); setApproveTarget(detailTransfer) }}>
                  Approve
                </Button>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Approve modal */}
      <Modal isOpen={!!approveTarget} onClose={() => setApproveTarget(null)} title="Approve Share Transfer" size="sm">
        {approveTarget && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Approve the transfer of share from <strong>{approveTarget.from_profile?.full_name}</strong> to{' '}
              <strong>{approveTarget.to_profile?.full_name}</strong>?
              Share ownership will be updated immediately.
            </p>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setApproveTarget(null)}>Cancel</Button>
              <Button
                className="flex-1"
                loading={approve.isPending}
                onClick={() => approve.mutate(approveTarget.id, {
                  onSuccess: () => setApproveTarget(null),
                  onError: (err: any) => alert(err.message ?? 'Failed to approve transfer'),
                })}
              >
                Approve
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Reject modal */}
      <Modal isOpen={!!rejectTarget} onClose={() => setRejectTarget(null)} title="Reject Share Transfer" size="sm">
        {rejectTarget && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Reject the transfer from <strong>{rejectTarget.from_profile?.full_name}</strong> to{' '}
              <strong>{rejectTarget.to_profile?.full_name}</strong>?
            </p>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Reason <span className="text-red-500">*</span></label>
              <textarea
                rows={3}
                value={rejectReason}
                onChange={e => setRejectReason(e.target.value)}
                placeholder="Provide a reason for rejection…"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              />
            </div>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setRejectTarget(null)}>Cancel</Button>
              <Button
                variant="danger"
                className="flex-1"
                loading={reject.isPending}
                disabled={!rejectReason.trim()}
                onClick={() =>
                  reject.mutate(
                    { transferId: rejectTarget.id, reason: rejectReason },
                    { onSuccess: () => setRejectTarget(null) }
                  )
                }
              >
                Reject
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
