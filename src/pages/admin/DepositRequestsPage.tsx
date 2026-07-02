import React, { useState, useEffect } from 'react'
import { Header } from '../../components/layout/Header'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { StatusBadge } from '../../components/shared/StatusBadge'
import { ReceiptModal } from '../../components/shared/ReceiptModal'
import { SkeletonPage } from '../../components/shared/Skeleton'
import { Pagination } from '../../components/shared/Pagination'
import {
  useAllDepositRequests,
  useApproveDepositRequest,
  useRejectDepositRequest,
  type DepositRequestWithMeta,
} from '../../hooks/useDepositRequests'
import { useCurrency } from '../../hooks/useCurrency'
import { formatDate } from '../../lib/utils'
import { cn } from '../../lib/utils'
import { exportToExcel } from '../../lib/exportExcel'

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

  const { format: currency } = useCurrency()
  const approveRequest = useApproveDepositRequest()
  const rejectRequest = useRejectDepositRequest()

  const [inlineRejectId, setInlineRejectId] = useState<string | null>(null)
  const [inlineReason, setInlineReason] = useState('')
  const [receiptModal, setReceiptModal] = useState<{ url: string; details: any } | null>(null)
  const [confirmApproveId, setConfirmApproveId] = useState<string | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => { setPage(0) }, [activeTab, dateFrom, dateTo, sortKey, sortDir, debouncedSearch])

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
  const dateFiltered = paged // kept for export reference

  const handleApprove = (requestId: string) => {
    approveRequest.mutate(requestId)
  }

  const handleInlineReject = (req: DepositRequestWithMeta) => {
    if (!inlineReason.trim()) return
    rejectRequest.mutate(
      { requestId: req.id, reason: inlineReason },
      {
        onSuccess: () => {
          setInlineRejectId(null)
          setInlineReason('')
        },
      }
    )
  }

  if (isLoading) return <SkeletonPage cards={0} rows={8} />

  const hasDateFilter = !!(dateFrom || dateTo)

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

        {/* Requests table */}
        <Card className="overflow-hidden">
          {/* Mobile cards */}
          <div className="sm:hidden divide-y divide-gray-100">
            {paged.length === 0 && <p className="text-center py-10 text-gray-400 text-sm">No deposit requests found</p>}
            {paged.map(req => (
              <div key={req.id} className="p-4 space-y-3">
                {/* Header row */}
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium text-sm text-gray-900">{req.profiles?.full_name ?? '—'}</p>
                    {req.profiles?.employee_id && (
                      <p className="font-mono text-xs text-gray-400 mt-0.5">{req.profiles.employee_id}</p>
                    )}
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
                    <Button size="sm" variant="danger" onClick={() => { setInlineRejectId(inlineRejectId === req.id ? null : req.id); setInlineReason('') }}>
                      Reject
                    </Button>
                  </div>
                )}
                {inlineRejectId === req.id && (
                  <div className="space-y-2 pt-1">
                    <input
                      type="text"
                      placeholder="Enter rejection reason..."
                      value={inlineReason}
                      onChange={e => setInlineReason(e.target.value)}
                      className="w-full border border-red-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                      autoFocus
                    />
                    <div className="flex gap-2">
                      <Button size="sm" variant="danger" loading={rejectRequest.isPending} disabled={!inlineReason.trim()} onClick={() => handleInlineReject(req)}>
                        Confirm
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => { setInlineRejectId(null); setInlineReason('') }}>
                        Cancel
                      </Button>
                    </div>
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
                    <td colSpan={10} className="text-center py-10 text-gray-400">
                      No deposit requests found
                    </td>
                  </tr>
                )}
                {paged.map(req => (
                  <React.Fragment key={req.id}>
                    <tr className="hover:bg-gray-50">
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
                      <td className="px-4 py-3 text-gray-500">
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
                      <td className="px-4 py-3">
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
                      <td className="px-4 py-3">
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
                              onClick={() => {
                                setInlineRejectId(inlineRejectId === req.id ? null : req.id)
                                setInlineReason('')
                              }}
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
                    {inlineRejectId === req.id && (
                      <tr key={`${req.id}-reject`} className="bg-red-50">
                        <td colSpan={10} className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <input
                              type="text"
                              placeholder="Enter rejection reason..."
                              value={inlineReason}
                              onChange={e => setInlineReason(e.target.value)}
                              className="flex-1 border border-red-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                              autoFocus
                            />
                            <Button
                              size="sm"
                              variant="danger"
                              loading={rejectRequest.isPending}
                              disabled={!inlineReason.trim()}
                              onClick={() => handleInlineReject(req)}
                            >
                              Confirm Reject
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setInlineRejectId(null)
                                setInlineReason('')
                              }}
                            >
                              Cancel
                            </Button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>{/* end overflow-x-auto */}
          </div>{/* end hidden sm:block */}
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={totalRequests}
            onChange={setPage}
          />
        </Card>
      </div>

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
    </div>
  )
}
