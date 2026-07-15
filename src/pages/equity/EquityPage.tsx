import { useState } from 'react'
import { Header } from '../../components/layout/Header'
import { Card, CardHeader, CardBody } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { StatusBadge } from '../../components/shared/StatusBadge'
import { SkeletonPage } from '../../components/shared/Skeleton'
import { ReceiptModal } from '../../components/shared/ReceiptModal'
import { BatchDepositModal } from '../../components/shared/BatchDepositModal'
import { useEquityShares, useEquitySummary } from '../../hooks/useEquity'
import { useMyDepositRequests } from '../../hooks/useDepositRequests'
import { formatDate, getProgressPercent } from '../../lib/utils'
import { useCurrency } from '../../hooks/useCurrency'
import { exportToExcel } from '../../lib/exportExcel'
import { useAuth } from '../../context/AuthContext'
import { ShareTransferModal } from './ShareTransferModal'
import type { EquityShare } from '../../types'

export function EquityPage() {
  const { profile } = useAuth()
  const { data: shares, isLoading } = useEquityShares()
  const { data: summary } = useEquitySummary()
  const { data: myDepositRequests = [] } = useMyDepositRequests()
  const [receiptModal, setReceiptModal] = useState<{ url: string; details: any } | null>(null)
  const [transferShare, setTransferShare] = useState<EquityShare | null>(null)
  const [visibleDepositCount, setVisibleDepositCount] = useState(5)
  const [showDepositModal, setShowDepositModal] = useState(false)

  const profileIncomplete = !profile?.profile_completed_at
  const { format: currency } = useCurrency()
  const hasInProgressShare = shares?.some(s => s.status === 'in_progress') ?? false
  const firstCompletedShare = shares?.find(s => s.status === 'completed') ?? null
  if (isLoading) return <SkeletonPage cards={3} rows={4} />

  return (
    <div>
      <Header
        title="Equity Shares"
        subtitle="Manage your cooperative equity contributions"
        actions={
          myDepositRequests.length > 0 ? (
            <button
              onClick={() => {
                const rows = myDepositRequests.map(r => ({
                  Date: formatDate(r.created_at),
                  Amount: r.amount,
                  Method: r.payment_method.replace('_', ' '),
                  Status: r.status,
                  Reference: r.reference ?? '',
                }))
                exportToExcel(rows, 'my-deposit-requests')
              }}
              title="Export to Excel"
              className="inline-flex items-center gap-1.5 border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" />
              </svg>
              <span className="hidden sm:inline">Export</span>
            </button>
          ) : undefined
        }
      />

      <div className="p-4 sm:p-6 space-y-3 sm:space-y-6">
        {/* Action buttons */}
        {(hasInProgressShare || firstCompletedShare) && (
          <div className="flex gap-2 justify-end">
            {hasInProgressShare && (
              <Button
                size="sm"
                onClick={() => setShowDepositModal(true)}
                disabled={profileIncomplete}
                title={profileIncomplete ? 'Complete your profile first' : undefined}
              >
                {/* Banknote with arrow up = deposit */}
                <svg className="w-5 h-5 sm:hidden" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
                  <rect x="1" y="2" width="22" height="13" rx="2" />
                  <circle cx="12" cy="8.5" r="2.5" />
                  <line x1="12" y1="6.5" x2="12" y2="10.5" />
                  <circle cx="4.5" cy="8.5" r="0.6" fill="currentColor" stroke="none" />
                  <circle cx="19.5" cy="8.5" r="0.6" fill="currentColor" stroke="none" />
                  <path d="M12 22v-7M9.5 18l2.5-3 2.5 3" />
                </svg>
                <span className="hidden sm:inline">Make a Deposit</span>
              </Button>
            )}
            {firstCompletedShare && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setTransferShare(firstCompletedShare)}
              >
                <svg className="w-4 h-4 sm:hidden" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                </svg>
                <span className="hidden sm:inline">Transfer Share</span>
              </Button>
            )}
          </div>
        )}

        {/* Summary */}
        <div className="grid grid-cols-3 gap-3">
          {[
            {
              label: 'Total Invested',
              value: currency(summary?.totalInvested ?? 0),
              icon: (
                <svg className="w-4 h-4 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              ),
            },
            {
              label: 'Completed',
              value: summary?.completedShares ?? 0,
              icon: (
                <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              ),
            },
            {
              label: 'Total Shares',
              value: summary?.totalShares ?? 0,
              icon: (
                <svg className="w-4 h-4 text-purple-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
              ),
            },
          ].map(c => (
            <div key={c.label} className="bg-white rounded-xl border border-gray-200 p-3 sm:p-4">
              <div className="mb-1.5">{c.icon}</div>
              <p className="text-[10px] sm:text-xs text-gray-500 leading-tight mb-1">{c.label}</p>
              <p className="text-sm sm:text-lg font-semibold text-gray-900">{c.value}</p>
            </div>
          ))}
        </div>

        {/* Shares List */}
        {!shares || shares.length === 0 ? (
          <Card>
            <CardBody className="py-12 text-center">
              <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h3 className="text-base font-semibold text-gray-900 mb-1">No shares yet</h3>
              <p className="text-sm text-gray-500">
                Equity shares are opened by cooperative staff. Please contact your administrator to get started.
              </p>
            </CardBody>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {shares.map(share => {
              const progress = getProgressPercent(share.paid_amount, share.target_amount)
              const remaining = share.target_amount - share.paid_amount

              return (
                <Card key={share.id} className="flex flex-col">
                  <CardHeader
                    action={<StatusBadge status={share.status} />}
                  >
                    <h3 className="font-semibold text-gray-900">Share #{share.share_number}</h3>
                    <p className="text-xs text-gray-400 mt-0.5">
                      Opened {formatDate(share.created_at)}
                    </p>
                  </CardHeader>
                  <CardBody className="flex flex-col flex-1">
                    {/* Progress bar */}
                    <div className="mb-4">
                      <div className="flex justify-between text-sm mb-1.5">
                        <span className="text-gray-500">{currency(share.paid_amount)} paid</span>
                        <span className="font-medium text-gray-900">{progress}%</span>
                      </div>
                      <div className="w-full bg-gray-100 rounded-full h-2.5">
                        <div
                          className={`h-2.5 rounded-full transition-all ${
                            share.status === 'completed' ? 'bg-green-500' : 'bg-blue-500'
                          }`}
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                      <div className="flex items-center justify-between mt-1.5">
                        <p className="text-xs text-gray-400">Target: {currency(share.target_amount)}</p>
                        {share.status === 'in_progress' && (
                          <p className="text-xs text-gray-500">Remaining: <span className="font-medium text-gray-700">{currency(remaining)}</span></p>
                        )}
                      </div>
                    </div>

                    {share.status === 'completed' ? (
                      <div className="mt-auto" />
                    ) : share.status === 'in_progress' ? (
                      <div className="space-y-2 mt-auto">
                        {profileIncomplete && (
                          <button
                            type="button"
                            onClick={() => window.dispatchEvent(new Event('open-profile-completion'))}
                            className="text-xs text-amber-600 text-center underline font-medium w-full"
                          >
                            Complete your profile to submit deposits.
                          </button>
                        )}
                      </div>
                    ) : (
                      <p className="text-sm text-gray-400 italic">Share cancelled</p>
                    )}
                  </CardBody>
                </Card>
              )
            })}
          </div>
        )}

        {/* My Deposit Requests */}
        {myDepositRequests.length > 0 && (
          <div>
            <h2 className="text-base font-semibold text-gray-900 mb-3">My Deposit Requests</h2>
            <div className="space-y-2">
              {myDepositRequests.slice(0, visibleDepositCount).map(req => {
                const clickable = !!req.receipt_url
                return (
                  <div
                    key={req.id}
                    onClick={() => clickable && setReceiptModal({ url: req.receipt_url!, details: { amount: currency(req.amount), date: req.created_at, method: req.payment_method, reference: req.reference } })}
                    className={`bg-white rounded-xl border border-gray-200 px-4 py-3 flex items-center justify-between gap-3 ${clickable ? 'cursor-pointer hover:border-blue-300 hover:bg-blue-50 transition-colors' : ''}`}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm text-gray-900">{currency(req.amount)}</p>
                      <p className="text-xs text-gray-400 mt-0.5 capitalize">
                        {req.payment_method.replace('_', ' ')} · {formatDate(req.created_at)}
                        {req.reference && <span> · #{req.reference}</span>}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <StatusBadge status={req.status} />
                      {clickable && (
                        <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                        </svg>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
            {visibleDepositCount < myDepositRequests.length && (
              <button
                onClick={() => setVisibleDepositCount(c => c + 5)}
                className="mt-2 w-full py-2 text-xs font-medium text-blue-600 hover:text-blue-700 transition-colors"
              >
                Load more ({myDepositRequests.length - visibleDepositCount} remaining)
              </button>
            )}
          </div>
        )}
      </div>

      {receiptModal && (
        <ReceiptModal
          isOpen={!!receiptModal}
          onClose={() => setReceiptModal(null)}
          receiptUrl={receiptModal.url}
          details={receiptModal.details}
        />
      )}

      {transferShare && (
        <ShareTransferModal
          share={transferShare}
          onClose={() => setTransferShare(null)}
        />
      )}

      <BatchDepositModal
        isOpen={showDepositModal}
        onClose={() => setShowDepositModal(false)}
        defaultType="shares"
      />
    </div>
  )
}
