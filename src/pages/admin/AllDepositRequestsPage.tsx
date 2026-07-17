import { useState, useMemo, useRef, useEffect } from 'react'
import { Header } from '../../components/layout/Header'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { StatusBadge } from '../../components/shared/StatusBadge'
import { InlineReceiptViewer } from '../../components/shared/InlineReceiptViewer'
import { SkeletonPage } from '../../components/shared/Skeleton'
import { Pagination } from '../../components/shared/Pagination'
import {
  useAllDepositRequests,
  useApproveDepositRequest,
  useRejectDepositRequest,
  type DepositRequestWithMeta,
} from '../../hooks/useDepositRequests'
import {
  useAllSavingsDepositRequests,
  useApproveSavingsDeposit,
  useRejectSavingsDeposit,
  type SavingsDepositRequestWithMeta,
} from '../../hooks/useSavings'
import {
  useAllBatchDepositsForUnified,
  useApproveBatchDeposit,
  useRejectBatchDeposit,
  type BatchDepositWithMembers,
} from '../../hooks/useBatchDeposits'
import { BatchDepositModal } from '../../components/shared/BatchDepositModal'
import { useCurrency } from '../../hooks/useCurrency'
import { formatDate } from '../../lib/utils'
import { cn } from '../../lib/utils'
import { exportToExcel } from '../../lib/exportExcel'
import { PageGuide } from '../../components/shared/PageGuide'

// ─── Unified row type ─────────────────────────────────────────────────────────

type SharesRow = DepositRequestWithMeta & { _type: 'shares' }
type SavingsRow = SavingsDepositRequestWithMeta & { _type: 'savings' }
type BatchRow = BatchDepositWithMembers & { _type: 'batch' }
type UnifiedRow = SharesRow | SavingsRow | BatchRow

function isShares(row: UnifiedRow): row is SharesRow {
  return row._type === 'shares'
}
function isBatch(row: UnifiedRow): row is BatchRow {
  return row._type === 'batch'
}

// ─── Constants ────────────────────────────────────────────────────────────────

type StatusTab = 'all' | 'pending' | 'approved' | 'rejected'
type TypeFilter = 'all' | 'shares' | 'savings' | 'batch'

const statusTabs: { label: string; value: StatusTab }[] = [
  { label: 'All', value: 'all' },
  { label: 'Pending', value: 'pending' },
  { label: 'Approved', value: 'approved' },
  { label: 'Rejected', value: 'rejected' },
]

const PAGE_SIZE = 50

// ─── Type badge ───────────────────────────────────────────────────────────────

function TypeBadge({ type }: { type: 'shares' | 'savings' | 'batch' }) {
  if (type === 'shares') return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">Shares</span>
  )
  if (type === 'savings') return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800">Savings</span>
  )
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-800">Batch</span>
  )
}

// ─── Type dropdown ────────────────────────────────────────────────────────────

function TypeDropdown({ value, onChange }: { value: TypeFilter; onChange: (v: TypeFilter) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const labels: Record<TypeFilter, string> = { all: 'All Types', shares: 'Shares', savings: 'Savings', batch: 'Batch' }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-1.5 border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700 bg-white hover:bg-gray-50 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        <span className="text-gray-600">{labels[value]}</span>
        <svg className={cn('w-4 h-4 text-gray-400 transition-transform', open && 'rotate-180')} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-10 min-w-[130px] bg-white border border-gray-200 rounded-lg shadow-lg py-1">
          {(['all', 'shares', 'savings', 'batch'] as TypeFilter[]).map(opt => (
            <button
              key={opt}
              onClick={() => { onChange(opt); setOpen(false) }}
              className={cn(
                'w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:bg-gray-50 transition-colors',
                value === opt && 'bg-blue-50 text-blue-700'
              )}
            >
              <span className="text-gray-700">{labels[opt]}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function AllDepositRequestsPage() {
  const { format: currency } = useCurrency()

  // Filters
  const [statusFilter, setStatusFilter] = useState<StatusTab>('all')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [showBatchModal, setShowBatchModal] = useState(false)

  // Detail / approval state
  const [detailReq, setDetailReq] = useState<UnifiedRow | null>(null)
  const [confirmingApproveInDetail, setConfirmingApproveInDetail] = useState(false)
  const [rejectTarget, setRejectTarget] = useState<UnifiedRow | null>(null)
  const [rejectReason, setRejectReason] = useState('')

  // Mutations
  const approveShares = useApproveDepositRequest()
  const rejectShares = useRejectDepositRequest()
  const approveSavings = useApproveSavingsDeposit()
  const rejectSavings = useRejectSavingsDeposit()
  const approveBatch = useApproveBatchDeposit()
  const rejectBatch = useRejectBatchDeposit()

  // Fetch all three datasets
  const { data: sharesPage, isLoading: sharesLoading } = useAllDepositRequests({
    statusFilter,
    page: 0,
    pageSize: PAGE_SIZE,
    search,
  })
  const { data: savingsPage, isLoading: savingsLoading } = useAllSavingsDepositRequests({
    statusFilter,
    page: 0,
    pageSize: PAGE_SIZE,
    search,
  })
  const { data: batchRows, isLoading: batchLoading } = useAllBatchDepositsForUnified({
    statusFilter,
    search,
  })

  const isLoading = sharesLoading || savingsLoading || batchLoading

  // Merge + sort + filter by type
  const combined: UnifiedRow[] = useMemo(() => {
    const shares = (sharesPage?.rows ?? []).map(r => ({ ...r, _type: 'shares' as const }))
    const savings = (savingsPage?.rows ?? []).map(r => ({ ...r, _type: 'savings' as const }))
    const batches = (batchRows ?? []).map(r => ({ ...r, _type: 'batch' as const }))
    const merged = [...shares, ...savings, ...batches].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )
    if (typeFilter === 'all') return merged
    return merged.filter(r => r._type === typeFilter)
  }, [sharesPage, savingsPage, batchRows, typeFilter])

  const totalRows = combined.length
  const pageStart = page * 25
  const paged = combined.slice(pageStart, pageStart + 25)

  const handleStatusChange = (v: StatusTab) => { setStatusFilter(v); setPage(0) }
  const handleTypeChange = (v: TypeFilter) => { setTypeFilter(v); setPage(0) }
  const handleSearchChange = (v: string) => { setSearch(v); setPage(0) }

  const openDetail = (req: UnifiedRow) => { setDetailReq(req); setConfirmingApproveInDetail(false) }

  // Approve
  const handleApprove = (row: UnifiedRow) => {
    const onSuccess = () => { setDetailReq(null); setConfirmingApproveInDetail(false) }
    if (isShares(row)) {
      approveShares.mutate(row.id, { onSuccess })
    } else if (isBatch(row)) {
      approveBatch.mutate(row.id, { onSuccess })
    } else {
      approveSavings.mutate(row.id, { onSuccess })
    }
  }

  // Reject
  const handleReject = () => {
    if (!rejectTarget || !rejectReason.trim()) return
    const onSuccess = () => { setRejectTarget(null); setRejectReason('') }
    if (isShares(rejectTarget)) {
      rejectShares.mutate({ requestId: rejectTarget.id, reason: rejectReason }, { onSuccess })
    } else if (isBatch(rejectTarget)) {
      rejectBatch.mutate({ batchId: rejectTarget.id, reason: rejectReason }, { onSuccess })
    } else {
      rejectSavings.mutate({ requestId: rejectTarget.id, reason: rejectReason }, { onSuccess })
    }
  }

  const approveIsPending = approveShares.isPending || approveSavings.isPending || approveBatch.isPending
  const rejectIsPending = rejectShares.isPending || rejectSavings.isPending || rejectBatch.isPending

  if (isLoading) return <SkeletonPage cards={0} rows={8} />

  return (
    <div>
      <Header
        title="Deposit Requests"
        subtitle="Review and approve member equity and savings deposit requests"
        actions={
          <div className="flex items-center gap-2">
          <button
            onClick={() => setShowBatchModal(true)}
            className="inline-flex items-center gap-1.5 border border-blue-300 rounded-lg px-2.5 py-1.5 text-sm text-blue-700 bg-blue-50 hover:bg-blue-100 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            <span className="hidden sm:inline">New Batch</span>
          </button>
          <button
            onClick={() => {
              const rows = combined.map(r => ({
                Type: r._type === 'shares' ? 'Shares' : r._type === 'batch' ? 'Batch' : 'Savings',
                Reference: r.reference ?? '',
                Amount: isBatch(r) ? r.total_amount : r.amount,
                Method: r.payment_method ?? '',
                'Member/s': isBatch(r) ? r.member_names.join(', ') : (r as any).profiles?.full_name ?? '',
                Status: r.status,
                'Submitted On': formatDate(r.created_at),
              }))
              exportToExcel(rows, `deposit-requests-${statusFilter}`)
            }}
            title="Export to Excel"
            className="inline-flex items-center gap-1.5 border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" />
            </svg>
            <span className="hidden sm:inline">Export</span>
          </button>
          </div>
        }
      />
      <BatchDepositModal isOpen={showBatchModal} onClose={() => setShowBatchModal(false)} />

      <div className="p-4 sm:p-6 space-y-4">
        <PageGuide
          storageKey="all-deposit-requests"
          steps={[
            'Members submit deposit requests when they pay their equity share installment or add savings — cash, bank transfer, or mobile money.',
            'The Type column shows whether the request is for a Share payment or Savings deposit.',
            'Click any row to open the details and Approve or Reject the request.',
            'Approved deposits automatically update the member\'s share or savings balance and create a ledger entry.',
          ]}
          note="Use the Type dropdown to filter by Shares or Savings requests."
        />

        {/* Status tabs + Type dropdown + Search */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          {/* Status tabs */}
          <div className="overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0">
            <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-max min-w-full sm:w-fit">
              {statusTabs.map(tab => (
                <button
                  key={tab.value}
                  onClick={() => handleStatusChange(tab.value)}
                  className={cn(
                    'px-3 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap',
                    statusFilter === tab.value
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-500 hover:text-gray-700'
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* Type dropdown */}
          <TypeDropdown value={typeFilter} onChange={handleTypeChange} />

          {/* Search */}
          <div className="relative flex-1 max-w-xs">
            <input
              type="text"
              placeholder="Search by member name…"
              value={search}
              onChange={e => handleSearchChange(e.target.value)}
              className="w-full border border-gray-300 rounded-lg pl-3 pr-8 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {search && (
              <button
                onClick={() => handleSearchChange('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Table */}
        <Card className="overflow-hidden">
          {/* Mobile cards */}
          <div className="sm:hidden divide-y divide-gray-100">
            {paged.length === 0 && (
              <p className="text-center py-10 text-gray-400 text-sm">No deposit requests found</p>
            )}
            {paged.map(req => (
              <button
                key={`${req._type}-${req.id}`}
                className="w-full text-left p-4 space-y-2.5 hover:bg-gray-50 transition-colors"
                onClick={() => openDetail(req)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <TypeBadge type={req._type} />
                    <p className="font-medium text-sm text-gray-900">
                      {isBatch(req) ? req.member_names.slice(0, 2).join(', ') + (req.member_names.length > 2 ? ` +${req.member_names.length - 2}` : '') : (req as SharesRow | SavingsRow).profiles?.full_name ?? '—'}
                    </p>
                  </div>
                  <StatusBadge status={req.status} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-lg font-bold text-gray-900">{currency(isBatch(req) ? req.total_amount : req.amount)}</span>
                  <span className="text-xs text-gray-400">{formatDate(req.created_at)}</span>
                </div>
                <div className="flex items-center gap-3 text-xs text-gray-500">
                  <span className="capitalize">{req.payment_method.replace('_', ' ')}</span>
                  {req.reference && <span className="text-sm font-semibold text-gray-700 tracking-wide">{req.reference}</span>}
                </div>
                {req.status === 'rejected' && req.rejection_reason && (
                  <p className="text-xs text-red-600 bg-red-50 rounded px-2 py-1">{req.rejection_reason}</p>
                )}
              </button>
            ))}
          </div>

          {/* Desktop table */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-5 py-3.5 font-medium text-gray-600">Type</th>
                  <th className="text-left px-5 py-3.5 font-medium text-gray-600">Reference</th>
                  <th className="text-left px-5 py-3.5 font-medium text-gray-600">Amount</th>
                  <th className="text-left px-5 py-3.5 font-medium text-gray-600">Method</th>
                  <th className="text-left px-5 py-3.5 font-medium text-gray-600">Member/s</th>
                  <th className="text-left px-5 py-3.5 font-medium text-gray-600">Submitted</th>
                  <th className="text-left px-5 py-3.5 font-medium text-gray-600">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {paged.length === 0 && (
                  <tr>
                    <td colSpan={7} className="text-center py-12 text-gray-400">
                      No deposit requests found
                    </td>
                  </tr>
                )}
                {paged.map(req => {
                  const amount = isBatch(req) ? req.total_amount : req.amount
                  const memberCell = isBatch(req)
                    ? req.member_names
                    : [(req as SharesRow | SavingsRow).profiles?.full_name ?? '—']
                  return (
                    <tr
                      key={`${req._type}-${req.id}`}
                      className="hover:bg-gray-50 cursor-pointer transition-colors"
                      onClick={() => openDetail(req)}
                    >
                      <td className="px-5 py-4">
                        <TypeBadge type={req._type} />
                      </td>
                      <td className="px-5 py-4 text-gray-500">
                        {req.reference ? (
                          <span className="inline-flex items-center gap-1.5">
                            <span className="text-sm font-semibold text-gray-800 tracking-wide">{req.reference}</span>
                            <button
                              onClick={e => { e.stopPropagation(); navigator.clipboard.writeText(req.reference!) }}
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
                      <td className="px-5 py-4 font-semibold text-gray-900">{currency(amount)}</td>
                      <td className="px-5 py-4 text-gray-600 capitalize">
                        {req.payment_method.replace('_', ' ')}
                      </td>
                      <td className="px-5 py-4">
                        {memberCell.length === 1 ? (
                          <p className="font-medium text-gray-900">{memberCell[0]}</p>
                        ) : (
                          <div className="space-y-0.5">
                            {memberCell.slice(0, 3).map((name, i) => (
                              <p key={i} className="text-gray-900 text-xs">{name}</p>
                            ))}
                            {memberCell.length > 3 && (
                              <p className="text-gray-400 text-xs">+{memberCell.length - 3} more</p>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-5 py-4 text-gray-500 text-xs whitespace-nowrap">{formatDate(req.created_at)}</td>
                      <td className="px-5 py-4">
                        <StatusBadge status={req.status} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <Pagination
            page={page}
            pageSize={25}
            total={totalRows}
            onChange={setPage}
          />
        </Card>
      </div>

      {/* Detail modal */}
      <Modal
        isOpen={!!detailReq}
        onClose={() => { setDetailReq(null); setConfirmingApproveInDetail(false) }}
        title="Deposit Request Details"
        size="2xl"
      >
        {detailReq && (
          <div className="space-y-5">
            {/* Header: type + status */}
            <div className="flex items-center justify-between gap-4">
              <TypeBadge type={detailReq._type} />
              <StatusBadge status={detailReq.status} />
            </div>

            {/* Key details */}
            <div className="grid grid-cols-2 gap-x-8 gap-y-4 text-sm border-t border-gray-100 pt-4">
              <div>
                <p className="text-xs text-gray-400 mb-0.5">Amount</p>
                <p className="text-2xl font-bold text-gray-900">
                  {currency(isBatch(detailReq) ? detailReq.total_amount : detailReq.amount)}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-0.5">Submitted</p>
                <p className="font-medium text-gray-700">{formatDate(detailReq.created_at)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-0.5">Payment Method</p>
                <p className="font-medium text-gray-700 capitalize">{detailReq.payment_method.replace('_', ' ')}</p>
              </div>
              {detailReq.reference && (
                <div>
                  <p className="text-xs text-gray-400 mb-0.5">Reference</p>
                  <p className="text-sm font-semibold text-gray-800 tracking-wide">{detailReq.reference}</p>
                </div>
              )}
              {isShares(detailReq) && detailReq.equity_shares && (
                <div>
                  <p className="text-xs text-gray-400 mb-0.5">Share</p>
                  <p className="font-medium text-gray-700">#{detailReq.equity_shares.share_number}</p>
                </div>
              )}
              {/* Member/s */}
              <div className={isBatch(detailReq) && detailReq.member_names.length > 1 ? 'col-span-2' : ''}>
                <p className="text-xs text-gray-400 mb-0.5">
                  {isBatch(detailReq) ? `Members (${detailReq.member_names.length})` : 'Member'}
                </p>
                {isBatch(detailReq) ? (
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {detailReq.member_names.map((name, i) => (
                      <span key={i} className="inline-flex items-center px-2 py-0.5 bg-gray-100 text-gray-700 rounded text-xs font-medium">
                        {name}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div>
                    <p className="font-medium text-gray-900">
                      {(detailReq as SharesRow | SavingsRow).profiles?.full_name ?? '—'}
                    </p>
                    {(detailReq as SharesRow | SavingsRow).profiles?.employee_id && (
                      <p className="text-xs text-gray-500 mt-0.5">
                        {(detailReq as SharesRow | SavingsRow).profiles?.employee_id}
                      </p>
                    )}
                  </div>
                )}
              </div>
              {detailReq.notes && (
                <div className="col-span-2">
                  <p className="text-xs text-gray-400 mb-0.5">Notes</p>
                  <p className="text-gray-700">{detailReq.notes}</p>
                </div>
              )}
            </div>

            {/* Rejection reason */}
            {detailReq.status === 'rejected' && detailReq.rejection_reason && (
              <div className="bg-red-50 border border-red-100 rounded-lg px-4 py-3">
                <p className="text-xs text-red-500 font-medium mb-0.5">Rejection Reason</p>
                <p className="text-sm text-red-700">{detailReq.rejection_reason}</p>
              </div>
            )}

            {/* Receipt */}
            {detailReq.receipt_url ? (
              <div className="border-t border-gray-100 pt-4">
                <p className="text-xs text-gray-400 mb-2">Receipt</p>
                <InlineReceiptViewer url={detailReq.receipt_url} />
              </div>
            ) : (
              <div className="border-t border-gray-100 pt-4">
                <p className="text-xs text-gray-400 mb-2">Receipt</p>
                <div className="flex items-center gap-2 text-gray-400 text-sm">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  No receipt uploaded
                </div>
              </div>
            )}

            {/* Actions */}
            {detailReq.status === 'pending' && (
              <div className="border-t border-gray-100 pt-4 space-y-3">
                {confirmingApproveInDetail ? (
                  <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 space-y-3">
                    <p className="text-sm text-gray-800 font-medium">Confirm approval</p>
                    <p className="text-sm text-gray-600">
                      Approve this <strong>{detailReq._type}</strong> deposit of{' '}
                      <strong>{currency(isBatch(detailReq) ? detailReq.total_amount : detailReq.amount)}</strong>
                      {isBatch(detailReq)
                        ? ` for ${detailReq.member_names.length} member${detailReq.member_names.length !== 1 ? 's' : ''}`
                        : ` from ${(detailReq as SharesRow | SavingsRow).profiles?.full_name}`}?
                    </p>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" className="flex-1"
                        onClick={() => setConfirmingApproveInDetail(false)}
                        disabled={approveIsPending}>
                        Cancel
                      </Button>
                      <Button size="sm" className="flex-1"
                        loading={approveIsPending}
                        onClick={() => handleApprove(detailReq)}>
                        Confirm Approve
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-3">
                    <Button
                      variant="outline"
                      className="flex-1 text-red-600 border-red-200 hover:bg-red-50"
                      onClick={() => {
                        const t = detailReq
                        setDetailReq(null)
                        setRejectTarget(t)
                        setRejectReason('')
                      }}
                    >
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

      {/* Reject modal */}
      <Modal
        isOpen={!!rejectTarget}
        onClose={() => setRejectTarget(null)}
        title="Reject Deposit Request"
        size="sm"
      >
        {rejectTarget && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Reject <strong>{currency(isBatch(rejectTarget) ? rejectTarget.total_amount : rejectTarget.amount)}</strong>{' '}
              {rejectTarget._type} deposit
              {isBatch(rejectTarget)
                ? ` for ${rejectTarget.member_names.length} member${rejectTarget.member_names.length !== 1 ? 's' : ''}`
                : ` from ${(rejectTarget as SharesRow | SavingsRow).profiles?.full_name}`}?
            </p>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Reason <span className="text-red-500">*</span>
              </label>
              <textarea
                rows={3}
                value={rejectReason}
                onChange={e => setRejectReason(e.target.value)}
                placeholder="Provide a reason for rejection…"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              />
            </div>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setRejectTarget(null)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                className="flex-1"
                loading={rejectIsPending}
                disabled={!rejectReason.trim()}
                onClick={handleReject}
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
