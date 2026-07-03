import { useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { useEffectiveUserId } from '../../context/ImpersonationContext'
import { useEquitySummary } from '../../hooks/useEquity'
import { useMembershipStatus } from '../../hooks/useMembership'
import { useLoans } from '../../hooks/useLoans'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { Header } from '../../components/layout/Header'
import { StatCard } from '../../components/ui/Card'
import { Card, CardHeader, CardBody } from '../../components/ui/Card'
import { SkeletonPage } from '../../components/shared/Skeleton'
import { formatDateTime, formatDate } from '../../lib/utils'
import { useCurrency } from '../../hooks/useCurrency'
import type { LedgerEntry } from '../../types'

function useDashboardLedger(limit: number) {
  const effectiveUserId = useEffectiveUserId()
  return useQuery({
    queryKey: ['dashboard_ledger', effectiveUserId, limit],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ledger_entries')
        .select('*')
        .eq('user_id', effectiveUserId!)
        .order('created_at', { ascending: false })
        .limit(limit)
      if (error) throw error
      return data as LedgerEntry[]
    },
    enabled: !!effectiveUserId,
  })
}

export function DashboardPage() {
  const [activityLimit, setActivityLimit] = useState(5)
  const { profile } = useAuth()
  const { data: equitySummary, isLoading: equityLoading } = useEquitySummary()
  const { data: membershipStatus, isLoading: membershipLoading } = useMembershipStatus()
  const { data: loans, isLoading: loansLoading } = useLoans()
  const { data: ledgerEntries, isLoading: ledgerLoading } = useDashboardLedger(activityLimit)

  const { format: currency } = useCurrency()
  const isLoading = equityLoading || membershipLoading || loansLoading || ledgerLoading

  const activeLoans = loans?.filter(l => l.status === 'active') ?? []
  const totalOutstanding = activeLoans.reduce((sum, l) => sum + l.outstanding, 0)

  const nextDueDate = activeLoans.reduce<string | null>((earliest, loan) => {
    if (!earliest) return loan.due_date
    return loan.due_date < earliest ? loan.due_date : earliest
  }, null)

  if (isLoading) return <SkeletonPage cards={4} rows={5} />

  return (
    <div>
      <Header
        title={`Welcome back, ${profile?.full_name?.split(' ')[0] ?? 'Member'}`}
        subtitle="Here's an overview of your cooperative account"
      />

      <div className="p-4 sm:p-6 space-y-6">
        {/* Stats grid */}
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
          <StatCard
            title="Total Equity Invested"
            value={currency(equitySummary?.totalInvested ?? 0)}
            subtitle={`${equitySummary?.totalShares ?? 0} share(s) total`}
            icon={
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            }
          />

          <StatCard
            title="Completed Shares"
            value={equitySummary?.completedShares ?? 0}
            subtitle="Fully paid shares"
            icon={
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            }
          />

          <StatCard
            title="Membership Status"
            value={membershipStatus?.status ? (
              membershipStatus.status.charAt(0).toUpperCase() + membershipStatus.status.slice(1)
            ) : 'Pending'}
            subtitle={membershipStatus ? `${membershipStatus.completed_shares} completed share(s)` : 'No shares yet'}
            icon={
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            }
          />

          <StatCard
            title="Loan Outstanding"
            value={currency(totalOutstanding)}
            subtitle={nextDueDate ? `Next due: ${formatDate(nextDueDate)}` : activeLoans.length === 0 ? 'No active loans' : ''}
            icon={
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
            }
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Active Loans Summary */}
          <Card>
            <CardHeader>
              <div>
                <h3 className="text-base font-semibold text-gray-900">Active Loans</h3>
                <p className="text-sm text-gray-500">{activeLoans.length} active loan(s)</p>
              </div>
            </CardHeader>
            <CardBody>
              {activeLoans.length === 0 ? (
                <p className="text-sm text-gray-500 py-4 text-center">No active loans</p>
              ) : (
                <div className="space-y-3">
                  {activeLoans.map(loan => (
                    <div key={loan.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                      <div>
                        <p className="text-sm font-medium text-gray-900">
                          {currency(loan.principal)} loan
                        </p>
                        <p className="text-xs text-gray-500">
                          Due: {formatDate(loan.due_date)}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold text-gray-900">
                          {currency(loan.outstanding)}
                        </p>
                        <p className="text-xs text-gray-500">outstanding</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>

          {/* Recent Ledger Activity */}
          <Card>
            <CardHeader>
              <div>
                <h3 className="text-base font-semibold text-gray-900">Recent Activity</h3>
                <p className="text-sm text-gray-500">
                  Showing {ledgerEntries?.length ?? 0} transaction{(ledgerEntries?.length ?? 0) !== 1 ? 's' : ''}
                </p>
              </div>
            </CardHeader>
            <CardBody>
              {!ledgerEntries || ledgerEntries.length === 0 ? (
                <p className="text-sm text-gray-500 py-4 text-center">No transactions yet</p>
              ) : (
                <>
                  <div className="space-y-3">
                    {ledgerEntries.map(entry => (
                      <div key={entry.id} className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                            entry.direction === 'credit' ? 'bg-green-100' : 'bg-blue-100'
                          }`}>
                            {entry.direction === 'credit' ? (
                              <svg className="w-4 h-4 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
                              </svg>
                            ) : (
                              <svg className="w-4 h-4 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                              </svg>
                            )}
                          </div>
                          <div>
                            <p className="text-sm font-medium text-gray-900">
                              {entry.entry_type.split('_').map(w => w[0].toUpperCase() + w.slice(1)).join(' ')}
                            </p>
                            <p className="text-xs text-gray-400">{formatDateTime(entry.created_at)}</p>
                          </div>
                        </div>
                        <span className={`text-sm font-semibold ${
                          entry.direction === 'credit' ? 'text-green-700' : 'text-gray-900'
                        }`}>
                          {entry.direction === 'credit' ? '+' : '-'}{currency(entry.amount)}
                        </span>
                      </div>
                    ))}
                  </div>
                  {ledgerEntries && ledgerEntries.length >= activityLimit && (
                    <button
                      onClick={() => setActivityLimit(l => l + 10)}
                      className="mt-3 w-full text-center text-xs text-blue-600 hover:text-blue-800 font-medium py-1"
                    >
                      Load more
                    </button>
                  )}
                </>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  )
}
