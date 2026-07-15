import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Header } from '../../components/layout/Header'
import { Card, CardBody, CardHeader } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { SkeletonPage } from '../../components/shared/Skeleton'
import { BatchDepositModal } from '../../components/shared/BatchDepositModal'
import {
  useSavingsAccount,
  useSavingsDepositRequests,
  useSavingsWithdrawalRequests,
  useSavingsContributions,
  useSavingsInterestLogs,
  useSavingsAdb,
  useSavingsDepositsBreakdown,
  type SavingsDepositBreakdown,
} from '../../hooks/useSavings'
import type { SavingsDepositRequest } from '../../types'
import { useCurrency } from '../../hooks/useCurrency'
import { formatDate, formatDateTime } from '../../lib/utils'
import { supabase } from '../../lib/supabase'
import { exportToExcel } from '../../lib/exportExcel'


const statusColors: Record<string, string> = {
  pending:  'bg-yellow-100 text-yellow-800',
  approved: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
}

type Tab = 'overview' | 'deposits' | 'withdrawals'

export function SavingsPage() {
  const navigate = useNavigate()
  const { format: currency } = useCurrency()
  const [tab, setTab] = useState<Tab>('overview')
  const [showDepositModal, setShowDepositModal] = useState(false)
  const [selectedDepositRequest, setSelectedDepositRequest] = useState<SavingsDepositRequest | null>(null)
  const [visibleBreakdownCount, setVisibleBreakdownCount] = useState(10)

  const { data: account, isLoading: accountLoading } = useSavingsAccount()
  const { data: depositRequests = [], isLoading: depositsLoading } = useSavingsDepositRequests()
  const { data: withdrawalRequests = [], isLoading: withdrawalsLoading } = useSavingsWithdrawalRequests()
  const { data: contributions = [] } = useSavingsContributions(account?.id)
  const { data: interestLogs = [] } = useSavingsInterestLogs(account?.id)
  const { data: adbData = { adb: 0, periodDays: 0, accruedInterest: 0 } } = useSavingsAdb(account?.id)
  const { data: depositsBreakdown = [] } = useSavingsDepositsBreakdown(account?.id)

  const { data: interestRate = 2.5 } = useQuery({
    queryKey: ['savings_interest_rate'],
    queryFn: async () => {
      const { data } = await supabase.from('system_config').select('config_value').eq('config_key', 'savings_interest_rate').single()
      return data ? parseFloat(data.config_value) : 2.5
    },
    staleTime: Infinity,
  })

  const { data: interestPeriodMonths = 6 } = useQuery({
    queryKey: ['savings_interest_period_months'],
    queryFn: async () => {
      const { data } = await supabase.from('system_config').select('config_value').eq('config_key', 'savings_interest_period_months').single()
      return data ? parseInt(data.config_value) : 6
    },
    staleTime: Infinity,
  })

  if (accountLoading || depositsLoading || withdrawalsLoading) {
    return <SkeletonPage cards={3} rows={4} />
  }

  if (!account) {
    return (
      <div>
        <Header title="Savings" subtitle="Your savings account" />
        <div className="p-4 sm:p-6">
          <Card className="max-w-lg mx-auto">
            <CardBody className="py-10 text-center">
              <div className="w-14 h-14 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-7 h-7 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                </svg>
              </div>
              <h3 className="text-base font-semibold text-gray-900 mb-1">No Savings Account Yet</h3>
              <p className="text-sm text-gray-500 max-w-xs mx-auto">
                Your savings account will be automatically opened once you complete your first equity share.
              </p>
              <Button variant="outline" size="sm" className="mt-5" onClick={() => navigate('/equity')}>
                View My Shares
              </Button>
            </CardBody>
          </Card>
        </div>
      </div>
    )
  }

  const totalDeposited = contributions.reduce((s, c) => s + c.amount, 0)
  const totalInterest = interestLogs.reduce((s, l) => s + l.interest_earned, 0)
  const pendingDeposits = depositRequests.filter(r => r.status === 'pending').length
  const pendingWithdrawals = withdrawalRequests.filter(r => r.status === 'pending').length

  const { adb, periodDays, accruedInterest } = adbData

  const handleBreakdownRowClick = (row: SavingsDepositBreakdown) => {
    if (!row.request_id) return
    const req = depositRequests.find(r => r.id === row.request_id)
    if (req) setSelectedDepositRequest(req)
  }

  const interestPeriodLabel = interestPeriodMonths === 6 ? 'every 6 months' :
    interestPeriodMonths === 12 ? 'annually' :
    `every ${interestPeriodMonths} months`

  const tabs: { key: Tab; label: string; badge?: number }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'deposits', label: 'Deposits', badge: pendingDeposits },
    { key: 'withdrawals', label: 'Withdrawals', badge: pendingWithdrawals },
  ]

  return (
    <div>
      <Header
        title="Savings"
        subtitle="Your savings account and transaction history"
        actions={
          depositRequests.length > 0 || withdrawalRequests.length > 0 ? (
            <button
              onClick={() => {
                const rows = [
                  ...depositRequests.map(r => ({
                    Type: 'Deposit',
                    Date: formatDate(r.created_at),
                    Amount: r.amount,
                    Method: r.payment_method.replace('_', ' '),
                    Status: r.status,
                    Reference: r.reference ?? '',
                  })),
                  ...withdrawalRequests.map(r => ({
                    Type: 'Withdrawal',
                    Date: formatDate(r.created_at),
                    Amount: r.amount,
                    Method: '',
                    Status: r.status,
                    Reference: '',
                  })),
                ]
                exportToExcel(rows, 'my-savings-history')
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

      <div className="p-4 sm:p-6 space-y-3 sm:space-y-5">

        {/* Action buttons */}
        {account.status === 'active' && (
          <div className="flex gap-2 justify-end">
            <Button size="sm" onClick={() => setShowDepositModal(true)}>
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
            <Button size="sm" variant="outline" onClick={() => navigate('/savings/withdraw')}>
              {/* Banknote with arrow down = withdrawal */}
              <svg className="w-5 h-5 sm:hidden" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
                <rect x="1" y="2" width="22" height="13" rx="2" />
                <circle cx="12" cy="8.5" r="2.5" />
                <line x1="12" y1="6.5" x2="12" y2="10.5" />
                <circle cx="4.5" cy="8.5" r="0.6" fill="currentColor" stroke="none" />
                <circle cx="19.5" cy="8.5" r="0.6" fill="currentColor" stroke="none" />
                <path d="M12 15v7M9.5 19l2.5 3 2.5-3" />
              </svg>
              <span className="hidden sm:inline">Request Withdrawal</span>
            </Button>
          </div>
        )}

        {/* KPI stat row */}
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
          <Card>
            <CardBody className="py-3">
              <div className="flex items-center gap-2 mb-1">
                <svg className="w-4 h-4 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                </svg>
                <p className="text-xs text-gray-500">Current Balance</p>
              </div>
              <p className="text-lg font-bold text-gray-900">{currency(account.balance)}</p>
            </CardBody>
          </Card>
          <Card>
            <CardBody className="py-3">
              <div className="flex items-center gap-2 mb-1">
                <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                <p className="text-xs text-gray-500">Total Deposited</p>
              </div>
              <p className="text-lg font-bold text-gray-900">{currency(totalDeposited)}</p>
            </CardBody>
          </Card>
          <Card>
            <CardBody className="py-3">
              <div className="flex items-center gap-2 mb-1">
                <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                </svg>
                <p className="text-xs text-gray-500">Interest Accrued</p>
              </div>
              <p className="text-lg font-bold text-green-600">
                {currency(totalInterest + accruedInterest)}
              </p>
              {accruedInterest > 0 && totalInterest === 0 && (
                <p className="text-xs text-gray-400 mt-0.5">pending release</p>
              )}
              {totalInterest > 0 && accruedInterest > 0 && (
                <p className="text-xs text-gray-400 mt-0.5">+{currency(accruedInterest)} accruing</p>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardBody className="py-3">
              <div className="flex items-center gap-2 mb-1">
                <svg className="w-4 h-4 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-xs text-gray-500">Interest Rate</p>
              </div>
              <p className="text-lg font-bold text-gray-900">{interestRate}%</p>
              <p className="text-xs text-gray-400 mt-0.5">{interestPeriodLabel}</p>
            </CardBody>
          </Card>
        </div>

        {/* Account status banner */}
        {account.status !== 'active' && (
          <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 text-sm text-orange-800">
            Your savings account is currently <strong className="capitalize">{account.status}</strong>. Contact your cooperative admin for assistance.
          </div>
        )}

        {/* Tabs */}
        <div className="border-b border-gray-200">
          <div className="flex gap-1">
            {tabs.map(t => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors ${
                  tab === t.key
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {t.label}
                {t.badge ? (
                  <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-yellow-400 text-yellow-900 text-[10px] font-bold">{t.badge}</span>
                ) : null}
              </button>
            ))}
          </div>
        </div>

        {/* Overview tab */}
        {tab === 'overview' && (
          <div className="space-y-4">
            {/* Interest period tracker */}
            {(() => {
              const totalPeriodDays = Math.round(interestPeriodMonths * (365 / 12))
              const progress = Math.min(1, periodDays / totalPeriodDays)
              const projectedInterest = adb * (interestRate / 100)
              const daysRemaining = Math.max(0, totalPeriodDays - periodDays)
              return (
                <Card>
                  <CardBody>
                    {periodDays === 0 ? (
                      <div className="text-center py-2">
                        <p className="text-sm font-medium text-gray-700">Interest Period</p>
                        <p className="text-xs text-gray-400 mt-1">ADB tracking starts tomorrow after your first deposit is 24h old.</p>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {/* Header row */}
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-semibold text-gray-800">Current Interest Period</p>
                          <span className="text-xs font-medium text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
                            Day {periodDays} of {totalPeriodDays}
                          </span>
                        </div>

                        {/* Progress bar */}
                        <div>
                          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                            <div
                              className="h-2 bg-blue-500 rounded-full transition-all"
                              style={{ width: `${progress * 100}%` }}
                            />
                          </div>
                          <div className="flex justify-between mt-1">
                            <span className="text-xs text-gray-400">{periodDays}d elapsed</span>
                            <span className="text-xs text-gray-400">{daysRemaining}d remaining</span>
                          </div>
                        </div>

                        {/* Summary row */}
                        <div className="grid grid-cols-3 gap-2 pt-1">
                          <div className="bg-gray-50 rounded-lg px-2.5 py-2.5">
                            <p className="text-[10px] leading-tight text-gray-500 mb-1 whitespace-nowrap">Avg Daily</p>
                            <p className="text-sm font-bold text-gray-900 truncate">{currency(adb)}</p>
                          </div>
                          <div className="bg-green-50 rounded-lg px-2.5 py-2.5">
                            <p className="text-[10px] leading-tight text-gray-500 mb-1 whitespace-nowrap">Accrued</p>
                            <p className="text-sm font-bold text-green-700 truncate">{currency(accruedInterest)}</p>
                          </div>
                          <div className="bg-blue-50 rounded-lg px-2.5 py-2.5">
                            <p className="text-[10px] leading-tight text-gray-500 mb-1 whitespace-nowrap">Projected</p>
                            <p className="text-sm font-bold text-blue-700 truncate">{currency(projectedInterest)}</p>
                          </div>
                        </div>

                        {/* Per-deposit breakdown */}
                        {depositsBreakdown.length > 0 && (
                          <div className="border border-gray-100 rounded-lg overflow-hidden">
                            <div className="divide-y divide-gray-100">
                              {depositsBreakdown.slice(0, visibleBreakdownCount).map(row => (
                                <div
                                  key={row.contribution_id}
                                  onClick={() => handleBreakdownRowClick(row)}
                                  className={`px-3 py-3 flex items-start justify-between gap-4 hover:bg-gray-50 transition-colors ${row.request_id ? 'cursor-pointer' : ''}`}
                                >
                                  <div className="min-w-0">
                                    <p className="text-sm text-gray-700">{formatDate(row.contributed_at)}</p>
                                    {row.reference
                                      ? <p className="text-xs text-gray-400 mt-0.5">#{row.reference}</p>
                                      : <p className="text-xs text-gray-300 mt-0.5">No reference</p>
                                    }
                                  </div>
                                  <div className="shrink-0 text-right">
                                    <p className="text-sm font-semibold text-green-700">{currency(row.accrued_interest)}</p>
                                    <p className="text-xs text-gray-400 mt-0.5">{currency(row.amount)}</p>
                                  </div>
                                </div>
                              ))}
                            </div>
                            {visibleBreakdownCount < depositsBreakdown.length && (
                              <div className="border-t border-gray-100">
                                <button
                                  onClick={() => setVisibleBreakdownCount(c => c + 10)}
                                  className="w-full py-2.5 text-xs font-medium text-blue-600 hover:bg-blue-50 transition-colors"
                                >
                                  Load more ({depositsBreakdown.length - visibleBreakdownCount} remaining)
                                </button>
                              </div>
                            )}
                            <div className="bg-gray-50 border-t border-gray-200 px-3 py-2.5 flex justify-between items-center">
                              <span className="text-xs font-semibold text-gray-600">Total Accrued</span>
                              <span className="text-sm font-bold text-green-700">{currency(accruedInterest)}</span>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </CardBody>
                </Card>
              )
            })()}

            {interestLogs.length > 0 && (
              <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 flex items-center justify-between text-sm">
                <span className="text-green-700">Last interest credited</span>
                <span className="font-medium text-green-800">{formatDate(interestLogs[0].created_at)}</span>
              </div>
            )}

          </div>
        )}

        {/* Deposits tab */}
        {tab === 'deposits' && (
          <Card>
            <CardHeader>
              <h3 className="text-sm font-semibold text-gray-900">Deposit Requests</h3>
            </CardHeader>
            {depositRequests.length === 0 ? (
              <CardBody>
                <p className="text-sm text-gray-400 text-center py-6">No deposit requests yet.</p>
              </CardBody>
            ) : (
              <div className="divide-y divide-gray-100">
                {depositRequests.map(req => (
                  <div key={req.id} className="px-4 py-3 flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-sm text-gray-700">{formatDate(req.created_at)}</p>
                      <p className="text-xs text-gray-400 mt-0.5 capitalize">
                        {req.payment_method.replace('_', ' ')}
                        {req.reference && <span> · #{req.reference}</span>}
                      </p>
                      {req.status === 'rejected' && req.rejection_reason && (
                        <p className="text-xs text-red-500 mt-0.5">{req.rejection_reason}</p>
                      )}
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-semibold text-gray-900">{currency(req.amount)}</p>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize mt-1 ${statusColors[req.status]}`}>
                        {req.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}

        {/* Withdrawals tab */}
        {tab === 'withdrawals' && (
          <Card>
            <CardHeader>
              <h3 className="text-sm font-semibold text-gray-900">Withdrawal Requests</h3>
            </CardHeader>
            {withdrawalRequests.length === 0 ? (
              <CardBody>
                <p className="text-sm text-gray-400 text-center py-6">No withdrawal requests yet.</p>
              </CardBody>
            ) : (
              <div className="divide-y divide-gray-100">
                {withdrawalRequests.map(req => (
                  <div key={req.id} className="px-4 py-3 flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-sm text-gray-700">{formatDate(req.created_at)}</p>
                      {req.reason && <p className="text-xs text-gray-400 mt-0.5 truncate max-w-[180px]">{req.reason}</p>}
                      {req.status === 'rejected' && req.rejection_reason && (
                        <p className="text-xs text-red-500 mt-0.5">{req.rejection_reason}</p>
                      )}
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-semibold text-gray-900">{currency(req.amount)}</p>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize mt-1 ${statusColors[req.status]}`}>
                        {req.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}

      </div>

      <BatchDepositModal
        isOpen={showDepositModal}
        onClose={() => setShowDepositModal(false)}
        defaultType="savings"
      />

      {/* Deposit request detail modal */}
      {selectedDepositRequest && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setSelectedDepositRequest(null)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-start justify-between mb-5">
              <div>
                <h3 className="text-base font-semibold text-gray-900">Deposit Request</h3>
                <p className="text-xs text-gray-400 mt-0.5">{formatDateTime(selectedDepositRequest.created_at)}</p>
              </div>
              <button onClick={() => setSelectedDepositRequest(null)} className="text-gray-400 hover:text-gray-600 transition-colors">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="space-y-3">
              <div className="flex justify-between items-center py-2 border-b border-gray-100">
                <span className="text-sm text-gray-500">Amount</span>
                <span className="text-sm font-bold text-gray-900">{currency(selectedDepositRequest.amount)}</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-gray-100">
                <span className="text-sm text-gray-500">Status</span>
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize ${statusColors[selectedDepositRequest.status]}`}>
                  {selectedDepositRequest.status}
                </span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-gray-100">
                <span className="text-sm text-gray-500">Payment Method</span>
                <span className="text-sm text-gray-800 capitalize">{selectedDepositRequest.payment_method.replace('_', ' ')}</span>
              </div>
              {selectedDepositRequest.reference && (
                <div className="flex justify-between items-center py-2 border-b border-gray-100">
                  <span className="text-sm text-gray-500">Reference</span>
                  <span className="text-sm font-semibold text-gray-800 tracking-wide">#{selectedDepositRequest.reference}</span>
                </div>
              )}
              {selectedDepositRequest.notes && (
                <div className="flex justify-between items-start py-2 border-b border-gray-100 gap-4">
                  <span className="text-sm text-gray-500 shrink-0">Notes</span>
                  <span className="text-sm text-gray-700 text-right">{selectedDepositRequest.notes}</span>
                </div>
              )}
              {selectedDepositRequest.rejection_reason && (
                <div className="flex justify-between items-start py-2 border-b border-gray-100 gap-4">
                  <span className="text-sm text-gray-500 shrink-0">Rejection Reason</span>
                  <span className="text-sm text-red-600 text-right">{selectedDepositRequest.rejection_reason}</span>
                </div>
              )}
              {selectedDepositRequest.reviewed_at && (
                <div className="flex justify-between items-center py-2">
                  <span className="text-sm text-gray-500">Reviewed At</span>
                  <span className="text-sm text-gray-700">{formatDateTime(selectedDepositRequest.reviewed_at)}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
