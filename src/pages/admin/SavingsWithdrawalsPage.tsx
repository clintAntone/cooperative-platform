import { useState } from 'react'
import { Header } from '../../components/layout/Header'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import {
  useAllSavingsWithdrawalRequests,
  useApproveSavingsWithdrawal,
  useRejectSavingsWithdrawal,
} from '../../hooks/useSavings'
import { useCurrency } from '../../hooks/useCurrency'
import { formatDateTime } from '../../lib/utils'
import type { SavingsWithdrawalRequestWithMeta } from '../../hooks/useSavings'
import { PageGuide } from '../../components/shared/PageGuide'

const statusColors: Record<string, string> = {
  pending:  'bg-yellow-100 text-yellow-800',
  approved: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
}

const PAGE_SIZE = 25

export function SavingsWithdrawalsPage() {
  const { format: currency } = useCurrency()
  const [statusFilter, setStatusFilter] = useState('pending')
  const [page, setPage] = useState(0)
  const [search, setSearch] = useState('')
  const [rejectTarget, setRejectTarget] = useState<SavingsWithdrawalRequestWithMeta | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [approveTarget, setApproveTarget] = useState<SavingsWithdrawalRequestWithMeta | null>(null)
  const [detailReq, setDetailReq] = useState<SavingsWithdrawalRequestWithMeta | null>(null)

  const { data, isLoading } = useAllSavingsWithdrawalRequests({
    statusFilter,
    page,
    pageSize: PAGE_SIZE,
    search,
  })

  const approve = useApproveSavingsWithdrawal()
  const reject = useRejectSavingsWithdrawal()

  const rows = data?.rows ?? []
  const total = data?.total ?? 0
  const totalPages = Math.ceil(total / PAGE_SIZE)

  const statusTabs = ['pending', 'approved', 'rejected', 'all']

  return (
    <div>
      <Header
        title="Savings Withdrawals"
        subtitle="Review and approve member savings withdrawal requests"
      />

      <div className="p-4 sm:p-6 space-y-4">
        <PageGuide
          storageKey="savings-withdrawals"
          steps={[
            "Members request to withdraw from their savings account. The minimum balance (₱500) must remain after withdrawal.",
            "Check the member's current balance shown alongside the requested amount before approving.",
            'Approve to deduct the amount from their savings balance and record a ledger entry.',
            'Reject with a reason if the withdrawal cannot be processed (e.g. insufficient balance after minimum).',
          ]}
          note="The minimum balance check is also enforced server-side — approval will fail automatically if it would drop the balance below the minimum."
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
              {req.savings_accounts && (
                <p className="text-xs text-gray-500">Account balance: {currency(req.savings_accounts.balance)}</p>
              )}
              {req.reason && <p className="text-xs text-gray-600">{req.reason}</p>}
              {req.status === 'pending' && (
                <div className="flex gap-2 pt-1">
                  <Button size="sm" className="flex-1" onClick={() => setApproveTarget(req)}>Approve</Button>
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
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase">Requested</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase">Account Balance</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Reason</th>
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
                  <td className="px-4 py-3 text-right text-gray-600">
                    {req.savings_accounts ? currency(req.savings_accounts.balance) : '—'}
                    {req.savings_accounts && req.amount > req.savings_accounts.balance && (
                      <span className="ml-1 text-xs text-red-500">(insufficient)</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600 max-w-xs truncate">{req.reason ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize ${statusColors[req.status]}`}>
                      {req.status}
                    </span>
                    {req.status === 'rejected' && req.rejection_reason && (
                      <p className="text-xs text-red-500 mt-0.5 max-w-xs">{req.rejection_reason}</p>
                    )}
                  </td>
                  <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                    {req.status === 'pending' && (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setApproveTarget(req)}
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
      <Modal isOpen={!!detailReq} onClose={() => setDetailReq(null)} title="Withdrawal Request Details" size="lg">
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
              <div><dt className="text-xs text-gray-500">Requested Amount</dt><dd className="font-semibold text-gray-900 mt-0.5">{currency(detailReq.amount)}</dd></div>
              <div>
                <dt className="text-xs text-gray-500">Account Balance</dt>
                <dd className="font-medium mt-0.5">
                  {detailReq.savings_accounts ? (
                    <span className={detailReq.amount > detailReq.savings_accounts.balance ? 'text-red-600' : 'text-gray-900'}>
                      {currency(detailReq.savings_accounts.balance)}
                      {detailReq.amount > detailReq.savings_accounts.balance && ' (insufficient)'}
                    </span>
                  ) : '—'}
                </dd>
              </div>
              {detailReq.savings_accounts && (
                <div>
                  <dt className="text-xs text-gray-500">Balance After</dt>
                  <dd className={`font-medium mt-0.5 ${(detailReq.savings_accounts.balance - detailReq.amount) < 500 ? 'text-red-600' : 'text-gray-900'}`}>
                    {currency(detailReq.savings_accounts.balance - detailReq.amount)}
                  </dd>
                </div>
              )}
              {detailReq.reason && (
                <div className="col-span-2"><dt className="text-xs text-gray-500">Reason</dt><dd className="text-gray-800 mt-0.5">{detailReq.reason}</dd></div>
              )}
              {detailReq.status === 'rejected' && detailReq.rejection_reason && (
                <div className="col-span-2"><dt className="text-xs text-red-500">Rejection Reason</dt><dd className="text-red-700 mt-0.5">{detailReq.rejection_reason}</dd></div>
              )}
            </dl>
            {detailReq.status === 'pending' && (
              <div className="flex gap-3 pt-2 border-t border-gray-100">
                <Button variant="outline" className="flex-1 text-red-600 border-red-200 hover:bg-red-50"
                  onClick={() => { setDetailReq(null); setRejectTarget(detailReq); setRejectReason('') }}>
                  Reject
                </Button>
                <Button className="flex-1"
                  onClick={() => { setDetailReq(null); setApproveTarget(detailReq) }}>
                  Approve
                </Button>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Approve confirmation modal */}
      <Modal
        isOpen={!!approveTarget}
        onClose={() => setApproveTarget(null)}
        title="Approve Savings Withdrawal"
        size="sm"
      >
        {approveTarget && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Approve withdrawal of <strong>{currency(approveTarget.amount)}</strong> for{' '}
              <strong>{approveTarget.profiles?.full_name}</strong>?
            </p>
            {approveTarget.savings_accounts && approveTarget.amount > approveTarget.savings_accounts.balance && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
                Warning: The requested amount exceeds the account balance ({currency(approveTarget.savings_accounts.balance)}). This will be rejected by the system.
              </div>
            )}
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setApproveTarget(null)}>Cancel</Button>
              <Button
                className="flex-1"
                loading={approve.isPending}
                onClick={() =>
                  approve.mutate(approveTarget.id, {
                    onSuccess: () => setApproveTarget(null),
                    onError: (err: any) => alert(err.message ?? 'Failed to approve'),
                  })
                }
              >
                Approve
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Reject modal */}
      <Modal
        isOpen={!!rejectTarget}
        onClose={() => setRejectTarget(null)}
        title="Reject Savings Withdrawal"
        size="sm"
      >
        {rejectTarget && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Reject withdrawal of <strong>{currency(rejectTarget.amount)}</strong> from{' '}
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
    </div>
  )
}
