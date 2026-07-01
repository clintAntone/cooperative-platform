import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { StatusBadge } from '../../components/shared/StatusBadge'
import { ReceiptModal } from '../../components/shared/ReceiptModal'
import { PageLoader } from '../../components/shared/LoadingSpinner'
import { useMemberDetail } from '../../hooks/useMembers'
import { useAdminCreateShare, useAdminDeleteShare, useShareLimit } from '../../hooks/useEquity'
import { useApproveDepositRequest, useRejectDepositRequest } from '../../hooks/useDepositRequests'
import { useCurrency } from '../../hooks/useCurrency'
import { formatDate, formatDateTime, getProgressPercent } from '../../lib/utils'
import { exportMemberStatementPdf } from '../../lib/exportPdf'
import type { EquityContribution, DepositRequest } from '../../types'

interface ContributionDetailModalProps {
  contribution: EquityContribution | null
  onClose: () => void
  format: (n: number) => string
}

function ContributionDetailModal({ contribution, onClose, format }: ContributionDetailModalProps) {
  if (!contribution) return null
  return (
    <Modal isOpen={!!contribution} onClose={onClose} title="Contribution Detail" size="sm">
      <div className="divide-y divide-gray-100">
        <div className="flex justify-between py-2 text-sm">
          <span className="text-gray-500">Date</span>
          <span className="text-gray-900">{formatDateTime(contribution.contribution_at)}</span>
        </div>
        <div className="flex justify-between py-2 text-sm">
          <span className="text-gray-500">Amount</span>
          <span className="font-semibold text-gray-900">{format(contribution.amount)}</span>
        </div>
        <div className="flex justify-between py-2 text-sm">
          <span className="text-gray-500">Method</span>
          <span className="text-gray-900 capitalize">{contribution.payment_method.replace('_', ' ')}</span>
        </div>
        {contribution.reference && (
          <div className="flex justify-between py-2 text-sm">
            <span className="text-gray-500">Reference</span>
            <span className="font-mono text-xs text-gray-900">{contribution.reference}</span>
          </div>
        )}
      </div>
      <div className="pt-4 flex justify-end">
        <Button variant="secondary" size="sm" onClick={onClose}>Close</Button>
      </div>
    </Modal>
  )
}

export function MemberDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data, isLoading } = useMemberDetail(id!)
  const { format: currency } = useCurrency()
  const approveRequest = useApproveDepositRequest()
  const rejectRequest = useRejectDepositRequest()
  const createShare = useAdminCreateShare(id!)
  const deleteShare = useAdminDeleteShare(id!)
  const { data: shareLimit } = useShareLimit(id!)

  const [selectedContribution, setSelectedContribution] = useState<EquityContribution | null>(null)
  const [rejectTarget, setRejectTarget] = useState<DepositRequest | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [receiptModal, setReceiptModal] = useState<{ url: string; details: any } | null>(null)
  const [shareError, setShareError] = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  if (isLoading) return <PageLoader />
  if (!data) return <div className="p-6 text-gray-500">Member not found.</div>

  const { profile, membershipStatus, equityShares, contributions, depositRequests } = data

  const totalInvested = equityShares.reduce((sum, s) => sum + s.paid_amount, 0)
  const completedShares = equityShares.filter(s => s.status === 'completed').length
  const pendingRequests = depositRequests.filter(r => r.status === 'pending').length

  // Build map of deposit_request by share for receipt lookup
  const depositByShare: Record<string, DepositRequest[]> = {}
  for (const dr of depositRequests) {
    if (!depositByShare[dr.share_id]) depositByShare[dr.share_id] = []
    depositByShare[dr.share_id].push(dr)
  }

  // Map contribution_at to deposit_request for receipt linking
  // (best effort: match by amount and approx date within same share)
  function findReceiptForContribution(contrib: EquityContribution): string | null {
    const requests = depositByShare[contrib.share_id] ?? []
    const match = requests.find(r =>
      r.status === 'approved' &&
      r.amount === contrib.amount &&
      r.receipt_url
    )
    return match?.receipt_url ?? null
  }

  const handleApprove = (requestId: string) => {
    approveRequest.mutate(requestId)
  }

  const handleReject = () => {
    if (!rejectTarget) return
    rejectRequest.mutate(
      { requestId: rejectTarget.id, reason: rejectReason },
      {
        onSuccess: () => {
          setRejectTarget(null)
          setRejectReason('')
        },
      }
    )
  }

  const membershipStatusValue = (membershipStatus as any)?.status as string | undefined

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4 flex-wrap">
        <button
          onClick={() => navigate('/admin/members')}
          className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-lg sm:text-xl font-bold text-gray-900 truncate">{profile.full_name}</h1>
            {membershipStatusValue && <StatusBadge status={membershipStatusValue} />}
          </div>
          <p className="text-sm text-gray-500 mt-0.5">
            {profile.employee_id ? `Employee ID: ${profile.employee_id}` : 'No employee ID'} · Joined {formatDate(profile.created_at)}
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="flex-shrink-0"
          onClick={() => {
            const statementRows = contributions.map(c => ({
              date: formatDate(c.contribution_at),
              type: 'Contribution',
              description: `${c.payment_method.replace('_', ' ')}${c.reference ? ` — Ref: ${c.reference}` : ''}`,
              amount: c.amount,
            }))
            exportMemberStatementPdf(
              profile.full_name,
              statementRows,
              {
                totalContributions: totalInvested,
                completedShares,
                membershipStatus: membershipStatusValue ?? 'pending',
              }
            )
          }}
        >
          Export Statement PDF
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Invested', value: currency(totalInvested) },
          { label: 'Completed Shares', value: completedShares },
          { label: 'Active Loans', value: '—' },
          { label: 'Pending Requests', value: pendingRequests },
        ].map(c => (
          <Card key={c.label} className="p-3 sm:p-4 text-center">
            <p className="text-lg sm:text-2xl font-bold text-gray-900 truncate">{c.value}</p>
            <p className="text-xs text-gray-500 mt-1 truncate">{c.label}</p>
          </Card>
        ))}
      </div>

      {/* Equity Shares */}
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-gray-900">Equity Shares</h2>
            {shareLimit && (
              <span className="text-sm text-gray-500">
                {shareLimit.current} / {shareLimit.max}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            {shareError && (
              <span className="text-xs text-red-600">{shareError}</span>
            )}
            <Button
              size="sm"
              loading={createShare.isPending}
              disabled={shareLimit?.reached}
              title={shareLimit?.reached ? `Maximum of ${shareLimit?.max} shares reached` : undefined}
              onClick={async () => {
                setShareError(null)
                try {
                  await createShare.mutateAsync()
                } catch (err: any) {
                  setShareError(err.message)
                }
              }}
            >
              + Open Share
            </Button>
          </div>
        </div>
        {equityShares.length === 0 ? (
          <Card className="p-6 text-center text-gray-400 text-sm">No equity shares yet.</Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {equityShares.map(share => {
              const progress = getProgressPercent(share.paid_amount, share.target_amount)
              const shareContribs = contributions.filter(c => c.share_id === share.id)

              return (
                <Card key={share.id} className="p-4">
                  {/* Card header row */}
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">Share #{share.share_number}</p>
                      <p className="text-xs text-gray-400">{formatDate(share.created_at)}</p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <StatusBadge status={share.status} />
                      {share.paid_amount === 0 && share.status !== 'cancelled' && (
                        <button
                          onClick={() => setDeleteConfirm(share.id)}
                          className="p-1 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                          title="Delete empty share"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Progress */}
                  <div className="mb-1 flex justify-between text-xs">
                    <span className="text-gray-500">{currency(share.paid_amount)}</span>
                    <span className="font-medium text-gray-700">{progress}%</span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-1.5 mb-1">
                    <div
                      className={`h-1.5 rounded-full transition-all ${share.status === 'completed' ? 'bg-green-500' : 'bg-blue-500'}`}
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <p className="text-xs text-gray-400">Target: {currency(share.target_amount)}</p>

                  {/* Contributions table — shown inline if any */}
                  {shareContribs.length > 0 && (
                    <div className="mt-3 border-t border-gray-100 pt-3">
                      <p className="text-xs font-medium text-gray-500 mb-2">Contributions</p>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-gray-400">
                              <th className="text-left pb-1 font-medium">Date</th>
                              <th className="text-left pb-1 font-medium">Amount</th>
                              <th className="text-left pb-1 font-medium">Receipt</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-50">
                            {shareContribs.map(c => {
                              const receiptUrl = findReceiptForContribution(c)
                              return (
                                <tr
                                  key={c.id}
                                  className="hover:bg-gray-50 cursor-pointer"
                                  onClick={() => setSelectedContribution(c)}
                                >
                                  <td className="py-1 pr-2 text-gray-500">{formatDate(c.contribution_at)}</td>
                                  <td className="py-1 pr-2 font-medium text-gray-900">{currency(c.amount)}</td>
                                  <td className="py-1">
                                    {receiptUrl ? (
                                      <button
                                        onClick={e => {
                                          e.stopPropagation()
                                          setReceiptModal({
                                            url: receiptUrl,
                                            details: {
                                              amount: currency(c.amount),
                                              date: c.contribution_at,
                                              method: c.payment_method,
                                              reference: c.reference,
                                            },
                                          })
                                        }}
                                        className="text-blue-600 hover:text-blue-800 font-medium"
                                      >
                                        View
                                      </button>
                                    ) : (
                                      <span className="text-gray-400">—</span>
                                    )}
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </Card>
              )
            })}
          </div>
        )}
      </div>

      {/* Deposit Requests */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Deposit Requests</h2>
        {depositRequests.length === 0 ? (
          <Card className="p-6 text-center text-gray-400 text-sm">No deposit requests yet.</Card>
        ) : (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Date</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Share #</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Amount</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Method</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Receipt</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {depositRequests.map(req => {
                    const share = equityShares.find(s => s.id === req.share_id)
                    return (
                      <tr key={req.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-gray-500 text-xs">{formatDate(req.created_at)}</td>
                        <td className="px-4 py-3 text-gray-700">
                          {share ? `#${share.share_number}` : '—'}
                        </td>
                        <td className="px-4 py-3 font-medium text-gray-900">{currency(req.amount)}</td>
                        <td className="px-4 py-3 text-gray-600 capitalize">{req.payment_method.replace('_', ' ')}</td>
                        <td className="px-4 py-3">
                          <StatusBadge status={req.status} />
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
                              View
                            </button>
                          ) : (
                            <span className="text-gray-400 text-xs">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {req.status === 'pending' && (
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                variant="primary"
                                loading={approveRequest.isPending}
                                onClick={() => handleApprove(req.id)}
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
                            <span className="text-xs text-red-600">{req.rejection_reason}</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>

      {/* Contribution detail modal */}
      <ContributionDetailModal
        contribution={selectedContribution}
        onClose={() => setSelectedContribution(null)}
        format={currency}
      />

      {/* Receipt modal */}
      {receiptModal && (
        <ReceiptModal
          isOpen={!!receiptModal}
          onClose={() => setReceiptModal(null)}
          receiptUrl={receiptModal.url}
          details={receiptModal.details}
        />
      )}

      {/* Delete share confirmation modal */}
      <Modal
        isOpen={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        title="Delete Empty Share"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Delete this empty share? This cannot be undone. Only shares with no contributions can be deleted.
          </p>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
            <Button
              variant="danger"
              loading={deleteShare.isPending}
              onClick={async () => {
                if (!deleteConfirm) return
                try {
                  await deleteShare.mutateAsync(deleteConfirm)
                  setDeleteConfirm(null)
                } catch (err: any) {
                  setShareError(err.message)
                  setDeleteConfirm(null)
                }
              }}
            >
              Delete Share
            </Button>
          </div>
        </div>
      </Modal>

      {/* Reject modal */}
      <Modal
        isOpen={!!rejectTarget}
        onClose={() => {
          setRejectTarget(null)
          setRejectReason('')
        }}
        title="Reject Deposit Request"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Please provide a reason for rejecting this deposit request of{' '}
            <span className="font-semibold">{rejectTarget ? currency(rejectTarget.amount) : ''}</span>.
          </p>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Rejection Reason</label>
            <textarea
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
              rows={3}
              className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Enter reason..."
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button
              variant="secondary"
              onClick={() => {
                setRejectTarget(null)
                setRejectReason('')
              }}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={rejectRequest.isPending}
              disabled={!rejectReason.trim()}
              onClick={handleReject}
            >
              Reject
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
