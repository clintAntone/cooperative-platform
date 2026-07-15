import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Modal } from '../../components/ui/Modal'
import { Button } from '../../components/ui/Button'
import { StatusBadge } from '../../components/shared/StatusBadge'
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
import { formatDate } from '../../lib/utils'

interface Props {
  applicationId: string | null
  onClose: () => void
}

export function LoanApplicationDetailModal({ applicationId, onClose }: Props) {
  const navigate = useNavigate()
  const { format: currency } = useCurrency()
  const [rejectReason, setRejectReason] = useState('')
  const [showRejectConfirm, setShowRejectConfirm] = useState(false)
  const [approveError, setApproveError] = useState('')

  const { data: app, isLoading } = useLoanApplication(applicationId ?? '')
  const { data: coMakers = [] } = useLoanCoMakers(applicationId ?? '')

  const memberId = app?.user_id ?? ''
  const { data: membership } = useMembershipStatus(memberId)
  const { data: shares = [] } = useEquityShares(memberId)
  const { data: savingsAccount } = useSavingsAccount(memberId)
  const { data: loanHistory = [] } = useLoans(memberId)

  const approveLoan = useAdminApproveLoan()
  const rejectLoan = useAdminRejectLoan()
  const setUnderReview = useAdminSetUnderReview()

  if (!applicationId) return null

  const effectiveStatus = (() => {
    if (!app) return 'submitted'
    if (app.status === 'draft') {
      const pending = coMakers.filter((cm: any) => cm.status === 'pending').length
      return pending > 0 ? 'draft' : 'submitted'
    }
    return app.status
  })()

  const canReview = effectiveStatus === 'submitted'
  const canApprove = effectiveStatus === 'submitted' || effectiveStatus === 'under_review'
  const canReject = effectiveStatus === 'submitted' || effectiveStatus === 'under_review'
  const allCoMakersConfirmed = coMakers.length === 0 || coMakers.every((cm: any) => cm.status === 'confirmed')

  const totalEquity = shares
    .filter((s: any) => s.status === 'completed')
    .reduce((sum: number, s: any) => sum + (s.paid_amount ?? 0), 0)

  const handleApprove = () => {
    setApproveError('')
    approveLoan.mutate(applicationId, {
      onSuccess: onClose,
      onError: (err: any) => setApproveError(err?.message ?? 'Failed to approve'),
    })
  }

  const handleReject = () => {
    rejectLoan.mutate(
      { applicationId, reason: rejectReason.trim() || undefined },
      { onSuccess: () => { setShowRejectConfirm(false); onClose() } }
    )
  }

  return (
    <Modal
      isOpen={!!applicationId}
      onClose={onClose}
      title={isLoading ? 'Loading…' : `${app?.profiles?.full_name ?? 'Loan Application'}`}
      size="lg"
    >
      {isLoading ? (
        <div className="py-12 text-center text-gray-400 text-sm">Loading…</div>
      ) : !app ? (
        <div className="py-8 text-center text-gray-400 text-sm">Application not found.</div>
      ) : (
        <div className="space-y-5">
          {/* KPI row */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-gray-50 rounded-lg p-3 text-center">
              <p className="text-xs text-gray-500 mb-0.5">Amount</p>
              <p className="text-base font-bold text-gray-900">{currency(app.amount_requested)}</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3 text-center">
              <p className="text-xs text-gray-500 mb-0.5">Term</p>
              <p className="text-base font-bold text-gray-900">{app.term_months} months</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3 text-center">
              <p className="text-xs text-gray-500 mb-0.5">Status</p>
              <div className="flex justify-center mt-0.5">
                <StatusBadge status={effectiveStatus} />
              </div>
            </div>
          </div>

          {/* Application info */}
          <div>
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Application</h4>
            <div className="divide-y divide-gray-100 border border-gray-100 rounded-lg text-sm">
              {app.purpose && (
                <div className="flex justify-between px-3 py-2">
                  <span className="text-gray-500">Purpose</span>
                  <span className="text-gray-900 text-right max-w-[60%]">{app.purpose}</span>
                </div>
              )}
              <div className="flex justify-between px-3 py-2">
                <span className="text-gray-500">Applied</span>
                <span className="text-gray-900">{formatDate(app.created_at)}</span>
              </div>
              {app.rejection_reason && (
                <div className="flex justify-between px-3 py-2">
                  <span className="text-gray-500">Rejection Reason</span>
                  <span className="text-red-700 text-right max-w-[60%]">{app.rejection_reason}</span>
                </div>
              )}
            </div>
          </div>

          {/* Member snapshot */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Member</h4>
              <button
                className="text-xs text-blue-600 hover:underline"
                onClick={() => { onClose(); navigate(`/admin/members/${memberId}`) }}
              >
                View profile →
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: 'Membership', value: membership ? <StatusBadge status={membership.status} /> : '—' },
                { label: 'Completed Shares', value: membership?.completed_shares ?? 0 },
                { label: 'Total Equity', value: currency(totalEquity) },
                { label: 'Savings Balance', value: savingsAccount ? currency(savingsAccount.balance) : '—' },
              ].map(({ label, value }) => (
                <div key={label} className="bg-gray-50 rounded-lg p-2.5">
                  <p className="text-xs text-gray-500 mb-0.5">{label}</p>
                  <div className="text-sm font-semibold text-gray-900">{value}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Co-makers */}
          {coMakers.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Co-makers</h4>
              <div className="border border-gray-100 rounded-lg overflow-hidden">
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
              </div>
            </div>
          )}

          {/* Loan history */}
          <div>
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
              Loan History ({loanHistory.length})
            </h4>
            {loanHistory.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-3">No previous loans</p>
            ) : (
              <div className="border border-gray-100 rounded-lg overflow-hidden">
                <Table>
                  <Thead>
                    <Tr>
                      <Th>Disbursed</Th>
                      <Th>Principal</Th>
                      <Th>Outstanding</Th>
                      <Th>Status</Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {loanHistory.map((loan: any) => (
                      <Tr
                        key={loan.id}
                        className="cursor-pointer"
                        onClick={() => { onClose(); navigate(`/admin/loans/${loan.id}`) }}
                      >
                        <Td>{formatDate(loan.disbursed_at)}</Td>
                        <Td className="font-medium">{currency(loan.principal)}</Td>
                        <Td className={loan.outstanding > 0 ? 'text-red-600 font-medium' : 'text-gray-400'}>
                          {currency(loan.outstanding)}
                        </Td>
                        <Td><StatusBadge status={loan.status} /></Td>
                      </Tr>
                    ))}
                  </Tbody>
                </Table>
              </div>
            )}
          </div>

          {/* Error */}
          {approveError && (
            <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{approveError}</p>
          )}

          {/* Actions */}
          {(canReview || canApprove || canReject) && (
            <div className="flex gap-2 pt-1 border-t border-gray-100">
              {canReview && (
                <Button
                  size="sm"
                  variant="secondary"
                  loading={setUnderReview.isPending}
                  onClick={() => setUnderReview.mutate(applicationId)}
                >
                  Mark Under Review
                </Button>
              )}
              {canApprove && (
                <Button
                  size="sm"
                  loading={approveLoan.isPending}
                  disabled={!allCoMakersConfirmed}
                  title={!allCoMakersConfirmed ? 'All co-makers must confirm first' : undefined}
                  onClick={handleApprove}
                >
                  Approve
                </Button>
              )}
              {canReject && !showRejectConfirm && (
                <Button size="sm" variant="danger" onClick={() => setShowRejectConfirm(true)}>
                  Reject
                </Button>
              )}
              <Button size="sm" variant="outline" className="ml-auto" onClick={onClose}>
                Close
              </Button>
            </div>
          )}

          {/* Inline reject form */}
          {showRejectConfirm && (
            <div className="border border-red-200 bg-red-50 rounded-lg p-3 space-y-2">
              <p className="text-sm font-medium text-red-800">Reject this application?</p>
              <textarea
                value={rejectReason}
                onChange={e => setRejectReason(e.target.value)}
                placeholder="Reason for rejection (optional)"
                rows={2}
                className="w-full border border-red-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400 bg-white"
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="danger"
                  loading={rejectLoan.isPending}
                  onClick={handleReject}
                >
                  Confirm Reject
                </Button>
                <Button size="sm" variant="outline" onClick={() => setShowRejectConfirm(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
