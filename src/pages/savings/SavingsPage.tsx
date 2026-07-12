import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Header } from '../../components/layout/Header'
import { Card, CardBody, CardHeader } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { SkeletonPage } from '../../components/shared/Skeleton'
import {
  useSavingsAccount,
  useSavingsDepositRequests,
  useSavingsWithdrawalRequests,
  useSavingsContributions,
  useSavingsInterestLogs,
} from '../../hooks/useSavings'
import { useCurrency } from '../../hooks/useCurrency'
import { formatDate, formatDateTime } from '../../lib/utils'
import { supabase } from '../../lib/supabase'


const statusColors: Record<string, string> = {
  pending:  'bg-yellow-100 text-yellow-800',
  approved: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
}

type Tab = 'overview' | 'deposits' | 'withdrawals' | 'interest'

export function SavingsPage() {
  const navigate = useNavigate()
  const { format: currency } = useCurrency()
  const [tab, setTab] = useState<Tab>('overview')

  const { data: account, isLoading: accountLoading } = useSavingsAccount()
  const { data: depositRequests = [], isLoading: depositsLoading } = useSavingsDepositRequests()
  const { data: withdrawalRequests = [], isLoading: withdrawalsLoading } = useSavingsWithdrawalRequests()
  const { data: contributions = [] } = useSavingsContributions(account?.id)
  const { data: interestLogs = [] } = useSavingsInterestLogs(account?.id)

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

  // Approximate average daily balance for the current period (mirrors the RPC calculation).
  // Period start = last interest log date, or account opening.
  const periodStartTs = interestLogs.length > 0
    ? new Date(interestLogs[0].created_at)   // interestLogs is ordered desc, so [0] = most recent
    : account ? new Date(account.opened_at) : new Date()
  const periodEndTs = new Date()
  const periodDays = Math.max(1, (periodEndTs.getTime() - periodStartTs.getTime()) / 86400_000)

  // Balance at start of period = current balance minus contributions made during the period
  const contributionsDuringPeriod = contributions.filter(c => new Date(c.contributed_at) > periodStartTs)
  const balanceAtStart = Math.max(0,
    (account?.balance ?? 0) - contributionsDuringPeriod.reduce((s, c) => s + c.amount, 0)
  )

  // ADB = balance_at_start + SUM(deposit × days_remaining / period_days)
  const adb = Math.max(0,
    balanceAtStart +
    contributionsDuringPeriod.reduce((s, c) => {
      const daysHeld = Math.max(0, (periodEndTs.getTime() - new Date(c.contributed_at).getTime()) / 86400_000)
      return s + c.amount * (daysHeld / periodDays)
    }, 0)
  )

  const interestPeriodLabel = interestPeriodMonths === 6 ? 'every 6 months' :
    interestPeriodMonths === 12 ? 'annually' :
    `every ${interestPeriodMonths} months`

  const tabs: { key: Tab; label: string; badge?: number }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'deposits', label: 'Deposits', badge: pendingDeposits },
    { key: 'withdrawals', label: 'Withdrawals', badge: pendingWithdrawals },
    { key: 'interest', label: 'Interest' },
  ]

  return (
    <div>
      <Header title="Savings" subtitle="Your savings account and transaction history" />

      <div className="p-4 sm:p-6 space-y-5">

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
              <div className="flex items-center gap-1.5 mt-1">
                <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium capitalize ${
                  account.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                }`}>{account.status}</span>
                <span className="text-xs text-gray-400">· Opened {formatDate(account.opened_at)}</span>
              </div>
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
                <p className="text-xs text-gray-500">Interest Earned</p>
              </div>
              <p className="text-lg font-bold text-green-600">{currency(totalInterest)}</p>
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
            {/* Average daily balance */}
            <Card>
              <CardBody>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-gray-700">Average Daily Balance</p>
                    <p className="text-2xl font-bold text-gray-900 mt-0.5">{currency(adb)}</p>
                    <p className="text-xs text-gray-400 mt-1">
                      Interest is calculated on this amount — deposits earn proportional to how long they're held
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs text-gray-400">Period</p>
                    <p className="text-xs font-medium text-gray-600">{Math.round(periodDays)}d so far</p>
                  </div>
                </div>
              </CardBody>
            </Card>

            {interestLogs.length > 0 && (
              <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 flex items-center justify-between text-sm">
                <span className="text-green-700">Last interest credited</span>
                <span className="font-medium text-green-800">{formatDate(interestLogs[0].created_at)}</span>
              </div>
            )}

            {account.status === 'active' && (
              <div className="flex gap-3">
                <Button className="flex-1" onClick={() => navigate('/savings/deposit-request')}>
                  Make a Deposit
                </Button>
                <Button variant="outline" className="flex-1" onClick={() => navigate('/savings/withdraw')}>
                  Request Withdrawal
                </Button>
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
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Date</th>
                      <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase">Amount</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Method</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Reference</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {depositRequests.map(req => (
                      <tr key={req.id}>
                        <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{formatDateTime(req.created_at)}</td>
                        <td className="px-4 py-3 text-right font-medium text-gray-900">{currency(req.amount)}</td>
                        <td className="px-4 py-3 text-gray-600 capitalize">{req.payment_method.replace('_', ' ')}</td>
                        <td className="px-4 py-3 text-gray-500 font-mono text-xs">{req.reference ?? '—'}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize ${statusColors[req.status]}`}>
                            {req.status}
                          </span>
                          {req.status === 'rejected' && req.rejection_reason && (
                            <p className="text-xs text-red-500 mt-0.5">{req.rejection_reason}</p>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Date</th>
                      <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase">Amount</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Reason</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {withdrawalRequests.map(req => (
                      <tr key={req.id}>
                        <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{formatDateTime(req.created_at)}</td>
                        <td className="px-4 py-3 text-right font-medium text-gray-900">{currency(req.amount)}</td>
                        <td className="px-4 py-3 text-gray-600">{req.reason ?? '—'}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize ${statusColors[req.status]}`}>
                            {req.status}
                          </span>
                          {req.status === 'rejected' && req.rejection_reason && (
                            <p className="text-xs text-red-500 mt-0.5">{req.rejection_reason}</p>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        )}

        {/* Interest tab */}
        {tab === 'interest' && (
          <Card>
            <CardHeader>
              <h3 className="text-sm font-semibold text-gray-900">Interest History</h3>
              <p className="text-xs text-gray-500 mt-0.5">
                Interest is credited {interestPeriodLabel} at <strong>{interestRate}%</strong>.
              </p>
            </CardHeader>
            {interestLogs.length === 0 ? (
              <CardBody>
                <p className="text-sm text-gray-400 text-center py-6">No interest has been credited yet.</p>
              </CardBody>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Period</th>
                      <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase">Principal</th>
                      <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase">Interest</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Credited</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {interestLogs.map(log => (
                      <tr key={log.id}>
                        <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                          {formatDate(log.period_start)} – {formatDate(log.period_end)}
                        </td>
                        <td className="px-4 py-3 text-right text-gray-700">{currency(log.principal_at_time)}</td>
                        <td className="px-4 py-3 text-right font-semibold text-green-700">{currency(log.interest_earned)}</td>
                        <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{formatDate(log.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        )}
      </div>
    </div>
  )
}
