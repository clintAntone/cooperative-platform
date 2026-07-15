import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Header } from '../../components/layout/Header'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { exportToExcel } from '../../lib/exportExcel'
import { PageGuide } from '../../components/shared/PageGuide'
import { Modal } from '../../components/ui/Modal'
import { StatusBadge } from '../../components/shared/StatusBadge'
import { SkeletonPage } from '../../components/shared/Skeleton'
import { Pagination } from '../../components/shared/Pagination'
import { supabase } from '../../lib/supabase'
import {
  useAllLoanApplications,
  useAdminApproveLoan,
  useAdminRejectLoan,
  useAdminSetUnderReview,
} from '../../hooks/useLoans'
import { useCurrency } from '../../hooks/useCurrency'
import { formatDate, cn } from '../../lib/utils'
import { LoanApplicationDetailModal } from './LoanApplicationDetailModal'

type TabValue = 'all' | 'submitted' | 'under_review' | 'approved' | 'rejected'

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
  { label: 'Pending Review', value: 'submitted' },
  { label: 'Under Review', value: 'under_review' },
  { label: 'Approved', value: 'approved' },
  { label: 'Rejected', value: 'rejected' },
]

export function LoanApplicationsPage() {
  const [selectedAppId, setSelectedAppId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<TabValue>('all')
  const [search, setSearch] = useState('')
  const [approveError, setApproveError] = useState<Record<string, string>>({})
  const [rejectingId, setRejectingId] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [sortKey, setSortKey] = useState<'amount_requested' | 'term_months' | 'created_at'>('created_at')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [page, setPage] = useState(0)

  useEffect(() => { setPage(0) }, [activeTab, search, sortKey, sortDir])

  const { data: applications = [], isLoading, isError, refetch } = useAllLoanApplications()
  const approveLoan = useAdminApproveLoan()
  const rejectLoan = useAdminRejectLoan()
  const setUnderReview = useAdminSetUnderReview()
  const { format: currency } = useCurrency()

  const { data: allCoMakers = [] } = useQuery({
    queryKey: ['all_loan_co_makers_admin'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('loan_co_makers')
        .select('application_id, status')
      if (error) throw error
      return (data ?? []) as { application_id: string; status: string }[]
    },
  })

  const coMakerSummary = (applicationId: string) => {
    const cms = allCoMakers.filter(cm => cm.application_id === applicationId)
    return {
      total: cms.length,
      confirmed: cms.filter(cm => cm.status === 'confirmed').length,
      declined: cms.filter(cm => cm.status === 'declined').length,
      pending: cms.filter(cm => cm.status === 'pending').length,
    }
  }

  const handleSort = (key: typeof sortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  // Treat draft applications with no pending co-makers as effectively 'submitted'
  // (they are stuck orphans from before the draft-flow fix)
  const effectiveStatus = (app: any) => {
    if (app.status === 'draft') {
      const cm = coMakerSummary(app.id)
      return cm.pending > 0 ? 'draft' : 'submitted'
    }
    return app.status
  }

  const filtered = (applications as any[]).filter(app => {
    if (effectiveStatus(app) === 'draft') return false
    const matchesTab = activeTab === 'all' ? true : effectiveStatus(app) === activeTab
    const q = search.toLowerCase()
    const matchesSearch = !q ||
      (app.profiles?.full_name ?? '').toLowerCase().includes(q) ||
      (app.purpose ?? '').toLowerCase().includes(q)
    return matchesTab && matchesSearch
  })

  const sorted = [...filtered].sort((a: any, b: any) => {
    const dir = sortDir === 'asc' ? 1 : -1
    if (sortKey === 'amount_requested') return (a.amount_requested - b.amount_requested) * dir
    if (sortKey === 'term_months') return (a.term_months - b.term_months) * dir
    if (sortKey === 'created_at') return (a.created_at > b.created_at ? 1 : -1) * dir
    return 0
  })

  const paged = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  const handleApprove = async (applicationId: string) => {
    setApproveError(prev => ({ ...prev, [applicationId]: '' }))
    approveLoan.mutate(applicationId, {
      onError: (err: any) => {
        setApproveError(prev => ({ ...prev, [applicationId]: err.message ?? 'Failed to approve' }))
      },
    })
  }

  const handleReject = () => {
    if (!rejectingId) return
    rejectLoan.mutate(
      { applicationId: rejectingId, reason: rejectReason.trim() || undefined },
      {
        onSuccess: () => {
          setRejectingId(null)
          setRejectReason('')
        },
      }
    )
  }

  if (isLoading) return <SkeletonPage cards={3} rows={6} />
  if (isError) return (
    <div className="p-8 text-center">
      <p className="text-red-600 mb-4">Failed to load loan applications.</p>
      <Button onClick={() => refetch()}>Retry</Button>
    </div>
  )

  return (
    <div>
      <Header
        title="Loan Applications"
        subtitle="Review and approve member loan applications"
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={() => refetch()}
              title="Refresh"
              className="inline-flex items-center gap-1.5 border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              <span className="hidden sm:inline">Refresh</span>
            </button>
            <button
              onClick={() => {
                const rows = filtered.map((app: any) => ({
                  Member: app.profiles?.full_name ?? '',
                  Amount: app.amount_requested,
                  'Term (months)': app.term_months,
                  Purpose: app.purpose ?? '',
                  Status: app.status,
                  'Applied On': formatDate(app.created_at),
                }))
                exportToExcel(rows, `loan-applications-${activeTab}`)
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

      <div className="p-4 sm:p-6 space-y-6">
        <PageGuide
          storageKey="loan-applications"
          steps={[
            'Members submit loan applications with an amount, term, purpose, and at least one co-maker (if amount exceeds their own collateral).',
            'Co-makers must confirm their role before the application can be approved — check the co-maker status column.',
            "Click 'Review' to open the application detail, verify collateral, then Approve or Reject.",
            'On approval, a loan record is created, a repayment schedule is generated, and a ledger disbursement entry is posted.',
          ]}
          note="The maximum loan amount is automatically enforced: borrower's completed shares value + savings + confirmed co-maker assets. Approval will fail if the amount exceeds this."
        />
        {/* Tabs */}
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

        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              type="text"
              placeholder="Search by member name or purpose…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full border border-gray-300 rounded-lg pl-3 pr-8 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                aria-label="Clear search"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
          <select
            value={`${sortKey}-${sortDir}`}
            onChange={e => {
              const [key, dir] = e.target.value.split('-') as [typeof sortKey, typeof sortDir]
              setSortKey(key)
              setSortDir(dir)
            }}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          >
            <option value="created_at-desc">Newest first</option>
            <option value="created_at-asc">Oldest first</option>
            <option value="amount_requested-desc">Amount ↓</option>
            <option value="amount_requested-asc">Amount ↑</option>
            <option value="term_months-desc">Term ↓</option>
            <option value="term_months-asc">Term ↑</option>
          </select>
        </div>

        <Card className="overflow-hidden">
          {/* Mobile cards */}
          <div className="sm:hidden divide-y divide-gray-100">
            {paged.length === 0 && <p className="text-center py-10 text-gray-400 text-sm">No applications found</p>}
            {paged.map((app: any) => {
              const cm = coMakerSummary(app.id)
              const allConfirmed = cm.total === 0 || cm.confirmed === cm.total
              const canApprove = effectiveStatus(app) === 'submitted' || effectiveStatus(app) === 'under_review'
              const err = approveError[app.id]
              return (
                <div
                  key={app.id}
                  className="p-4 space-y-2 cursor-pointer hover:bg-gray-50 active:bg-gray-100"
                  onClick={() => setSelectedAppId(app.id)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium text-sm text-gray-900">{app.profiles?.full_name ?? '—'}</p>
                      <p className="text-xs text-gray-400">{formatDate(app.created_at)}</p>
                    </div>
                    <StatusBadge status={app.status} />
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-lg font-bold text-gray-900">{currency(app.amount_requested)}</span>
                    <span className="text-xs text-gray-400">{app.term_months} mo</span>
                  </div>
                  {app.purpose && <p className="text-xs text-gray-600 line-clamp-2">{app.purpose}</p>}
                  <div>
                    {cm.total === 0 ? (
                      <span className="text-xs text-gray-400">No co-makers</span>
                    ) : (
                      <span className={`text-xs font-medium ${
                        allConfirmed ? 'text-green-700' :
                        cm.declined > 0 ? 'text-red-600' : 'text-yellow-700'
                      }`}>
                        {cm.confirmed}/{cm.total} confirmed
                        {cm.declined > 0 && `, ${cm.declined} declined`}
                        {cm.pending > 0 && `, ${cm.pending} pending`}
                      </span>
                    )}
                  </div>
                  {canApprove && (
                    <div className="flex flex-col gap-1 pt-1" onClick={e => e.stopPropagation()}>
                      <div className="flex gap-3">
                        {effectiveStatus(app) === 'submitted' && (
                          <button
                            onClick={() => setUnderReview.mutate(app.id)}
                            disabled={setUnderReview.isPending}
                            className="text-xs text-blue-600 hover:underline font-medium"
                          >
                            Review
                          </button>
                        )}
                        <button
                          onClick={() => handleApprove(app.id)}
                          disabled={approveLoan.isPending || !allConfirmed}
                          title={!allConfirmed && cm.total > 0 ? 'All co-makers must confirm first' : undefined}
                          className="text-xs text-green-700 hover:underline font-medium disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => { setRejectingId(app.id); setRejectReason('') }}
                          className="text-xs text-red-600 hover:underline font-medium"
                        >
                          Reject
                        </button>
                      </div>
                      {err && (
                        <p className="text-xs text-red-600 max-w-[200px]">{err}</p>
                      )}
                    </div>
                  )}
                  {app.status === 'rejected' && app.rejection_reason && (
                    <p className="text-xs text-gray-400 italic">{app.rejection_reason}</p>
                  )}
                </div>
              )
            })}
          </div>
          {/* Desktop table */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Member</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600 cursor-pointer select-none hover:text-gray-900"
                      onClick={() => handleSort('amount_requested')}>
                    Amount <SortIcon active={sortKey === 'amount_requested'} dir={sortDir} />
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600 cursor-pointer select-none hover:text-gray-900"
                      onClick={() => handleSort('term_months')}>
                    Term <SortIcon active={sortKey === 'term_months'} dir={sortDir} />
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Purpose</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Co-makers</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600 cursor-pointer select-none hover:text-gray-900"
                      onClick={() => handleSort('created_at')}>
                    Applied <SortIcon active={sortKey === 'created_at'} dir={sortDir} />
                  </th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={8} className="text-center py-10 text-gray-400">
                      No applications found
                    </td>
                  </tr>
                )}
                {paged.map((app: any) => {
                  const cm = coMakerSummary(app.id)
                  const allConfirmed = cm.total === 0 || cm.confirmed === cm.total
                  const canApprove = effectiveStatus(app) === 'submitted' || effectiveStatus(app) === 'under_review'
                  const err = approveError[app.id]

                  return (
                    <tr
                      key={app.id}
                      className="hover:bg-gray-50 cursor-pointer"
                      onClick={() => setSelectedAppId(app.id)}
                    >
                      <td className="px-4 py-3 font-medium text-gray-900">
                        {app.profiles?.full_name ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-700 font-medium">
                        {currency(app.amount_requested)}
                      </td>
                      <td className="px-4 py-3 text-gray-600">{app.term_months}mo</td>
                      <td className="px-4 py-3 text-gray-500 max-w-[160px]">
                        <span className="truncate block" title={app.purpose ?? undefined}>
                          {app.purpose ?? '—'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {cm.total === 0 ? (
                          <span className="text-xs text-gray-400">None</span>
                        ) : (
                          <span className={`text-xs font-medium ${
                            allConfirmed ? 'text-green-700' :
                            cm.declined > 0 ? 'text-red-600' : 'text-yellow-700'
                          }`}>
                            {cm.confirmed}/{cm.total} confirmed
                            {cm.declined > 0 && `, ${cm.declined} declined`}
                            {cm.pending > 0 && `, ${cm.pending} pending`}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={app.status} />
                      </td>
                      <td className="px-4 py-3 text-gray-400 text-xs">
                        {formatDate(app.created_at)}
                      </td>
                      <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                        {canApprove && (
                          <div className="flex flex-col gap-1 items-end">
                            <div className="flex gap-2">
                              {effectiveStatus(app) === 'submitted' && (
                                <button
                                  onClick={() => setUnderReview.mutate(app.id)}
                                  disabled={setUnderReview.isPending}
                                  className="text-xs text-blue-600 hover:underline font-medium"
                                >
                                  Review
                                </button>
                              )}
                              <button
                                onClick={() => handleApprove(app.id)}
                                disabled={approveLoan.isPending || !allConfirmed}
                                title={!allConfirmed && cm.total > 0 ? 'All co-makers must confirm first' : undefined}
                                className="text-xs text-green-700 hover:underline font-medium disabled:opacity-40 disabled:cursor-not-allowed"
                              >
                                Approve
                              </button>
                              <button
                                onClick={() => { setRejectingId(app.id); setRejectReason('') }}
                                className="text-xs text-red-600 hover:underline font-medium"
                              >
                                Reject
                              </button>
                            </div>
                            {err && (
                              <p className="text-xs text-red-600 text-right max-w-[200px]">{err}</p>
                            )}
                          </div>
                        )}
                        {app.status === 'rejected' && app.rejection_reason && (
                          <span className="text-xs text-gray-400 italic" title={app.rejection_reason}>
                            {app.rejection_reason.slice(0, 40)}{app.rejection_reason.length > 40 ? '…' : ''}
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>{/* end hidden sm:block */}
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={sorted.length}
            onChange={setPage}
          />
        </Card>
      </div>

      <LoanApplicationDetailModal
        applicationId={selectedAppId}
        onClose={() => setSelectedAppId(null)}
      />

      {/* Reject Modal */}
      <Modal
        isOpen={!!rejectingId}
        title="Reject Loan Application"
        onClose={() => setRejectingId(null)}
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-500">
            Optionally provide a reason for rejection. This will be visible to the member.
          </p>
          <textarea
            rows={3}
            value={rejectReason}
            onChange={e => setRejectReason(e.target.value)}
            placeholder="Reason for rejection (optional)"
            maxLength={300}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          />
          <p className="text-xs text-gray-400 text-right">{rejectReason.length} / 300</p>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={() => setRejectingId(null)}>Cancel</Button>
            <Button
              onClick={handleReject}
              loading={rejectLoan.isPending}
              className="bg-red-600 hover:bg-red-700"
            >
              Reject Application
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
