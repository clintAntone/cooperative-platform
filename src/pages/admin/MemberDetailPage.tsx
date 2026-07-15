import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
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
import { useCustomRoles, useAssignCustomRole } from '../../hooks/useCustomRoles'
import type { EquityContribution, DepositRequest } from '../../types'

const customRoleColorMap: Record<string, string> = {
  gray:   'bg-gray-100 text-gray-700',
  blue:   'bg-blue-100 text-blue-700',
  green:  'bg-green-100 text-green-700',
  purple: 'bg-purple-100 text-purple-700',
  red:    'bg-red-100 text-red-700',
  yellow: 'bg-yellow-100 text-yellow-700',
  orange: 'bg-orange-100 text-orange-700',
  pink:   'bg-pink-100 text-pink-700',
}

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

  const [showPersonalDetails, setShowPersonalDetails] = useState(false)
  const [showNotesModal, setShowNotesModal] = useState(false)
  const [showOnlyPendingDeposits, setShowOnlyPendingDeposits] = useState(true)
  const [selectedContribution, setSelectedContribution] = useState<EquityContribution | null>(null)
  const [rejectTarget, setRejectTarget] = useState<DepositRequest | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [receiptModal, setReceiptModal] = useState<{ url: string; details: any } | null>(null)
  const [shareError, setShareError] = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [showAssignRole, setShowAssignRole] = useState(false)
  const [selectedCustomRoleId, setSelectedCustomRoleId] = useState<string>('')
  const [newNote, setNewNote] = useState('')

  const { data: memberDocuments = [] } = useMemberDocuments(id!)
  const { data: memberNotes = [] } = useMemberNotes(id!)
  const { data: savingsAccount } = useSavingsAccount(id!)
  const { data: savingsDeposits = [] } = useSavingsDepositRequests(id!)
  const { data: savingsWithdrawals = [] } = useSavingsWithdrawalRequests(id!)
  const { data: savingsInterestLogs = [] } = useSavingsInterestLogs(savingsAccount?.id)
  const addNote = useAddMemberNote(id!)
  const deleteNote = useDeleteMemberNote(id!)
  const { data: customRoles = [] } = useCustomRoles()
  const assignCustomRole = useAssignCustomRole()

  const queryClient = useQueryClient()

  if (isLoading) return <SkeletonDetailPage />
  if (!data) return <div className="p-6 text-gray-500">Member not found.</div>

  const { profile, membershipStatus, equityShares, contributions, depositRequests } = data

  const totalInvested = equityShares.reduce((sum, s) => sum + s.paid_amount, 0)
  const completedShares = equityShares.filter(s => s.status === 'completed').length
  const activeLoans = loans.filter((l: any) => l.status === 'active').length

  function findReceiptForContribution(contrib: EquityContribution): string | null {
    return contrib.equity_deposit_requests?.receipt_url ?? null
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
          {(adminProfile?.role === 'admin' || adminProfile?.role === 'staff') && (
            <div className="flex items-center gap-2">
              {(profile as any).custom_roles && (
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${customRoleColorMap[(profile as any).custom_roles?.color ?? 'gray'] ?? 'bg-gray-100 text-gray-700'}`}>
                  {(profile as any).custom_roles?.name}
                </span>
              )}
              {showAssignRole ? (
                <div className="flex items-center gap-1.5">
                  <select
                    value={selectedCustomRoleId}
                    onChange={e => setSelectedCustomRoleId(e.target.value)}
                    className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                  >
                    <option value="">— No Role —</option>
                    {customRoles.map(r => (
                      <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                  </select>
                  <button
                    onClick={async () => {
                      await assignCustomRole.mutateAsync({ userId: profile.id, customRoleId: selectedCustomRoleId || null })
                      setShowAssignRole(false)
                      queryClient.invalidateQueries({ queryKey: ['member_detail', profile.id] })
                    }}
                    disabled={assignCustomRole.isPending}
                    className="px-2.5 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => setShowAssignRole(false)}
                    className="px-2.5 py-1.5 text-xs font-medium text-gray-600 bg-gray-50 border border-gray-300 rounded-lg hover:bg-gray-100 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => {
                    setSelectedCustomRoleId((profile as any).custom_role_id ?? '')
                    setShowAssignRole(true)
                  }}
                  className="inline-flex items-center gap-1.5 px-3 h-9 text-sm font-medium text-purple-700 bg-purple-50 border border-purple-200 rounded-lg hover:bg-purple-100 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a2 2 0 012-2z" />
                  </svg>
                  <span className="hidden sm:inline">Assign Role</span>
                </button>
              )}
            </div>
          )}
          {(adminProfile?.role === 'admin' || adminProfile?.role === 'staff') && (
            <button
              onClick={() => setShowNotesModal(true)}
              className="relative inline-flex items-center gap-1.5 px-3 h-9 text-sm font-medium text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              <span className="hidden sm:inline">Notes</span>
              {memberNotes.length > 0 && (
                <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-blue-600 text-white text-[10px] font-bold flex items-center justify-center">
                  {memberNotes.length}
                </span>
              )}
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
          { label: 'Savings Balance', value: savingsAccount ? currency(savingsAccount.balance) : '—' },
          { label: 'Active Loans', value: activeLoans },
        ].map(c => (
          <Card key={c.label} className="p-3 sm:p-4 text-center">
            <p className="text-lg sm:text-2xl font-bold text-gray-900 truncate" title={String(c.value)}>{c.value}</p>
            <p className="text-xs text-gray-500 mt-1 truncate" title={c.label}>{c.label}</p>
          </Card>
        ))}
      </div>

      {/* ── Collapsible: Personal Details + Documents + Notes ───────── */}
      <Card className="overflow-hidden">
        <button
          type="button"
          onClick={() => setShowPersonalDetails(o => !o)}
          className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50 transition-colors"
        >
          <span className="text-sm font-medium text-gray-700">Personal Details &amp; Documents</span>
          <svg
            className={`w-4 h-4 text-gray-400 transition-transform ${showPersonalDetails ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {showPersonalDetails && (
          <div className="border-t border-gray-100 grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-gray-100">
            {/* Personal info */}
            <div className="p-4 space-y-3">
              <dl className="divide-y divide-gray-100">
                {[
                  { label: 'Phone', value: profile.phone },
                  { label: 'Date of Birth', value: (profile as any).date_of_birth ? formatDate((profile as any).date_of_birth) : null },
                  { label: 'Civil Status', value: (profile as any).civil_status },
                  { label: 'Address', value: (profile as any).address },
                ].map(({ label, value }) => (
                  <div key={label} className="flex justify-between gap-4 py-2 text-sm">
                    <dt className="text-gray-400 flex-shrink-0">{label}</dt>
                    <dd className="text-gray-900 text-right">{value ?? <span className="text-gray-300 italic text-xs">Not provided</span>}</dd>
                  </div>
                ))}
              </dl>
              {((profile as any).emergency_contact_name || (profile as any).emergency_contact_phone) && (
                <>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide pt-1">Emergency Contact</p>
                  <dl className="divide-y divide-gray-100">
                    {[
                      { label: 'Name', value: (profile as any).emergency_contact_name },
                      { label: 'Phone', value: (profile as any).emergency_contact_phone },
                    ].map(({ label, value }) => (
                      <div key={label} className="flex justify-between gap-4 py-2 text-sm">
                        <dt className="text-gray-400 flex-shrink-0">{label}</dt>
                        <dd className="text-gray-900 text-right">{value ?? <span className="text-gray-300 italic text-xs">Not provided</span>}</dd>
                      </div>
                    ))}
                  </dl>
                </>
              )}
              <dl className="divide-y divide-gray-100">
                <div className="flex justify-between gap-4 py-2 text-sm">
                  <dt className="text-gray-400">Account Status</dt>
                  <dd><StatusBadge status={profile.account_status} /></dd>
                </div>
                {membershipStatusValue && (
                  <div className="flex justify-between gap-4 py-2 text-sm">
                    <dt className="text-gray-400">Membership</dt>
                    <dd><StatusBadge status={membershipStatusValue} /></dd>
                  </div>
                )}
                {(profile as any).profile_completed_at && (
                  <div className="flex justify-between gap-4 py-2 text-sm">
                    <dt className="text-gray-400">Profile Completed</dt>
                    <dd className="text-gray-900">{formatDate((profile as any).profile_completed_at)}</dd>
                  </div>
                )}
              </dl>
            </div>

            {/* Documents + Notes */}
            <div className="divide-y divide-gray-100">
              {/* Documents */}
              <div className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Documents</p>
                  <span className="text-xs text-gray-400">{memberDocuments.length} file{memberDocuments.length !== 1 ? 's' : ''}</span>
                </div>
                {memberDocuments.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-6 text-center">
                    <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center mb-2">
                      <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                      </svg>
                    </div>
                    <p className="text-sm text-gray-400">No documents uploaded yet</p>
                    <p className="text-xs text-gray-300 mt-0.5">Documents submitted by the member will appear here</p>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {memberDocuments.map(doc => (
                      <a
                        key={doc.id}
                        href={doc.file_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group flex items-center gap-3 rounded-lg bg-gray-50 px-3 py-2.5 hover:bg-blue-50 hover:text-blue-700 transition-colors"
                      >
                        <div className="w-8 h-8 rounded-lg bg-white border border-gray-200 flex items-center justify-center flex-shrink-0 group-hover:border-blue-200">
                          <svg className="w-4 h-4 text-gray-400 group-hover:text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                          </svg>
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-gray-900 truncate group-hover:text-blue-700">{doc.file_name}</p>
                          <p className="text-xs text-gray-400">{DOCUMENT_TYPE_LABELS[doc.document_type]} · {formatDate(doc.uploaded_at)}</p>
                        </div>
                        <svg className="w-3.5 h-3.5 text-gray-300 group-hover:text-blue-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                      </a>
                    ))}
                  </div>
                )}
              </div>

            </div>
          </div>
        )}
      </Card>

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

      {/* Internal Notes Modal */}
      <Modal
        isOpen={showNotesModal}
        onClose={() => { setShowNotesModal(false); setNewNote('') }}
        title={`Notes — ${profile.full_name}`}
        size="md"
      >
        <div className="space-y-4">
          <p className="text-xs text-gray-400">
            These notes are only visible to admins and staff. The member cannot see them.
          </p>

          {/* Composer */}
          <div className="rounded-xl border border-gray-200 bg-gray-50 overflow-hidden focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100 transition-all">
            <textarea
              rows={3}
              value={newNote}
              onChange={e => setNewNote(e.target.value)}
              placeholder="Write a note, e.g. 'Member called to discuss payment plan on Jul 15...'"
              className="w-full px-3 pt-2.5 pb-1 text-sm bg-transparent focus:outline-none resize-none text-gray-800 placeholder-gray-400"
            />
            <div className="flex justify-end px-2 pb-2">
              <button
                disabled={!newNote.trim() || addNote.isPending}
                onClick={async () => {
                  if (!newNote.trim()) return
                  await addNote.mutateAsync(newNote.trim())
                  setNewNote('')
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {addNote.isPending ? (
                  <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                ) : (
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                )}
                Add Note
              </button>
            </div>
          </div>

          {/* Notes list */}
          {memberNotes.length === 0 ? (
            <div className="text-center py-6">
              <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-2">
                <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </div>
              <p className="text-sm text-gray-400">No notes yet</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
              {memberNotes.map(note => (
                <div key={note.id} className="group flex gap-2.5">
                  <div className="w-7 h-7 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">
                    {note.author_name?.charAt(0)?.toUpperCase() ?? '?'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="bg-gray-50 border border-gray-100 rounded-xl px-3 py-2 text-sm text-gray-800 leading-relaxed">
                      {note.note}
                    </div>
                    <p className="text-[10px] text-gray-400 mt-1 px-1">
                      {note.author_name} · {formatDateTime(note.created_at)}
                    </p>
                  </div>
                  <button
                    onClick={() => deleteNote.mutate(note.id)}
                    className="opacity-0 group-hover:opacity-100 self-start mt-1 p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-all"
                    title="Delete note"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </Modal>

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
