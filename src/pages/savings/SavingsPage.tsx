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

  const { data: weeklyCap = 5000 } = useQuery({
    queryKey: ['savings_weekly_cap'],
    queryFn: async () => {
      const { data } = await supabase
        .from('system_config')
        .select('config_value')
        .eq('config_key', 'savings_weekly_cap')
        .single()
      return data ? parseFloat(data.config_value) : 5000
    },
    staleTime: Infinity,
  })

  if (accountLoading || depositsLoading || withdrawalsLoading) {
    return <SkeletonPage cards={4} rows={4} />
  }

  // No account yet — shares not completed
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
              <Button
                variant="outline"
                size="sm"
                className="mt-5"
                onClick={() => navigate('/equity')}
              >
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

  const weekStart = new Date()
  weekStart.setHours(0, 0, 0, 0)
  weekStart.setDate(weekStart.getDate() - weekStart.getDay())
  const weeklyTotal = contributions
    .filter(c => new Date(c.contributed_at) >= weekStart)
    .reduce((s, c) => s + c.amount, 0)
  const weeklyRemaining = Math.max(0, weeklyCap - weeklyTotal)

  const tabs: { key: Tab; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'deposits', label: 'Deposits' },
    { key: 'withdrawals', label: 'Withdrawals' },
    { key: 'interest', label: 'Interest' },
  ]

  return (
    <div>
      <Header
        title="Savings"
        subtitle="Your savings account and transaction history"
      />

      <div className="p-4 sm:p-6 space-y-6">
        {/* KPI cards */}
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
          <Card>
            <CardBody>
              <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">Balance</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">{currency(account.balance)}</p>
            </CardBody>
          </Card>
          <Card>
            <CardBody>
              <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">Total Deposited</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">{currency(totalDeposited)}</p>
            </CardBody>
          </Card>
          <Card>
            <CardBody>
              <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">Interest Earned</p>
              <p className="text-2xl font-bold text-green-600 mt-1">{currency(totalInterest)}</p>
            </CardBody>
          </Card>
          <Card>
            <CardBody>
              <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">Pending Requests</p>
              <p className="text-2xl font-bold text-yellow-600 mt-1">{pendingDeposits + pendingWithdrawals}</p>
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
                className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors ${
                  tab === t.key
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Overview tab */}
        {tab === 'overview' && (
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <h3 className="text-sm font-semibold text-gray-900">Account Details</h3>
              </CardHeader>
              <CardBody>
                <div className="divide-y divide-gray-100">
                  <div className="flex justify-between py-2.5 text-sm">
                    <span className="text-gray-500">Status</span>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize ${
                      account.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'
                    }`}>{account.status}</span>
                  </div>
                  <div className="flex justify-between py-2.5 text-sm">
                    <span className="text-gray-500">Account opened</span>
                    <span className="text-gray-900">{formatDate(account.opened_at)}</span>
                  </div>
                  <div className="flex justify-between py-2.5 text-sm">
                    <span className="text-gray-500">Current balance</span>
                    <span className="font-semibold text-gray-900">{currency(account.balance)}</span>
                  </div>
                  <div className="flex justify-between py-2.5 text-sm">
                    <span className="text-gray-500">Weekly deposited</span>
                    <span className="text-gray-900">{currency(weeklyTotal)} / {currency(weeklyCap)}</span>
                  </div>
                  <div className="flex justify-between py-2.5 text-sm">
                    <span className="text-gray-500">Weekly remaining cap</span>
                    <span className={`font-medium ${weeklyRemaining === 0 ? 'text-red-600' : 'text-gray-900'}`}>
                      {currency(weeklyRemaining)}
                    </span>
                  </div>
                  {interestLogs.length > 0 && (
                    <div className="flex justify-between py-2.5 text-sm">
                      <span className="text-gray-500">Last interest credited</span>
                      <span className="text-gray-900">{formatDate(interestLogs[0].created_at)}</span>
                    </div>
                  )}
                </div>
              </CardBody>
            </Card>

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

        {/* Interest History tab */}
        {tab === 'interest' && (
          <Card>
            <CardHeader>
              <h3 className="text-sm font-semibold text-gray-900">Interest History</h3>
              <p className="text-xs text-gray-500 mt-0.5">Interest is credited every 6 months at 2.5%.</p>
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
                      <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase">Interest Earned</th>
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
