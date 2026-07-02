import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Header } from '../../components/layout/Header'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { StatusBadge } from '../../components/shared/StatusBadge'
import { PageLoader } from '../../components/shared/LoadingSpinner'
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
  const [activeTab, setActiveTab] = useState<TabValue>('all')
  const [approveError, setApproveError] = useState<Record<string, string>>({})
  const [rejectingId, setRejectingId] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [sortKey, setSortKey] = useState<'amount_requested' | 'term_months' | 'created_at'>('created_at')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [page, setPage] = useState(0)

  useEffect(() => { setPage(0) }, [activeTab, sortKey, sortDir])

  const { data: applications = [], isLoading } = useAllLoanApplications()
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

  // Admins never see 'draft' — those are still awaiting co-maker confirmation
  const filtered = (applications as any[]).filter(app => {
    if (app.status === 'draft') return false
    return activeTab === 'all' ? true : app.status === activeTab
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

  if (isLoading) return <PageLoader />

  return (
    <div>
      <Header
        title="Loan Applications"
        subtitle="Review and approve member loan applications"
      />

      <div className="p-4 sm:p-6 space-y-6">
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

        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
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
                  const allConfirmed = cm.total > 0 && cm.confirmed === cm.total
                  const canApprove = app.status === 'submitted' || app.status === 'under_review'
                  const err = approveError[app.id]

                  return (
                    <tr key={app.id} className="hover:bg-gray-50">
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
                      <td className="px-4 py-3">
                        {canApprove && (
                          <div className="flex flex-col gap-1 items-end">
                            <div className="flex gap-2">
                              {app.status === 'submitted' && (
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
                                title={!allConfirmed ? 'All co-makers must confirm first' : undefined}
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
          </div>
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={sorted.length}
            onChange={setPage}
          />
        </Card>
      </div>

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
