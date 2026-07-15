import { useState, useEffect } from 'react'
import { Header } from '../../components/layout/Header'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { StatusBadge } from '../../components/shared/StatusBadge'
import { ReceiptModal } from '../../components/shared/ReceiptModal'
import { RejectModal } from '../../components/shared/RejectModal'
import { InlineReceiptViewer } from '../../components/shared/InlineReceiptViewer'
import { SkeletonPage } from '../../components/shared/Skeleton'
import { Pagination } from '../../components/shared/Pagination'
import {
  useAllDepositRequests,
  useApproveDepositRequest,
  useRejectDepositRequest,
  useBulkApproveDepositRequests,
  useBulkRejectDepositRequests,
  type DepositRequestWithMeta,
} from '../../hooks/useDepositRequests'
import { useCurrency } from '../../hooks/useCurrency'
import { formatDate } from '../../lib/utils'
import { cn } from '../../lib/utils'
import { exportToExcel } from '../../lib/exportExcel'
import { PageGuide } from '../../components/shared/PageGuide'

type TabValue = 'all' | 'pending' | 'approved' | 'rejected'

const PAGE_SIZE = 25

function SortIcon({ active, dir }: { active: boolean; dir: 'asc' | 'desc' }) {
  return (
    <span className={`ml-1 inline-block ${active ? 'text-blue-600' : 'text-gray-300'}`}>
      {dir === 'asc' && active ? '↑' : '↓'}
    </span>
  )
}

const tabs: { label: string; value: TabValue }[] = [
  { label: 'All', value: 'all' },
  { label: 'Pending', value: 'pending' },
  { label: 'Approved', value: 'approved' },
  { label: 'Rejected', value: 'rejected' },
]

export function DepositRequestsPage() {
  const [activeTab, setActiveTab] = useState<TabValue>('pending')
  const [sortKey, setSortKey] = useState<'amount' | 'created_at'>('created_at')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const handleSort = (key: 'amount' | 'created_at') => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [page, setPage] = useState(0)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')

  // Bulk selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [showBulkRejectModal, setShowBulkRejectModal] = useState(false)

  const { format: currency } = useCurrency()
  const approveRequest = useApproveDepositRequest()
  const rejectRequest = useRejectDepositRequest()
  const bulkApprove = useBulkApproveDepositRequests()
  const bulkReject = useBulkRejectDepositRequests()

  const [rejectTarget, setRejectTarget] = useState<DepositRequestWithMeta | null>(null)
  const [receiptModal, setReceiptModal] = useState<{ url: string; details: any } | null>(null)
  const [confirmApproveId, setConfirmApproveId] = useState<string | null>(null)
  const [detailReq, setDetailReq] = useState<DepositRequestWithMeta | null>(null)
  const [confirmingApproveInDetail, setConfirmingApproveInDetail] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => {
    setPage(0)
    setSelectedIds(new Set())
  }, [activeTab, dateFrom, dateTo, sortKey, sortDir, debouncedSearch])

  const { data: requestsPage, isLoading } = useAllDepositRequests({
    statusFilter: activeTab,
    page,
    pageSize: PAGE_SIZE,
    search: debouncedSearch,
    sortKey,
    sortDir,
    dateFrom,
    dateTo,
  })

  const paged = requestsPage?.rows ?? []
  const totalRequests = requestsPage?.total ?? 0
  const dateFiltered = paged

  const pendingOnPage = paged.filter(r => r.status === 'pending')
  const allPendingSelected = pendingOnPage.length > 0 && pendingOnPage.every(r => selectedIds.has(r.id))

  const toggleSelectAll = () => {
    if (allPendingSelected) {
      setSelectedIds(prev => {
        const next = new Set(prev)
        pendingOnPage.forEach(r => next.delete(r.id))
        return next
      })
    } else {
      setSelectedIds(prev => {
        const next = new Set(prev)
        pendingOnPage.forEach(r => next.add(r.id))
        return next
      })
    }
  }

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const handleApprove = (requestId: string) => {
    approveRequest.mutate(requestId)
  }

  const handleReject = (reason: string) => {
    if (!rejectTarget) return
    rejectRequest.mutate(
      { requestId: rejectTarget.id, reason },
      { onSuccess: () => setRejectTarget(null) }
    )
  }

  const handleBulkApprove = () => {
    bulkApprove.mutate([...selectedIds], {
      onSuccess: () => setSelectedIds(new Set()),
    })
  }

  const handleBulkReject = (reason: string) => {
    bulkReject.mutate(
      { requestIds: [...selectedIds], reason },
      {
        onSuccess: () => {
          setSelectedIds(new Set())
          setShowBulkRejectModal(false)
        },
      }
    )
  }

  if (isLoading) return <SkeletonPage cards={0} rows={8} />

  const hasDateFilter = !!(dateFrom || dateTo)
  const showCheckboxes = activeTab === 'pending' || activeTab === 'all'

  return (
    <div>
      <Header
        title="Deposit Requests"
        subtitle="Review and approve member deposit requests"
        actions={
          <button
            onClick={() => {
              const rows = dateFiltered.map(r => ({
                Member: r.profiles?.full_name ?? '',
                'Employee ID': r.profiles?.employee_id ?? '',
                'Share #': r.equity_shares?.share_number ?? '',
                Amount: r.amount,
                Method: r.payment_method ?? '',
                Reference: r.reference ?? '',
                Status: r.status,
                'Submitted On': formatDate(r.created_at),
              }))
              exportToExcel(rows, `deposit-requests-${activeTab}`)
            }}
            title="Export to Excel"
            className="inline-flex items-center gap-1.5 border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" />
            </svg>
            <span className="hidden sm:inline">Export</span>
          </button>
        }
      />

      <div className="p-4 sm:p-6 space-y-4">
        <PageGuide
          storageKey="deposit-requests"
          steps={[
            'Members submit a deposit request when they pay their equity share installment (cash, bank transfer, or mobile money).',
            "Review the payment reference and receipt, then click Approve to record the contribution and credit the member's share.",
            'Click Reject to decline the request with a required reason — the member will see this reason.',
            "Approved deposits automatically update the member's share balance and create a ledger entry.",
          ]}
          note="If a share reaches its target amount after approval, it is automatically marked as 'completed' and a savings account is opened for the member."
        />
        {/* Filter tabs */}
        <div className="overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0">
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-max min-w-full sm:w-fit">
            {tabs.map(tab => (
              <button
                key={tab.value}
                onClick={() => setActiveTab(tab.value)}
                className={cn(
                  'px-3 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap',
                  activeTab === tab.value
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Search + date range filter */}
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <input
              type="text"
              placeholder="Search by member name…"
              value={search}
              onChange={e => setSearch(e.target.value)}
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
        </div>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
            className="flex-1 border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <span className="text-gray-400 text-sm flex-shrink-0">–</span>
          <input
            type="date"
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
            className="flex-1 border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {hasDateFilter && (
            <button
              onClick={() => { setDateFrom(''); setDateTo('') }}
              className="flex-shrink-0 text-xs text-gray-500 hover:text-gray-700 border border-gray-300 rounded-lg px-2 py-1.5 hover:bg-gray-50 transition-colors"
            >
              Clear
            </button>
          )}
        </div>

        {/* Bulk action bar */}
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-lg px-4 py-2.5">
            <span className="text-sm font-medium text-blue-800">{selectedIds.size} selected</span>
            <div className="flex gap-2 ml-auto">
              <Button
                size="sm"
                variant="primary"
                loading={bulkApprove.isPending}
                onClick={handleBulkApprove}
              >
                Approve Selected
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={() => setShowBulkRejectModal(true)}
              >
                Reject Selected
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setSelectedIds(new Set())}
              >
                Clear
              </Button>
            </div>
          </div>
        )}

        {/* Requests table */}
        <Card className="overflow-hidden">
          {/* Mobile cards */}
          <div className="sm:hidden divide-y divide-gray-100">
            {paged.length === 0 && <p className="text-center py-10 text-gray-400 text-sm">No deposit requests found</p>}
            {paged.map(req => (
              <div key={req.id} className="p-4 space-y-3">
                {/* Header row */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2">
                    {showCheckboxes && req.status === 'pending' && (
                      <input
                        type="checkbox"
                        checked={selectedIds.has(req.id)}
                        onChange={() => toggleSelect(req.id)}
                        className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        onClick={e => e.stopPropagation()}
                      />
                    )}
                    <div>
                      <p className="font-medium text-sm text-gray-900">{req.profiles?.full_name ?? '—'}</p>
                      {req.profiles?.employee_id && (
                        <p className="font-mono text-xs text-gray-400 mt-0.5">{req.profiles.employee_id}</p>
                      )}
                    </div>
                  </div>
                  <StatusBadge status={req.status} />
                </div>

                {/* Amount + method + date */}
                <div className="flex items-baseline justify-between">
                  <span className="text-xl font-bold text-gray-900">{currency(req.amount)}</span>
                  <span className="text-xs text-gray-400">{formatDate(req.created_at)}</span>
                </div>
                <div className="flex items-center gap-3 text-xs text-gray-500">
                  <span className="capitalize">{req.payment_method.replace('_', ' ')}</span>
                  {req.reference && (
                    <span className="font-mono text-gray-600">Ref: {req.reference}</span>
                  )}
                  {req.receipt_url && (
                    <button
                      onClick={() => setReceiptModal({ url: req.receipt_url!, details: { amount: currency(req.amount), date: req.created_at, method: req.payment_method, reference: req.reference, notes: req.notes } })}
                      className="text-blue-600 hover:text-blue-800 font-medium"
                    >
                      View Receipt
                    </button>
                  )}
                </div>

                {/* Rejection reason */}
                {req.status === 'rejected' && req.rejection_reason && (
                  <p className="text-xs text-red-600 bg-red-50 rounded px-2 py-1">{req.rejection_reason}</p>
                )}

                {/* Actions */}
                {req.status === 'pending' && (
                  <div className="flex gap-2 pt-1">
                    <Button size="sm" variant="primary" loading={approveRequest.isPending} onClick={() => setConfirmApproveId(req.id)}>
                      Approve
                    </Button>
                    <Button size="sm" variant="danger" onClick={() => setRejectTarget(req)}>
                      Reject
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
          {/* Desktop table */}
          <div className="hidden sm:block">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  {showCheckboxes && (
                    <th className="px-4 py-3 w-10">
                      <input
                        type="checkbox"
                        checked={allPendingSelected}
                        onChange={toggleSelectAll}
                        disabled={pendingOnPage.length === 0}
                        className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                    </th>
                  )}
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Member</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Employee ID</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Share #</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600 cursor-pointer select-none hover:text-gray-900"
                      onClick={() => handleSort('amount')}>
                    Amount <SortIcon active={sortKey === 'amount'} dir={sortDir} />
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Method</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Reference</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Receipt</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600 cursor-pointer select-none hover:text-gray-900"
                      onClick={() => handleSort('created_at')}>
                    Submitted <SortIcon active={sortKey === 'created_at'} dir={sortDir} />
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {paged.length === 0 && (
                  <tr>
                    <td colSpan={showCheckboxes ? 11 : 10} className="text-center py-10 text-gray-400">
                      No deposit requests found
                    </td>
                  </tr>
                )}
                {paged.map(req => (
                  <tr key={req.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => setDetailReq(req)}>
                      {showCheckboxes && (
                        <td className="px-4 py-3 w-10" onClick={e => e.stopPropagation()}>
                          {req.status === 'pending' && (
                            <input
                              type="checkbox"
                              checked={selectedIds.has(req.id)}
                              onChange={() => toggleSelect(req.id)}
                              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                            />
                          )}
                        </td>
                      )}
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900">{req.profiles?.full_name ?? '—'}</p>
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {req.profiles?.employee_id ?? <span className="text-gray-400">—</span>}
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {req.equity_shares ? `#${req.equity_shares.share_number}` : '—'}
                      </td>
                      <td className="px-4 py-3 font-medium text-gray-900">{currency(req.amount)}</td>
                      <td className="px-4 py-3 text-gray-600 capitalize">
                        {req.payment_method.replace('_', ' ')}
                      </td>
                      <td className="px-4 py-3 text-gray-500" onClick={e => e.stopPropagation()}>
                        {req.reference ? (
                          <span className="inline-flex items-center gap-1.5">
                            <span className="font-mono text-xs">{req.reference}</span>
                            <button
                              onClick={() => navigator.clipboard.writeText(req.reference!)}
                              title="Copy reference"
                              className="text-gray-400 hover:text-gray-600"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                  d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                              </svg>
                            </button>
                          </span>
                        ) : <span className="text-gray-400">—</span>}
                      </td>
                      <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                        {req.receipt_url ? (
                          <button
                            onClick={() =>
                              setReceiptModal({
                                url: req.receipt_url!,
                                details: {
                                  amount: currency(req.amount),
                                  date: req.created_at,
                                  method: req.payment_method,
                                  reference: req.reference,
                                  notes: req.notes,
                                },
                              })
                            }
                            className="text-blue-600 hover:text-blue-800 font-medium text-xs"
                          >
                            View Receipt
                          </button>
                        ) : (
                          <span className="text-gray-400 text-xs">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">
                        {formatDate(req.created_at)}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={req.status} />
                      </td>
                      <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                        {req.status === 'pending' && (
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="primary"
                              loading={approveRequest.isPending}
                              onClick={() => setConfirmApproveId(req.id)}
                            >
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="danger"
                              onClick={() => setRejectTarget(req)}
                            >
                              Reject
                            </Button>
                          </div>
                        )}
                        {req.status === 'rejected' && req.rejection_reason && (
                          <span className="text-xs text-red-600 max-w-[160px] block truncate" title={req.rejection_reason}>
                            {req.rejection_reason}
                          </span>
                        )}
                      </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </div>
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={totalRequests}
            onChange={setPage}
          />
        </Card>
      </div>

      {/* Detail modal */}
      <Modal isOpen={!!detailReq} onClose={() => { setDetailReq(null); setConfirmingApproveInDetail(false) }} title="Deposit Request Details" size="lg">
        {detailReq && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-xs text-gray-500">{formatDate(detailReq.created_at)}</p>
              <StatusBadge status={detailReq.status} />
            </div>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm border-t border-gray-100 pt-4">
              <div>
                <dt className="text-xs text-gray-500">Member</dt>
                <dd className="font-semibold text-gray-900 mt-0.5">{detailReq.profiles?.full_name ?? '—'}</dd>
                {detailReq.profiles?.employee_id && <dd className="text-xs text-gray-500">{detailReq.profiles.employee_id}</dd>}
              </div>
              <div>
                <dt className="text-xs text-gray-500">Share #</dt>
                <dd className="font-semibold text-gray-900 mt-0.5">
                  {detailReq.equity_shares ? `#${detailReq.equity_shares.share_number}` : '—'}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500">Amount</dt>
                <dd className="font-semibold text-gray-900 mt-0.5">{currency(detailReq.amount)}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500">Payment Method</dt>
                <dd className="text-gray-800 mt-0.5 capitalize">{detailReq.payment_method.replace('_', ' ')}</dd>
              </div>
              {detailReq.reference && (
                <div>
                  <dt className="text-xs text-gray-500">Reference</dt>
                  <dd className="font-mono text-xs text-gray-800 mt-0.5">{detailReq.reference}</dd>
                </div>
              )}
              {detailReq.notes && (
                <div className="col-span-2">
                  <dt className="text-xs text-gray-500">Notes</dt>
                  <dd className="text-gray-800 mt-0.5">{detailReq.notes}</dd>
                </div>
              )}
              {detailReq.receipt_url && (
                <div className="col-span-2">
                  <dt className="text-xs text-gray-500 mb-1">Receipt</dt>
                  <dd>
                    <InlineReceiptViewer url={detailReq.receipt_url} />
                  </dd>
                </div>
              )}
              {detailReq.status === 'rejected' && detailReq.rejection_reason && (
                <div className="col-span-2">
                  <dt className="text-xs text-red-500">Rejection Reason</dt>
                  <dd className="text-red-700 mt-0.5">{detailReq.rejection_reason}</dd>
                </div>
              )}
            </dl>
            {detailReq.status === 'pending' && (
              <div className="pt-2 border-t border-gray-100 space-y-3">
                {confirmingApproveInDetail ? (
                  /* Inline confirmation */
                  <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 space-y-3">
                    <p className="text-sm text-gray-800 font-medium">Confirm approval</p>
                    <p className="text-sm text-gray-600">
                      Approve the deposit of <strong>{currency(detailReq.amount)}</strong> from{' '}
                      <strong>{detailReq.profiles?.full_name}</strong>? This will update the member's share balance.
                    </p>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1"
                        onClick={() => setConfirmingApproveInDetail(false)}
                        disabled={approveRequest.isPending}
                      >
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        className="flex-1"
                        loading={approveRequest.isPending}
                        onClick={() => {
                          handleApprove(detailReq.id)
                          setConfirmingApproveInDetail(false)
                          setDetailReq(null)
                        }}
                      >
                        Confirm Approve
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-3">
                    <Button variant="outline" className="flex-1 text-red-600 border-red-200 hover:bg-red-50"
                      onClick={() => { const t = detailReq; setDetailReq(null); setRejectTarget(t) }}>
                      Reject
                    </Button>
                    <Button variant="primary" className="flex-1"
                      onClick={() => setConfirmingApproveInDetail(true)}>
                      Approve
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </Modal>

      {receiptModal && (
        <ReceiptModal
          isOpen={!!receiptModal}
          onClose={() => setReceiptModal(null)}
          receiptUrl={receiptModal.url}
          details={receiptModal.details}
        />
      )}

      <Modal
        isOpen={!!confirmApproveId}
        onClose={() => setConfirmApproveId(null)}
        title="Confirm Approval"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Are you sure you want to approve this deposit? This will update the member's share balance.
          </p>
          <div className="flex gap-3 pt-1">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setConfirmApproveId(null)}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              className="flex-1"
              loading={approveRequest.isPending}
              onClick={() => {
                handleApprove(confirmApproveId!)
                setConfirmApproveId(null)
              }}
            >
              Confirm Approve
            </Button>
          </div>
        </div>
      </Modal>

      {/* Single reject modal */}
      <RejectModal
        isOpen={!!rejectTarget}
        onClose={() => setRejectTarget(null)}
        title="Reject Deposit Request"
        description={rejectTarget ? <>Reject deposit of <strong>{currency(rejectTarget.amount)}</strong> from <strong>{rejectTarget.profiles?.full_name}</strong>?</> : undefined}
        isLoading={rejectRequest.isPending}
        onConfirm={handleReject}
      />

      {/* Bulk reject modal */}
      <RejectModal
        isOpen={showBulkRejectModal}
        onClose={() => setShowBulkRejectModal(false)}
        title={`Reject ${selectedIds.size} Deposit${selectedIds.size > 1 ? 's' : ''}`}
        description="This rejection reason will apply to all selected deposits."
        isLoading={bulkReject.isPending}
        onConfirm={handleBulkReject}
      />
    </div>
  )
}
