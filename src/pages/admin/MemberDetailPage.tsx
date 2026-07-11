import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../context/AuthContext'
import { useImpersonation } from '../../context/ImpersonationContext'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { StatusBadge } from '../../components/shared/StatusBadge'
import { ReceiptModal } from '../../components/shared/ReceiptModal'
import { SkeletonDetailPage } from '../../components/shared/Skeleton'
import { useMemberDetail } from '../../hooks/useMembers'
import { useAdminCreateShare, useAdminDeleteShare, useShareLimit } from '../../hooks/useEquity'
import { useApproveDepositRequest, useRejectDepositRequest } from '../../hooks/useDepositRequests'
import { useLoans } from '../../hooks/useLoans'
import { useMemberDocuments, DOCUMENT_TYPE_LABELS } from '../../hooks/useMemberDocuments'
import { useMemberNotes, useAddMemberNote, useDeleteMemberNote } from '../../hooks/useMemberNotes'
import { useSavingsAccount, useSavingsDepositRequests, useSavingsWithdrawalRequests, useSavingsInterestLogs } from '../../hooks/useSavings'
import { useCurrency } from '../../hooks/useCurrency'
import { formatDate, formatDateTime, getProgressPercent } from '../../lib/utils'
import { exportMemberStatementPdf } from '../../lib/exportPdf'
import { supabase } from '../../lib/supabase'
import { toast } from '../../lib/toast'
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
  const { profile: adminProfile } = useAuth()
  const { startImpersonation } = useImpersonation()
  const { data, isLoading } = useMemberDetail(id!)
  const { data: loans = [] } = useLoans(id!)
  const { format: currency } = useCurrency()
  const approveRequest = useApproveDepositRequest()
  const rejectRequest = useRejectDepositRequest()
  const createShare = useAdminCreateShare(id!)
  const deleteShare = useAdminDeleteShare(id!)
  const { data: shareLimit } = useShareLimit(id!)

  const [showOnlyPendingDeposits, setShowOnlyPendingDeposits] = useState(true)
  const [selectedContribution, setSelectedContribution] = useState<EquityContribution | null>(null)
  const [rejectTarget, setRejectTarget] = useState<DepositRequest | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [receiptModal, setReceiptModal] = useState<{ url: string; details: any } | null>(null)
  const [shareError, setShareError] = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [promoteConfirm, setPromoteConfirm] = useState(false)
  const [demoteConfirm, setDemoteConfirm] = useState(false)
  const [newNote, setNewNote] = useState('')

  const { data: memberDocuments = [] } = useMemberDocuments(id!)
  const { data: memberNotes = [] } = useMemberNotes(id!)
  const { data: savingsAccount } = useSavingsAccount(id!)
  const { data: savingsDeposits = [] } = useSavingsDepositRequests(id!)
  const { data: savingsWithdrawals = [] } = useSavingsWithdrawalRequests(id!)
  const { data: savingsInterestLogs = [] } = useSavingsInterestLogs(savingsAccount?.id)
  const addNote = useAddMemberNote(id!)
  const deleteNote = useDeleteMemberNote(id!)

  const queryClient = useQueryClient()

  const changeRoleMutation = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: 'collector' | 'member' }) => {
      const { error } = await supabase
        .from('profiles')
        .update({ role })
        .eq('id', userId)
      if (error) throw error
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['member_detail', variables.userId] })
      queryClient.invalidateQueries({ queryKey: ['members_list'] })
      const action = variables.role === 'collector' ? 'promoted to Collector' : 'demoted to Member'
      toast({ title: `Member ${action}`, variant: 'success' })
    },
    onError: (err: any) => {
      toast({ title: err.message ?? 'Failed to update role', variant: 'error' })
    },
  })

  if (isLoading) return <SkeletonDetailPage />
  if (!data) return <div className="p-6 text-gray-500">Member not found.</div>

  const { profile, membershipStatus, equityShares, contributions, depositRequests } = data

  const totalInvested = equityShares.reduce((sum, s) => sum + s.paid_amount, 0)
  const completedShares = equityShares.filter(s => s.status === 'completed').length
  const pendingRequests = depositRequests.filter(r => r.status === 'pending').length
  const activeLoans = loans.filter((l: any) => l.status === 'active').length

  function findReceiptForContribution(contrib: EquityContribution): string | null {
    return contrib.deposit_requests?.receipt_url ?? null
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
      <div className="space-y-3">
        {/* Nav row: back + actions */}
        <div className="flex items-center justify-between gap-2">
          <button
            onClick={() => navigate('/admin/members')}
            title="Back to Members"
            className="inline-flex items-center justify-center w-9 h-9 text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="flex items-center gap-2 ml-auto">
          {adminProfile?.role === 'admin' && profile.role === 'member' && (
            <button
              title="Promote to Collector"
              onClick={() => setPromoteConfirm(true)}
              className="inline-flex items-center gap-1.5 px-3 h-9 text-sm font-medium text-purple-700 bg-purple-50 border border-purple-200 rounded-lg hover:bg-purple-100 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M7 11l5-5m0 0l5 5m-5-5v12" />
              </svg>
              <span className="hidden sm:inline">Promote to Collector</span>
            </button>
          )}
          {adminProfile?.role === 'admin' && profile.role === 'collector' && (
            <button
              title="Demote to Member"
              onClick={() => setDemoteConfirm(true)}
              className="inline-flex items-center gap-1.5 px-3 h-9 text-sm font-medium text-gray-700 bg-gray-50 border border-gray-300 rounded-lg hover:bg-gray-100 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 13l-5 5m0 0l-5-5m5 5V6" />
              </svg>
              <span className="hidden sm:inline">Demote to Member</span>
            </button>
          )}
          {adminProfile?.role === 'admin' && (
            <button
              title="View as this member"
              onClick={async () => {
                await startImpersonation({
                  id: profile.id,
                  full_name: profile.full_name,
                  role: profile.role,
                })
                navigate('/dashboard')
              }}
              className="inline-flex items-center gap-1.5 px-3 h-9 text-sm font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-lg hover:bg-amber-100 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
              <span className="hidden sm:inline">View as Member</span>
            </button>
          )}
          <Button
            size="sm"
            variant="outline"
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
            <svg className="w-4 h-4 sm:hidden" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            <span className="hidden sm:inline">Export Statement PDF</span>
          </Button>
          </div>
        </div>
        {/* Member info */}
        <div>
          <div className="flex items-center gap-2">
            {membershipStatusValue && (
              <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                membershipStatusValue === 'active'    ? 'bg-green-500' :
                membershipStatusValue === 'pending'   ? 'bg-yellow-400' :
                membershipStatusValue === 'suspended' ? 'bg-red-500' :
                'bg-gray-400'
              }`} />
            )}
            <h1 className="text-lg sm:text-xl font-bold text-gray-900 truncate" title={profile.full_name}>{profile.full_name}</h1>
          </div>
          {profile.employee_id && (
            <p className="text-sm text-gray-500 font-mono mt-0.5">{profile.employee_id}</p>
          )}
          <p className="text-sm text-gray-500">Joined {formatDate(profile.created_at)}</p>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Invested', value: currency(totalInvested) },
          { label: 'Completed Shares', value: completedShares },
          { label: 'Active Loans', value: activeLoans },
          { label: 'Pending Requests', value: pendingRequests },
        ].map(c => (
          <Card key={c.label} className="p-3 sm:p-4 text-center">
            <p className="text-lg sm:text-2xl font-bold text-gray-900 truncate" title={String(c.value)}>{c.value}</p>
            <p className="text-xs text-gray-500 mt-1 truncate" title={c.label}>{c.label}</p>
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
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Deposit Requests</h2>
          <label className="flex items-center gap-2 text-sm text-gray-500 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showOnlyPendingDeposits}
              onChange={e => setShowOnlyPendingDeposits(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            Pending only
          </label>
        </div>
        {depositRequests.length === 0 ? (
          <Card className="p-6 text-center text-gray-400 text-sm">No deposit requests yet.</Card>
        ) : (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Date</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Amount</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Method</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Receipt</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {(showOnlyPendingDeposits ? depositRequests.filter(r => r.status === 'pending') : depositRequests).map(req => {
                    return (
                      <tr key={req.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-gray-500 text-xs">{formatDate(req.created_at)}</td>
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
                          {req.status !== 'pending' ? (
                            <span className="text-xs text-gray-400">No action needed</span>
                          ) : (
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
                            <span className="text-xs text-red-600 mt-1 block">{req.rejection_reason}</span>
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

      {/* Loans */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Loans</h2>
        {loans.length === 0 ? (
          <Card className="p-6 text-center text-gray-400 text-sm">No loans yet.</Card>
        ) : (
          <div className="space-y-3">
            {loans.map((loan: any) => (
              <Card key={loan.id} className="p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{currency(loan.principal)}</p>
                    <p className="text-xs text-gray-400">{loan.disbursed_at ? `Disbursed ${formatDate(loan.disbursed_at)}` : formatDate(loan.created_at)}</p>
                  </div>
                  <StatusBadge status={loan.status} />
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <p className="text-gray-400">Outstanding</p>
                    <p className="font-medium text-gray-900">{currency(loan.outstanding ?? 0)}</p>
                  </div>
                  <div>
                    <p className="text-gray-400">Paid</p>
                    <p className="font-medium text-gray-900">{currency(loan.amount_paid ?? 0)}</p>
                  </div>
                  <div>
                    <p className="text-gray-400">Term</p>
                    <p className="font-medium text-gray-900">{loan.term_months}mo</p>
                  </div>
                </div>
                {loan.purpose && (
                  <p className="text-xs text-gray-500 italic">{loan.purpose}</p>
                )}
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Savings */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Savings</h2>
        {!savingsAccount ? (
          <Card className="p-6 text-center text-gray-400 text-sm">No savings account yet. Opens automatically when first share is completed.</Card>
        ) : (
          <div className="space-y-3">
            {/* Summary */}
            <div className="grid grid-cols-3 gap-3">
              <Card className="p-3 text-center">
                <p className="text-xs text-gray-500">Balance</p>
                <p className="text-lg font-bold text-gray-900 mt-0.5">{currency(savingsAccount.balance)}</p>
              </Card>
              <Card className="p-3 text-center">
                <p className="text-xs text-gray-500">Interest Earned</p>
                <p className="text-lg font-bold text-green-600 mt-0.5">{currency(savingsInterestLogs.reduce((s, l) => s + l.interest_earned, 0))}</p>
              </Card>
              <Card className="p-3 text-center">
                <p className="text-xs text-gray-500">Status</p>
                <p className={`text-sm font-semibold mt-1 capitalize ${savingsAccount.status === 'active' ? 'text-green-600' : 'text-gray-500'}`}>{savingsAccount.status}</p>
              </Card>
            </div>

            {/* Recent deposits */}
            {savingsDeposits.length > 0 && (
              <Card>
                <div className="px-4 py-3 border-b border-gray-100">
                  <h3 className="text-sm font-semibold text-gray-900">Deposit Requests</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-gray-100">
                        <th className="text-left px-4 py-2 text-gray-500 font-medium">Date</th>
                        <th className="text-right px-4 py-2 text-gray-500 font-medium">Amount</th>
                        <th className="text-left px-4 py-2 text-gray-500 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {savingsDeposits.slice(0, 5).map(req => (
                        <tr key={req.id}>
                          <td className="px-4 py-2 text-gray-500">{formatDate(req.created_at)}</td>
                          <td className="px-4 py-2 text-right font-medium text-gray-900">{currency(req.amount)}</td>
                          <td className="px-4 py-2">
                            <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium capitalize ${
                              req.status === 'approved' ? 'bg-green-100 text-green-700' :
                              req.status === 'pending' ? 'bg-yellow-100 text-yellow-700' :
                              'bg-red-100 text-red-700'
                            }`}>{req.status}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}

            {/* Recent withdrawals */}
            {savingsWithdrawals.length > 0 && (
              <Card>
                <div className="px-4 py-3 border-b border-gray-100">
                  <h3 className="text-sm font-semibold text-gray-900">Withdrawal Requests</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-gray-100">
                        <th className="text-left px-4 py-2 text-gray-500 font-medium">Date</th>
                        <th className="text-right px-4 py-2 text-gray-500 font-medium">Amount</th>
                        <th className="text-left px-4 py-2 text-gray-500 font-medium">Reason</th>
                        <th className="text-left px-4 py-2 text-gray-500 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {savingsWithdrawals.slice(0, 5).map(req => (
                        <tr key={req.id}>
                          <td className="px-4 py-2 text-gray-500">{formatDate(req.created_at)}</td>
                          <td className="px-4 py-2 text-right font-medium text-gray-900">{currency(req.amount)}</td>
                          <td className="px-4 py-2 text-gray-600 max-w-xs truncate">{req.reason ?? '—'}</td>
                          <td className="px-4 py-2">
                            <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium capitalize ${
                              req.status === 'approved' ? 'bg-green-100 text-green-700' :
                              req.status === 'pending' ? 'bg-yellow-100 text-yellow-700' :
                              'bg-red-100 text-red-700'
                            }`}>{req.status}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}
          </div>
        )}
      </div>

      {/* Documents */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Documents</h2>
        {memberDocuments.length === 0 ? (
          <Card className="p-6 text-center text-gray-400 text-sm">No documents uploaded yet.</Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {memberDocuments.map(doc => (
              <a
                key={doc.id}
                href={doc.file_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 bg-white rounded-xl border border-gray-200 px-4 py-3 hover:border-blue-300 hover:bg-blue-50 transition-colors"
              >
                <svg className="w-5 h-5 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900 truncate">{doc.file_name}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{DOCUMENT_TYPE_LABELS[doc.document_type]} · {formatDate(doc.uploaded_at)}</p>
                </div>
                <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>
            ))}
          </div>
        )}
      </div>

      {/* Admin Notes — admin/staff only */}
      {(adminProfile?.role === 'admin' || adminProfile?.role === 'staff') && (
        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Internal Notes</h2>
          <Card className="p-4 space-y-4">
            {/* Add note */}
            <div className="flex gap-2">
              <textarea
                rows={2}
                value={newNote}
                onChange={e => setNewNote(e.target.value)}
                placeholder="Add an internal note..."
                className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none bg-gray-50"
              />
              <Button
                size="sm"
                disabled={!newNote.trim() || addNote.isPending}
                loading={addNote.isPending}
                onClick={async () => {
                  if (!newNote.trim()) return
                  await addNote.mutateAsync(newNote.trim())
                  setNewNote('')
                }}
              >
                Add
              </Button>
            </div>

            {/* Notes list */}
            {memberNotes.length === 0 ? (
              <p className="text-xs text-gray-400 italic">No notes yet.</p>
            ) : (
              <div className="space-y-3">
                {memberNotes.map(note => (
                  <div key={note.id} className="flex gap-3 group">
                    <div className="flex-1 bg-gray-50 rounded-xl px-3 py-2.5 text-sm text-gray-800 leading-relaxed">
                      {note.note}
                      <p className="text-[10px] text-gray-400 mt-1.5">
                        {note.author_name} · {formatDateTime(note.created_at)}
                      </p>
                    </div>
                    <button
                      onClick={() => deleteNote.mutate(note.id)}
                      className="opacity-0 group-hover:opacity-100 self-start mt-2 text-gray-400 hover:text-red-600 transition-all"
                      title="Delete note"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

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

      {/* Promote to Collector modal */}
      <Modal
        isOpen={promoteConfirm}
        onClose={() => setPromoteConfirm(false)}
        title="Promote to Collector"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Promote <span className="font-semibold">{profile.full_name}</span> to Collector?
            They will be able to submit batch deposits on behalf of other members.
          </p>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={() => setPromoteConfirm(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={changeRoleMutation.isPending}
              onClick={async () => {
                await changeRoleMutation.mutateAsync({ userId: profile.id, role: 'collector' })
                setPromoteConfirm(false)
              }}
            >
              Promote to Collector
            </Button>
          </div>
        </div>
      </Modal>

      {/* Demote to Member modal */}
      <Modal
        isOpen={demoteConfirm}
        onClose={() => setDemoteConfirm(false)}
        title="Demote to Member"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Demote <span className="font-semibold">{profile.full_name}</span> back to Member?
            They will no longer be able to submit batch deposits.
          </p>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={() => setDemoteConfirm(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={changeRoleMutation.isPending}
              onClick={async () => {
                await changeRoleMutation.mutateAsync({ userId: profile.id, role: 'member' })
                setDemoteConfirm(false)
              }}
            >
              Demote to Member
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
