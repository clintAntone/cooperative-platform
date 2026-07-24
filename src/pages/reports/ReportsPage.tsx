import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
// @ts-ignore - recharts not in devDependencies yet
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line,
} from 'recharts'
import { Header } from '../../components/layout/Header'
import { StatCard, Card, CardHeader, CardBody } from '../../components/ui/Card'
import { SkeletonPage } from '../../components/shared/Skeleton'
import { StatusBadge } from '../../components/shared/StatusBadge'
import { Table, Thead, Tbody, Th, Tr, Td } from '../../components/ui/Table'
import { supabase } from '../../lib/supabase'
import { useCurrency } from '../../hooks/useCurrency'
import { formatNumber } from '../../lib/utils'
import { useMembershipBreakdown } from '../../hooks/useMembership'
import { useLoanPortfolioStats } from '../../hooks/useLoans'
import { useMonthlyContributions, useMonthlyNewMembers } from '../../hooks/useReports'
import { exportToExcel } from '../../lib/exportExcel'
import { exportMembersPdf, exportLoanPortfolioPdf } from '../../lib/exportPdf'

function useLoanConfigured() {
  return useQuery({
    queryKey: ['loan_configured'],
    queryFn: async () => {
      const { count } = await supabase
        .from('loan_products')
        .select('*', { count: 'exact', head: true })
        .eq('is_active', true)
      return (count ?? 0) > 0
    },
    staleTime: 60_000,
  })
}

function useTotalEquity() {
  return useQuery({
    queryKey: ['total_equity'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('equity_contributions')
        .select('amount')

      if (error) throw error
      const total = (data as { amount: number }[]).reduce((sum, row) => sum + row.amount, 0)
      return total
    },
  })
}

function useMemberList(dateFrom: string, dateTo: string) {
  return useQuery({
    queryKey: ['member_list_report', dateFrom, dateTo],
    queryFn: async () => {
      let query = supabase
        .from('profiles')
        .select('id, full_name, role, account_status, created_at, membership_status(status, completed_shares)')
        .eq('role', 'member')
        .order('created_at', { ascending: false })

      if (dateFrom) query = query.gte('created_at', dateFrom)
      if (dateTo) query = query.lte('created_at', dateTo + 'T23:59:59.999Z')

      const { data, error } = await query
      if (error) throw error
      return data
    },
  })
}

function useAllLoans(dateFrom: string, dateTo: string) {
  return useQuery({
    queryKey: ['all_loans_report', dateFrom, dateTo],
    queryFn: async () => {
      let query = supabase
        .from('loans')
        .select('principal, outstanding, status, disbursed_at, user_id')
        .order('created_at', { ascending: false })

      if (dateFrom) query = query.gte('disbursed_at', dateFrom)
      if (dateTo) query = query.lte('disbursed_at', dateTo + 'T23:59:59.999Z')

      const { data, error } = await query
      if (error) throw error

      const userIds = [...new Set((data as any[]).map(r => r.user_id).filter(Boolean))]
      let nameMap: Record<string, string> = {}
      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, full_name')
          .in('id', userIds)
        if (profiles) {
          nameMap = Object.fromEntries((profiles as any[]).map(p => [p.id, p.full_name]))
        }
      }

      return (data as any[]).map(r => ({
        member_name: nameMap[r.user_id] ?? 'Unknown',
        amount: r.principal,
        outstanding: r.outstanding,
        status: r.status,
        disbursed_at: r.disbursed_at,
      }))
    },
    staleTime: 60_000,
  })
}

function CurrencyTooltip({ active, payload, label, symbol = '₱' }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-sm px-3 py-2 text-sm">
      <p className="text-gray-500 mb-1">{label}</p>
      <p className="font-semibold text-gray-900">
        {symbol}{new Intl.NumberFormat('en-PH', { minimumFractionDigits: 2 }).format(payload[0].value)}
      </p>
    </div>
  )
}

export function ReportsPage() {
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState<'summary' | 'members' | 'loans'>('summary')

  // Members tab state
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const { data: membershipBreakdown, isLoading: breakdownLoading } = useMembershipBreakdown()
  const { data: totalEquity, isLoading: equityLoading } = useTotalEquity()
  const { data: loanStats, isLoading: loanStatsLoading } = useLoanPortfolioStats()
  const { data: loanConfigured = false } = useLoanConfigured()
  const { data: membersRaw, isLoading: membersLoading } = useMemberList(dateFrom, dateTo)
  const { data: contributions = [], isLoading: contributionsLoading } = useMonthlyContributions()
  const { data: newMembers = [], isLoading: newMembersLoading } = useMonthlyNewMembers()
  const { data: allLoans = [] } = useAllLoans('', '')

  const members = (membersRaw ?? []).map((m: any) => ({
    ...m,
    membership_status: Array.isArray(m.membership_status)
      ? m.membership_status[0] ?? null
      : m.membership_status ?? null,
  }))

  const filteredMembers = members.filter((m: any) => {
    const matchesSearch = m.full_name.toLowerCase().includes(search.toLowerCase())
    const ms = m.membership_status?.status ?? 'pending'
    const matchesStatus = statusFilter === 'all' || ms === statusFilter
    return matchesSearch && matchesStatus
  })

  const isLoading = breakdownLoading || equityLoading || loanStatsLoading || membersLoading || contributionsLoading || newMembersLoading

  const { format: currency, symbol: currencySymbol } = useCurrency()

  const totalMembers = membershipBreakdown
    ? Object.values(membershipBreakdown).reduce((a, b) => a + b, 0)
    : 0

  const hasDateFilter = !!(dateFrom || dateTo)

  const TABS = [
    { key: 'summary' as const, label: 'Summary' },
    { key: 'members' as const, label: 'Members' },
    { key: 'loans' as const, label: 'Loans' },
  ]

  return (
    <div>
      <Header
        title="Reports"
        subtitle="Platform-wide analytics and export hub"
      />

      {/* Tab bar */}
      <div className="border-b border-gray-200 px-4 sm:px-6 overflow-x-auto">
        <div className="flex w-max min-w-full sm:w-auto">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors border-b-2 -mb-px ${
                activeTab === t.key
                  ? 'text-blue-600 border-blue-600'
                  : 'text-gray-500 border-transparent hover:text-gray-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="p-4 sm:p-6 space-y-6">

        {/* ── Summary Tab ─────────────────────────────────────────────────── */}
        {activeTab === 'summary' && (
          <>
            {isLoading ? <SkeletonPage cards={4} rows={6} /> : (
              <>
                {/* Key Stats */}
                <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4 [&>*:last-child]:col-span-2 xl:[&>*:last-child]:col-span-1">
                  <StatCard
                    title="Total Members"
                    value={formatNumber(totalMembers)}
                    subtitle="Registered members"
                    icon={
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                    }
                  />
                  <StatCard
                    title="Active Members"
                    value={formatNumber(membershipBreakdown?.active ?? 0)}
                    subtitle={`${formatNumber(membershipBreakdown?.pending ?? 0)} pending`}
                    icon={
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    }
                  />
                  <StatCard
                    title="Total Equity Raised"
                    value={currency(totalEquity ?? 0)}
                    subtitle="All contributions"
                    icon={
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    }
                  />
                  <StatCard
                    title="Loan Portfolio"
                    value={loanConfigured ? currency(loanStats?.totalOutstanding ?? 0) : 'N/A'}
                    subtitle={loanConfigured ? `${formatNumber(loanStats?.activeLoans ?? 0)} active loans` : 'Loan product not configured'}
                    icon={
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                      </svg>
                    }
                  />
                  <StatCard
                    title="Loan Applications"
                    value={formatNumber((allLoans as any[]).length)}
                    subtitle="Total loans issued"
                    icon={
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                      </svg>
                    }
                  />
                </div>

                {/* Charts */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <Card>
                    <CardHeader>
                      <h3 className="text-base font-semibold text-gray-900">Monthly Contributions (last 12 months)</h3>
                    </CardHeader>
                    <CardBody>
                      {contributions.length === 0 ? (
                        <p className="text-sm text-gray-400 text-center py-8">No data yet</p>
                      ) : (
                        <ResponsiveContainer width="100%" height={220}>
                          <BarChart data={contributions} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                            <XAxis dataKey="month" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                            <YAxis
                              tick={{ fontSize: 11 }}
                              tickLine={false}
                              axisLine={false}
                              tickFormatter={(v: number) => `${currencySymbol}${(v / 1000).toFixed(0)}k`}
                            />
                            <Tooltip content={<CurrencyTooltip symbol={currencySymbol} />} />
                            <Bar dataKey="amount" fill="#3b82f6" barSize={20} radius={[4, 4, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      )}
                    </CardBody>
                  </Card>

                  <Card>
                    <CardHeader>
                      <h3 className="text-base font-semibold text-gray-900">New Member Growth (last 12 months)</h3>
                    </CardHeader>
                    <CardBody>
                      {newMembers.length === 0 ? (
                        <p className="text-sm text-gray-400 text-center py-8">No data yet</p>
                      ) : (
                        <ResponsiveContainer width="100%" height={220}>
                          <LineChart data={newMembers} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                            <XAxis dataKey="month" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                            <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
                            <Tooltip />
                            <Line
                              type="monotone"
                              dataKey="count"
                              stroke="#3b82f6"
                              strokeWidth={2}
                              dot={false}
                            />
                          </LineChart>
                        </ResponsiveContainer>
                      )}
                    </CardBody>
                  </Card>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Membership Breakdown */}
                  <Card>
                    <CardHeader>
                      <h3 className="text-base font-semibold text-gray-900">Membership Breakdown</h3>
                    </CardHeader>
                    <CardBody>
                      <div className="space-y-3">
                        {membershipBreakdown && Object.entries(membershipBreakdown).map(([status, count]) => (
                          <div key={status} className="flex items-center gap-3">
                            <StatusBadge status={status} />
                            <div className="flex-1 bg-gray-100 rounded-full h-2">
                              <div
                                className="h-2 rounded-full bg-blue-500"
                                style={{ width: totalMembers > 0 ? `${(count / totalMembers) * 100}%` : '0%' }}
                              />
                            </div>
                            <span className="text-sm font-semibold text-gray-900 w-6 text-right">{formatNumber(count)}</span>
                          </div>
                        ))}
                      </div>
                    </CardBody>
                  </Card>

                  {/* Loan Portfolio Summary */}
                  <Card>
                    <CardHeader>
                      <h3 className="text-base font-semibold text-gray-900">Loan Portfolio Summary</h3>
                    </CardHeader>
                    <CardBody>
                      {!loanConfigured ? (
                        <div className="py-6 text-center">
                          <p className="text-sm font-medium text-gray-500">Loan product not configured</p>
                          <p className="text-xs text-gray-400 mt-1">Set up interest rate and share price in System Config to enable lending.</p>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          <div className="flex justify-between items-center py-2 border-b border-gray-100">
                            <span className="text-sm text-gray-500">Total Disbursed</span>
                            <span className="text-sm font-semibold text-gray-900">{currency(loanStats?.totalDisbursed ?? 0)}</span>
                          </div>
                          <div className="flex justify-between items-center py-2 border-b border-gray-100">
                            <span className="text-sm text-gray-500">Total Outstanding</span>
                            <span className="text-sm font-semibold text-red-600">{currency(loanStats?.totalOutstanding ?? 0)}</span>
                          </div>
                          <div className="flex justify-between items-center py-2 border-b border-gray-100">
                            <span className="text-sm text-gray-500">Total Repaid</span>
                            <span className="text-sm font-semibold text-green-600">{currency(loanStats?.totalRepaid ?? 0)}</span>
                          </div>
                          <div className="flex justify-between items-center py-2 border-b border-gray-100">
                            <span className="text-sm text-gray-500">Active Loans</span>
                            <span className="text-sm font-semibold text-gray-900">{formatNumber(loanStats?.activeLoans ?? 0)}</span>
                          </div>
                          <div className="flex justify-between items-center py-2">
                            <span className="text-sm text-gray-500">Defaulted Loans</span>
                            <span className="text-sm font-semibold text-red-600">{formatNumber(loanStats?.defaultedLoans ?? 0)}</span>
                          </div>
                        </div>
                      )}
                    </CardBody>
                  </Card>
                </div>
              </>
            )}
          </>
        )}

        {/* ── Members Tab ─────────────────────────────────────────────────── */}
        {activeTab === 'members' && (
          <>
            {/* Inline export buttons */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  const rows = filteredMembers.map((m: any) => ({
                    Name: m.full_name,
                    'Account Status': m.account_status,
                    'Membership Status': m.membership_status?.status ?? 'pending',
                    'Completed Shares': m.membership_status?.completed_shares ?? 0,
                    Joined: m.created_at,
                  }))
                  exportToExcel(rows, 'members-report')
                }}
                className="inline-flex items-center gap-1.5 border border-gray-300 rounded-lg px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" />
                </svg>
                Export Excel
              </button>
              <button
                onClick={() => {
                  exportMembersPdf(
                    filteredMembers.map((m: any) => ({
                      full_name: m.full_name,
                      account_status: m.account_status,
                      membership_status: m.membership_status?.status ?? 'pending',
                      completed_shares: m.membership_status?.completed_shares ?? 0,
                    })),
                    `${filteredMembers.length} members${hasDateFilter ? ' (filtered)' : ''}`
                  )
                }}
                className="inline-flex items-center gap-1.5 border border-gray-300 rounded-lg px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" />
                </svg>
                Export PDF
              </button>
            </div>

            {/* Filters */}
            <div className="space-y-2">
              <div className="flex gap-2">
                <div className="relative flex-1 min-w-0">
                  <input
                    type="text"
                    placeholder="Search members…"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg pl-3 pr-8 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  {search && (
                    <button
                      onClick={() => setSearch('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
                <select
                  value={statusFilter}
                  onChange={e => setStatusFilter(e.target.value)}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                >
                  <option value="all">All</option>
                  <option value="active">Active</option>
                  <option value="pending">Pending</option>
                  <option value="inactive">Inactive</option>
                  <option value="suspended">Suspended</option>
                </select>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400 whitespace-nowrap flex-shrink-0">Joined:</span>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={e => setDateFrom(e.target.value)}
                  className="flex-1 min-w-0 border border-gray-300 rounded-lg px-2 py-1.5 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <span className="text-xs text-gray-400 flex-shrink-0">–</span>
                <input
                  type="date"
                  value={dateTo}
                  onChange={e => setDateTo(e.target.value)}
                  className="flex-1 min-w-0 border border-gray-300 rounded-lg px-2 py-1.5 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {hasDateFilter && (
                  <button
                    onClick={() => { setDateFrom(''); setDateTo('') }}
                    className="flex-shrink-0 text-xs text-gray-500 hover:text-gray-700 border border-gray-300 rounded-lg px-2 py-1.5 hover:bg-gray-50 transition-colors"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>

            {/* Member report preview — for export */}
            <Card>
              <CardHeader>
                <div>
                  <h3 className="text-base font-semibold text-gray-900">Member Report Preview</h3>
                  <p className="text-sm text-gray-500">
                    {filteredMembers.length} member{filteredMembers.length !== 1 ? 's' : ''} · use the export buttons above to download
                  </p>
                </div>
              </CardHeader>
              <CardBody className="p-0">
                {filteredMembers.length === 0 ? (
                  <p className="text-sm text-gray-500 p-6 text-center">No members found</p>
                ) : (
                  <Table>
                    <Thead>
                      <Tr>
                        <Th>Name</Th>
                        <Th>Membership Status</Th>
                        <Th className="text-center">Completed Shares</Th>
                        <Th className="hidden sm:table-cell">Joined</Th>
                      </Tr>
                    </Thead>
                    <Tbody>
                      {filteredMembers.map((m: any) => (
                        <Tr key={m.id} className="cursor-pointer hover:bg-gray-50" onClick={() => navigate(`/admin/members/${m.id}`)}>
                          <Td className="font-medium text-gray-900">{m.full_name}</Td>
                          <Td><StatusBadge status={m.membership_status?.status ?? 'pending'} /></Td>
                          <Td className="text-center text-gray-700">{m.membership_status?.completed_shares ?? 0}</Td>
                          <Td className="text-gray-500 text-xs hidden sm:table-cell">
                            {m.created_at ? new Date(m.created_at).toLocaleDateString() : '—'}
                          </Td>
                        </Tr>
                      ))}
                    </Tbody>
                  </Table>
                )}
              </CardBody>
            </Card>
          </>
        )}

        {/* ── Loans Tab ────────────────────────────────────────────────────── */}
        {activeTab === 'loans' && (
          <>
            {/* Loan KPI cards */}
            <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
              <StatCard
                title="Total Disbursed"
                value={currency(loanStats?.totalDisbursed ?? 0)}
                subtitle="Principal across all loans"
                icon={
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                }
              />
              <StatCard
                title="Total Outstanding"
                value={currency(loanStats?.totalOutstanding ?? 0)}
                subtitle="Remaining balance"
                icon={
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                  </svg>
                }
              />
              <StatCard
                title="Total Repaid"
                value={currency(loanStats?.totalRepaid ?? 0)}
                subtitle="Payments received"
                icon={
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                }
              />
              <StatCard
                title="Active / Defaulted"
                value={`${formatNumber(loanStats?.activeLoans ?? 0)} / ${formatNumber(loanStats?.defaultedLoans ?? 0)}`}
                subtitle="Active loans / Defaulted"
                icon={
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                  </svg>
                }
              />
            </div>

            {/* Repayment rate */}
            {loanConfigured && loanStats && loanStats.totalDisbursed > 0 && (
              <Card>
                <CardHeader>
                  <h3 className="text-base font-semibold text-gray-900">Repayment Rate</h3>
                </CardHeader>
                <CardBody>
                  <div className="flex items-center gap-4">
                    <div className="flex-1">
                      <div className="flex justify-between text-xs text-gray-500 mb-1.5">
                        <span>Repaid</span>
                        <span>{((loanStats.totalRepaid / loanStats.totalDisbursed) * 100).toFixed(1)}%</span>
                      </div>
                      <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-green-500 rounded-full transition-all"
                          style={{ width: `${Math.min(100, (loanStats.totalRepaid / loanStats.totalDisbursed) * 100)}%` }}
                        />
                      </div>
                      <div className="flex justify-between text-xs text-gray-400 mt-1.5">
                        <span>{currency(loanStats.totalRepaid)} repaid</span>
                        <span>{currency(loanStats.totalOutstanding)} outstanding</span>
                      </div>
                    </div>
                  </div>
                </CardBody>
              </Card>
            )}

            {/* Export */}
            <div className="flex items-center gap-3">
              <button
                onClick={() => {
                  exportLoanPortfolioPdf(allLoans, {
                    totalDisbursed: loanStats?.totalDisbursed ?? 0,
                    totalOutstanding: loanStats?.totalOutstanding ?? 0,
                    totalRepaid: loanStats?.totalRepaid ?? 0,
                    activeLoans: loanStats?.activeLoans ?? 0,
                  })
                }}
                className="inline-flex items-center gap-1.5 border border-gray-300 rounded-lg px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" />
                </svg>
                Export Loan Portfolio PDF
              </button>
            </div>
          </>
        )}

      </div>
    </div>
  )
}
