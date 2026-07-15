import { useState } from 'react'
import { Header } from '../../components/layout/Header'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { InlineReceiptViewer } from '../../components/shared/InlineReceiptViewer'
import {
  useAllSavingsDepositRequests,
  useApproveSavingsDeposit,
  useRejectSavingsDeposit,
  useLastInterestRelease,
  useReleaseSavingsInterest,
} from '../../hooks/useSavings'
import { useCurrency } from '../../hooks/useCurrency'
import { formatDateTime } from '../../lib/utils'
import type { SavingsDepositRequestWithMeta } from '../../hooks/useSavings'
import { PageGuide } from '../../components/shared/PageGuide'

const statusColors: Record<string, string> = {
  pending:  'bg-yellow-100 text-yellow-800',
  approved: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
}

const PAGE_SIZE = 25

export function SavingsDepositRequestsPage() {
  const { format: currency } = useCurrency()
  const [statusFilter, setStatusFilter] = useState('pending')
  const [page, setPage] = useState(0)
  const [search, setSearch] = useState('')
  const [rejectTarget, setRejectTarget] = useState<SavingsDepositRequestWithMeta | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [detailReq, setDetailReq] = useState<SavingsDepositRequestWithMeta | null>(null)
  const [confirmingApproveInDetail, setConfirmingApproveInDetail] = useState(false)
  const [showReleaseConfirm, setShowReleaseConfirm] = useState(false)

  const { data: lastRelease } = useLastInterestRelease()
  const releaseInterest = useReleaseSavingsInterest()

  const { data, isLoading } = useAllSavingsDepositRequests({
    statusFilter,
    page,
    pageSize: PAGE_SIZE,
    search,
  })

  const approve = useApproveSavingsDeposit()
  const reject = useRejectSavingsDeposit()

  const rows = data?.rows ?? []
  const total = data?.total ?? 0
  const totalPages = Math.ceil(total / PAGE_SIZE)

  const statusTabs = ['pending', 'approved', 'rejected', 'all']

  return (
    <div>
      <Header
        title="Savings Deposits"
        subtitle="Review and approve member savings deposit requests"
      />

      <div className="p-4 sm:p-6 space-y-4">
        <PageGuide
          storageKey="savings-deposits"
          steps={[
            'Members deposit into their savings account by submitting a request with a payment receipt.',
            "Verify the payment details, then Approve to credit the member's savings balance.",
            'Reject with a reason if the payment cannot be verified.',
            "Use the 'Release Interest Now' button every 6 months to credit ADB-based interest to all active savings accounts.",
          ]}
          note="Interest is calculated using Average Daily Balance — members who deposited earlier in the period earn more than last-minute depositors."
        />
        {/* Interest release card */}
        <Card className="bg-indigo-50 border-indigo-200">
          <div className="flex flex-col sm:flex-row sm:items-center gap-4 px-4 py-4">
            <div className="flex-1">
              <p className="text-sm font-semibold text-indigo-900">Savings Interest Release</p>
              {lastRelease ? (
                <p className="text-xs text-indigo-700 mt-0.5">
                  Last run: <strong>{new Date(lastRelease.period_end).toLocaleDateString()}</strong>
                  {' · '}credited <strong>{currency(lastRelease.total_interest)}</strong> to{' '}
                  <strong>{lastRelease.account_count}</strong> account{lastRelease.account_count !== 1 ? 's' : ''}
                  {' · '}{formatDateTime(lastRelease.released_at)}
                </p>
              ) : (
                <p className="text-xs text-indigo-700 mt-0.5">No interest has been released yet</p>
              )}
            </div>
            <Button
              size="sm"
              className="bg-indigo-600 hover:bg-indigo-700 text-white shrink-0"
              onClick={() => setShowReleaseConfirm(true)}
            >
              Release Interest Now
            </Button>
          </div>
        </Card>

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
            placeholder="Search by name or employee ID…"
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
            <p className="text-sm text-gray-400 text-center py-8">No requests found.</p>
          ) : rows.map(req => (
            <div key={req.id} className="bg-white rounded-xl border border-gray-200 px-4 py-3.5 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-gray-900">{req.profiles?.full_name ?? '—'}</p>
                  {req.profiles?.employee_id && (
                    <p className="text-xs text-gray-500">{req.profiles.employee_id}</p>
                  )}
                </div>
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize ${statusColors[req.status]}`}>
                  {req.status}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500">{formatDateTime(req.created_at)}</span>
                <span className="font-bold text-gray-900">{currency(req.amount)}</span>
              </div>
              <div className="text-xs text-gray-500 capitalize">{req.payment_method.replace('_', ' ')} {req.reference ? `· ${req.reference}` : ''}</div>
              {req.status === 'pending' && (
                <div className="flex gap-2 pt-1">
                  <Button size="sm" className="flex-1" onClick={() => { setDetailReq(req); setConfirmingApproveInDetail(true) }}>Approve</Button>
                  <Button size="sm" variant="outline" className="flex-1 text-red-600 border-red-200 hover:bg-red-50" onClick={() => { setRejectTarget(req); setRejectReason('') }}>Reject</Button>
                </div>
              )}
              {req.status === 'rejected' && req.rejection_reason && (
                <p className="text-xs text-red-500">Reason: {req.rejection_reason}</p>
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
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Member</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase">Amount</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Method</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Reference</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {isLoading ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-gray-400">Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-gray-400">No requests found.</td></tr>
              ) : rows.map(req => (
                <tr key={req.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => setDetailReq(req)}>
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{formatDateTime(req.created_at)}</td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{req.profiles?.full_name ?? '—'}</p>
                    {req.profiles?.employee_id && (
                      <p className="text-xs text-gray-500">{req.profiles.employee_id}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-gray-900">{currency(req.amount)}</td>
                  <td className="px-4 py-3 text-gray-600 capitalize">{req.payment_method.replace('_', ' ')}</td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-500">{req.reference ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize ${statusColors[req.status]}`}>
                      {req.status}
                    </span>
                    {req.status === 'rejected' && req.rejection_reason && (
                      <p className="text-xs text-red-500 mt-0.5 max-w-xs">{req.rejection_reason}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap" onClick={e => e.stopPropagation()}>
                    <div className="flex flex-col gap-1 items-start">
                      {req.status === 'pending' && (
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => { setDetailReq(req); setConfirmingApproveInDetail(true) }}
                            className="text-xs text-green-600 hover:text-green-800 font-medium"
                          >
                            Approve
                          </button>
                          <span className="text-gray-300">|</span>
                          <button
                            onClick={() => { setRejectTarget(req); setRejectReason('') }}
                            className="text-xs text-red-600 hover:text-red-800 font-medium"
                          >
                            Reject
                          </button>
                        </div>
                      )}
                    </div>
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
      <Modal isOpen={!!detailReq} onClose={() => { setDetailReq(null); setConfirmingApproveInDetail(false) }} title="Deposit Request Details" size="lg">
        {detailReq && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-base font-semibold text-gray-900">{detailReq.profiles?.full_name ?? '—'}</p>
                {detailReq.profiles?.employee_id && <p className="text-xs text-gray-500">{detailReq.profiles.employee_id}</p>}
              </div>
              <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold capitalize ${statusColors[detailReq.status]}`}>
                {detailReq.status}
              </span>
            </div>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm border-t border-gray-100 pt-4">
              <div><dt className="text-xs text-gray-500">Submitted</dt><dd className="font-medium text-gray-900 mt-0.5">{formatDateTime(detailReq.created_at)}</dd></div>
              <div><dt className="text-xs text-gray-500">Amount</dt><dd className="font-semibold text-gray-900 mt-0.5">{currency(detailReq.amount)}</dd></div>
              <div><dt className="text-xs text-gray-500">Payment Method</dt><dd className="font-medium text-gray-900 mt-0.5 capitalize">{detailReq.payment_method.replace('_', ' ')}</dd></div>
              <div><dt className="text-xs text-gray-500">Reference</dt><dd className="font-medium text-gray-900 mt-0.5 font-mono">{detailReq.reference ?? '—'}</dd></div>
              {detailReq.notes && <div className="col-span-2"><dt className="text-xs text-gray-500">Notes</dt><dd className="font-medium text-gray-900 mt-0.5">{detailReq.notes}</dd></div>}
              {detailReq.status === 'rejected' && detailReq.rejection_reason && (
                <div className="col-span-2"><dt className="text-xs text-red-500">Rejection Reason</dt><dd className="text-red-700 mt-0.5">{detailReq.rejection_reason}</dd></div>
              )}
            </dl>
            {detailReq.receipt_url && (
              <InlineReceiptViewer url={detailReq.receipt_url} />
            )}
            {detailReq.status === 'pending' && (
              <div className="pt-2 border-t border-gray-100 space-y-3">
                {confirmingApproveInDetail ? (
                  <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 space-y-3">
                    <p className="text-sm text-gray-800 font-medium">Confirm approval</p>
                    <p className="text-sm text-gray-600">
                      Approve <strong>{currency(detailReq.amount)}</strong> deposit from{' '}
                      <strong>{detailReq.profiles?.full_name}</strong>? This will credit their savings account.
                    </p>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" className="flex-1"
                        onClick={() => setConfirmingApproveInDetail(false)}
                        disabled={approve.isPending}>
                        Cancel
                      </Button>
                      <Button size="sm" className="flex-1"
                        loading={approve.isPending}
                        onClick={() => {
                          approve.mutate(detailReq.id, {
                            onSuccess: () => { setConfirmingApproveInDetail(false); setDetailReq(null) },
                            onError: (err: any) => alert(err.message ?? 'Failed to approve'),
                          })
                        }}>
                        Confirm Approve
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-3">
                    <Button variant="outline" className="flex-1 text-red-600 border-red-200 hover:bg-red-50"
                      onClick={() => { setDetailReq(null); setRejectTarget(detailReq); setRejectReason('') }}>
                      Reject
                    </Button>
                    <Button className="flex-1" onClick={() => setConfirmingApproveInDetail(true)}>
                      Approve
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </Modal>


      {/* Reject modal */}
      <Modal
        isOpen={!!rejectTarget}
        onClose={() => setRejectTarget(null)}
        title="Reject Savings Deposit"
        size="sm"
      >
        {rejectTarget && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Reject <strong>{currency(rejectTarget.amount)}</strong> deposit from{' '}
              <strong>{rejectTarget.profiles?.full_name}</strong>?
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
                    { requestId: rejectTarget.id, reason: rejectReason },
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

      {/* Interest release confirmation modal */}
      <Modal
        isOpen={showReleaseConfirm}
        onClose={() => setShowReleaseConfirm(false)}
        title="Release Savings Interest"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            This will credit interest to <strong>all active savings accounts</strong> using the
            Average Daily Balance method for the current period. This action cannot be undone.
          </p>
          {lastRelease && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-xs text-yellow-800">
              Last release was on <strong>{formatDateTime(lastRelease.released_at)}</strong>.
              Running again will calculate interest from that date to now.
            </div>
          )}
          <div className="flex gap-3">
            <Button variant="outline" className="flex-1" onClick={() => setShowReleaseConfirm(false)}>
              Cancel
            </Button>
            <Button
              className="flex-1 bg-indigo-600 hover:bg-indigo-700"
              loading={releaseInterest.isPending}
              onClick={() =>
                releaseInterest.mutate(undefined, {
                  onSuccess: () => setShowReleaseConfirm(false),
                  onError: (err: any) => alert(err.message ?? 'Failed to release interest'),
                })
              }
            >
              Release Interest
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
