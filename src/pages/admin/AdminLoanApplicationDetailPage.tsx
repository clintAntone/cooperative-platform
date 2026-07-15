import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Header } from '../../components/layout/Header'
import { Card, CardHeader, CardBody } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { StatusBadge } from '../../components/shared/StatusBadge'
import { SkeletonDetailPage } from '../../components/shared/Skeleton'
import { Table, Thead, Tbody, Th, Tr, Td } from '../../components/ui/Table'
import {
  useLoanApplication,
  useLoanCoMakers,
  useLoans,
  useAdminApproveLoan,
  useAdminRejectLoan,
  useAdminSetUnderReview,
} from '../../hooks/useLoans'
import { useMembershipStatus } from '../../hooks/useMembership'
import { useEquityShares } from '../../hooks/useEquity'
import { useSavingsAccount } from '../../hooks/useSavings'
import { useCurrency } from '../../hooks/useCurrency'
import { formatDate, formatDateTime } from '../../lib/utils'

export function AdminLoanApplicationDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { format: currency } = useCurrency()

  const [rejectReason, setRejectReason] = useState('')
  const [showRejectModal, setShowRejectModal] = useState(false)
  const [approveError, setApproveError] = useState('')

  const { data: app, isLoading: appLoading } = useLoanApplication(id!)
  const { data: coMakers = [] } = useLoanCoMakers(id!)

  const memberId = app?.profiles?.id ?? app?.user_id ?? ''
  const { data: membership } = useMembershipStatus(memberId)
  const { data: shares = [] } = useEquityShares(memberId)
  const { data: savingsAccount } = useSavingsAccount(memberId)
  const { data: loanHistory = [] } = useLoans(memberId)

  const approveLoan = useAdminApproveLoan()
  const rejectLoan = useAdminRejectLoan()
  const setUnderReview = useAdminSetUnderReview()

  if (appLoading) return <SkeletonDetailPage cards={3} />

  if (!app) {
    return (
      <div className="p-6">
        <p className="text-gray-500">Application not found.</p>
        <Button className="mt-4" variant="outline" onClick={() => navigate('/admin/loans')}>
          Back
        </Button>
      </div>
    )
  }

  const effectiveStatus = (() => {
    if (app.status === 'draft') {
      const pending = coMakers.filter((cm: any) => cm.status === 'pending').length
      return pending > 0 ? 'draft' : 'submitted'
    }
    return app.status
  })()

  const canReview = effectiveStatus === 'submitted'
  const canApprove = effectiveStatus === 'submitted' || effectiveStatus === 'under_review'
  const canReject = effectiveStatus === 'submitted' || effectiveStatus === 'under_review'
  const allCoMakersConfirmed = coMakers.length === 0 ||
    coMakers.every((cm: any) => cm.status === 'confirmed')

  const completedShares = shares.filter((s: any) => s.status === 'completed')
  const totalEquity = completedShares.reduce((sum: number, s: any) => sum + (s.paid_amount ?? 0), 0)

  const handleApprove = () => {
    setApproveError('')
    approveLoan.mutate(app.id, {
      onSuccess: () => navigate('/admin/loans'),
      onError: (err: any) => setApproveError(err?.message ?? 'Failed to approve'),
    })
  }

  const handleReject = () => {
    rejectLoan.mutate(
      { applicationId: app.id, reason: rejectReason.trim() || undefined },
      {
        onSuccess: () => {
          setShowRejectModal(false)
          navigate('/admin/loans')
        },
      }
    )
  }

  const handleSetUnderReview = () => {
    setUnderReview.mutate(app.id)
  }

  return (
    <div>
      <Header
        title="Loan Application"
        subtitle={`${app.profiles?.full_name ?? '—'} · Applied ${formatDate(app.created_at)}`}
        actions={
          <div className="flex gap-2 flex-wrap">
            {canReview && (
              <Button
                size="sm"
                variant="secondary"
                onClick={handleSetUnderReview}
                loading={setUnderReview.isPending}
              >
                Mark Under Review
              </Button>
            )}
            {canApprove && (
              <Button
                size="sm"
                onClick={handleApprove}
                loading={approveLoan.isPending}
                disabled={!allCoMakersConfirmed}
                title={!allCoMakersConfirmed ? 'All co-makers must confirm first' : undefined}
              >
                Approve
              </Button>
            )}
            {canReject && (
              <Button
                size="sm"
                variant="danger"
                onClick={() => setShowRejectModal(true)}
              >
                Reject
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => navigate('/admin/loans')}>
              ← Back
            </Button>
          </div>
        }
      />

      <div className="p-4 sm:p-6 space-y-6">
        {/* KPI row */}
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
          <Card className="p-3 sm:p-5">
            <p className="text-xs sm:text-sm text-gray-500">Amount Requested</p>
            <p className="text-base sm:text-xl font-bold text-gray-900 mt-1 truncate">
              {currency(app.amount_requested)}
            </p>
          </Card>
          <Card className="p-3 sm:p-5">
            <p className="text-xs sm:text-sm text-gray-500">Term</p>
            <p className="text-base sm:text-xl font-bold text-gray-900 mt-1">{app.term_months} months</p>
          </Card>
          <Card className="p-3 sm:p-5">
            <p className="text-xs sm:text-sm text-gray-500">Status</p>
            <div className="mt-1.5">
              <StatusBadge status={effectiveStatus} size="md" />
            </div>
          </Card>
          <Card className="p-3 sm:p-5">
            <p className="text-xs sm:text-sm text-gray-500">Applied</p>
            <p className="text-base sm:text-sm font-bold text-gray-900 mt-1">{formatDate(app.created_at)}</p>
          </Card>
        </div>

        {approveError && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
            {approveError}
          </div>
        )}

        {/* Application Details */}
        <Card>
          <CardHeader>
            <h3 className="text-base font-semibold text-gray-900">Application Details</h3>
          </CardHeader>
          <CardBody>
            <dl className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <div>
                <dt className="text-xs text-gray-500">Purpose</dt>
                <dd className="text-sm font-medium text-gray-900 mt-0.5">{app.purpose ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500">Term</dt>
                <dd className="text-sm font-medium text-gray-900 mt-0.5">{app.term_months} months</dd>
              </div>
              {app.decision_at && (
                <div>
                  <dt className="text-xs text-gray-500">Decision Date</dt>
                  <dd className="text-sm font-medium text-gray-900 mt-0.5">{formatDateTime(app.decision_at)}</dd>
                </div>
              )}
              {app.rejection_reason && (
                <div className="col-span-2 sm:col-span-3">
                  <dt className="text-xs text-gray-500">Rejection Reason</dt>
                  <dd className="text-sm text-red-700 mt-0.5">{app.rejection_reason}</dd>
                </div>
              )}
            </dl>
          </CardBody>
        </Card>

        {/* Member Snapshot */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-gray-900">Member Snapshot</h3>
              {memberId && (
                <button
                  onClick={() => navigate(`/admin/members/${memberId}`)}
                  className="text-xs text-blue-600 hover:underline"
                >
                  View full profile →
                </button>
              )}
            </div>
          </CardHeader>
          <CardBody>
            <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <dt className="text-xs text-gray-500">Name</dt>
                <dd className="text-sm font-medium text-gray-900 mt-0.5">{app.profiles?.full_name ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500">Phone</dt>
                <dd className="text-sm font-medium text-gray-900 mt-0.5">{app.profiles?.phone ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500">Membership</dt>
                <dd className="mt-0.5">
                  {membership ? (
                    <StatusBadge status={membership.status} />
                  ) : <span className="text-sm text-gray-400">—</span>}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500">Completed Shares</dt>
                <dd className="text-sm font-medium text-gray-900 mt-0.5">
                  {membership?.completed_shares ?? 0}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500">Total Equity</dt>
                <dd className="text-sm font-bold text-gray-900 mt-0.5">{currency(totalEquity)}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500">Savings Balance</dt>
                <dd className="text-sm font-bold text-gray-900 mt-0.5">
                  {savingsAccount ? currency(savingsAccount.balance) : '—'}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500">Active Loans</dt>
                <dd className="text-sm font-medium text-gray-900 mt-0.5">
                  {loanHistory.filter((l: any) => l.status === 'active').length}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500">Account Status</dt>
                <dd className="mt-0.5">
                  <StatusBadge status={app.profiles?.account_status ?? 'active'} />
                </dd>
              </div>
            </dl>
          </CardBody>
        </Card>

        {/* Co-makers */}
        {coMakers.length > 0 && (
          <Card>
            <CardHeader>
              <h3 className="text-base font-semibold text-gray-900">Co-makers</h3>
            </CardHeader>
            <CardBody className="p-0">
              <Table>
                <Thead>
                  <Tr>
                    <Th>Name</Th>
                    <Th>Status</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {coMakers.map((cm: any) => (
                    <Tr key={cm.id}>
                      <Td>{cm.profiles?.full_name ?? '—'}</Td>
                      <Td><StatusBadge status={cm.status} /></Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            </CardBody>
          </Card>
        )}

        {/* Previous Loan History */}
        <Card>
          <CardHeader>
            <h3 className="text-base font-semibold text-gray-900">Loan History</h3>
          </CardHeader>
          <CardBody className="p-0">
            {loanHistory.length === 0 ? (
              <p className="text-sm text-gray-500 p-6 text-center">No previous loans</p>
            ) : (
              <Table>
                <Thead>
                  <Tr>
                    <Th>Disbursed</Th>
                    <Th>Principal</Th>
                    <Th>Outstanding</Th>
                    <Th>Term</Th>
                    <Th>Status</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {loanHistory.map((loan: any) => (
                    <Tr
                      key={loan.id}
                      className="cursor-pointer hover:bg-gray-50"
                      onClick={() => navigate(`/admin/loans/${loan.id}`)}
                    >
                      <Td>{formatDate(loan.disbursed_at)}</Td>
                      <Td className="font-medium">{currency(loan.principal)}</Td>
                      <Td className={loan.outstanding > 0 ? 'text-red-600 font-medium' : 'text-gray-400'}>
                        {currency(loan.outstanding)}
                      </Td>
                      <Td>{loan.term_months}mo</Td>
                      <Td><StatusBadge status={loan.status} /></Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            )}
          </CardBody>
        </Card>
      </div>

      {/* Reject Modal */}
      <Modal
        isOpen={showRejectModal}
        onClose={() => setShowRejectModal(false)}
        title="Reject Application"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Optionally provide a reason that will be shown to the member.
          </p>
          <textarea
            value={rejectReason}
            onChange={e => setRejectReason(e.target.value)}
            placeholder="Reason for rejection (optional)"
            rows={3}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <div className="flex gap-3 pt-1">
            <Button variant="outline" className="flex-1" onClick={() => setShowRejectModal(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              className="flex-1"
              loading={rejectLoan.isPending}
              onClick={handleReject}
            >
              Confirm Reject
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
