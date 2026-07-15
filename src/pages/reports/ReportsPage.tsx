import { useState, useRef, useEffect } from 'react'
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

function useLoanAgingReport() {
  return useQuery({
    queryKey: ['loan_aging_report'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_loan_aging_report')
      if (error) throw error
      return (data ?? []) as { bucket: string; loan_count: number; total_outstanding: number }[]
    },
    staleTime: 60_000,
  })
}

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

function useTotalSavings() {
  return useQuery({
    queryKey: ['total_savings_report'],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('savings_accounts').select('balance')
      if (error) throw error
      return (data as { balance: number }[]).reduce((sum, r) => sum + (r.balance ?? 0), 0)
    },
  })
}

function useMemberPortfolioReport() {
  return useQuery({
    queryKey: ['member_portfolio_report'],
    staleTime: 60_000,
    queryFn: async () => {
      const { data: profiles, error } = await supabase
        .from('profiles')
        .select('id, full_name, phone, account_status, employee_id, created_at, membership_status(status, completed_shares)')
        .eq('role', 'member')
        .order('full_name')
      if (error) throw error

      const userIds = (profiles ?? []).map((p: any) => p.id)
      if (userIds.length === 0) return []

      const [sharesRes, savingsRes, loansRes] = await Promise.all([
        supabase.from('equity_shares').select('user_id, paid_amount, target_amount, status, share_number').in('user_id', userIds),
        supabase.from('savings_accounts').select('user_id, balance, status').in('user_id', userIds),
        supabase.from('loans').select('user_id, outstanding, status').in('user_id', userIds),
      ])

      const equityMap: Record<string, { total: number; count: number; completed: number; shares: any[] }> = {}
      for (const s of (sharesRes.data ?? []) as any[]) {
        if (!equityMap[s.user_id]) equityMap[s.user_id] = { total: 0, count: 0, completed: 0, shares: [] }
        equityMap[s.user_id].total += s.paid_amount ?? 0
        equityMap[s.user_id].count += 1
        if (s.status === 'completed') equityMap[s.user_id].completed += 1
        equityMap[s.user_id].shares.push(s)
      }

      const savingsMap: Record<string, number> = {}
      for (const s of (savingsRes.data ?? []) as any[]) savingsMap[s.user_id] = s.balance ?? 0

      const loanMap: Record<string, { active: number; outstanding: number }> = {}
      for (const l of (loansRes.data ?? []) as any[]) {
        if (!loanMap[l.user_id]) loanMap[l.user_id] = { active: 0, outstanding: 0 }
        if (l.status === 'active') { loanMap[l.user_id].active += 1; loanMap[l.user_id].outstanding += l.outstanding ?? 0 }
      }

      return (profiles ?? []).map((p: any) => ({
        id: p.id,
        full_name: p.full_name,
        account_status: p.account_status,
        created_at: p.created_at,
        membership_status: Array.isArray(p.membership_status) ? p.membership_status[0] ?? null : p.membership_status ?? null,
        equity: equityMap[p.id] ?? { total: 0, count: 0, completed: 0, shares: [] },
        savings_balance: savingsMap[p.id] ?? 0,
        loans: loanMap[p.id] ?? { active: 0, outstanding: 0 },
      }))
    },
  })
}

interface ExportDropdownProps {
  onMembersXls: () => void
  onMembersPdf: () => void
  onLoansPdf: () => void
}

function ExportDropdown({ onMembersXls, onMembersPdf, onLoansPdf }: ExportDropdownProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const items = [
    { label: 'Members — Excel (.xlsx)', action: onMembersXls },
    { label: 'Members — PDF', action: onMembersPdf },
    { label: 'Loan Portfolio — PDF', action: onLoansPdf },
  ]

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-1.5 border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" />
        </svg>
        <span className="hidden sm:inline">Export</span>
        <svg className={`w-3.5 h-3.5 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-52 bg-white rounded-lg border border-gray-200 shadow-lg z-10 py-1">
          {items.map(item => (
            <button
              key={item.label}
              onClick={() => { item.action(); setOpen(false) }}
              className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
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
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const { data: membershipBreakdown, isLoading: breakdownLoading } = useMembershipBreakdown()
  const { data: totalEquity, isLoading: equityLoading } = useTotalEquity()
  const { data: totalSavings } = useTotalSavings()
  const { data: loanStats, isLoading: loanStatsLoading } = useLoanPortfolioStats()
  const { data: loanConfigured = false } = useLoanConfigured()
  const { data: loanAging = [] } = useLoanAgingReport()
  const { data: membersRaw, isLoading: membersLoading } = useMemberList(dateFrom, dateTo)
  const { data: portfolio = [] } = useMemberPortfolioReport()
  const { data: contributions = [], isLoading: contributionsLoading } = useMonthlyContributions()
  const { data: newMembers = [], isLoading: newMembersLoading } = useMonthlyNewMembers()
  const { data: allLoans = [] } = useAllLoans(dateFrom, dateTo)

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

  const filteredPortfolio = (portfolio as any[]).filter((m: any) => {
    const matchesSearch = (m.full_name ?? '').toLowerCase().includes(search.toLowerCase())
    const ms = m.membership_status?.status ?? 'pending'
    const matchesStatus = statusFilter === 'all' || ms === statusFilter
    return matchesSearch && matchesStatus
  })

  const isLoading = breakdownLoading || equityLoading || loanStatsLoading || membersLoading || contributionsLoading || newMembersLoading

  const { format: currency, symbol: currencySymbol } = useCurrency()
  if (isLoading) return <SkeletonPage cards={4} rows={6} />

  const totalMembers = membershipBreakdown
    ? Object.values(membershipBreakdown).reduce((a, b) => a + b, 0)
    : 0

  const hasDateFilter = !!(dateFrom || dateTo)

  return (
    <div>
      <Header
        title="Reports"
        subtitle="Platform-wide analytics and summaries"
        actions={
          <ExportDropdown
            onMembersXls={() => {
              const rows = filteredMembers.map((m: any) => ({
                Name: m.full_name,
                'Account Status': m.account_status,
                'Membership Status': m.membership_status?.status ?? 'pending',
                'Completed Shares': m.membership_status?.completed_shares ?? 0,
                Joined: m.created_at,
              }))
              exportToExcel(rows, 'members-report')
            }}
            onMembersPdf={() => {
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
            onLoansPdf={() => {
              exportLoanPortfolioPdf(allLoans, {
                totalDisbursed: loanStats?.totalDisbursed ?? 0,
                totalOutstanding: loanStats?.totalOutstanding ?? 0,
                totalRepaid: loanStats?.totalRepaid ?? 0,
                activeLoans: loanStats?.activeLoans ?? 0,
              })
            }}
          />
        }
      />

      <div className="p-4 sm:p-6 space-y-6">
        {/* Filters */}
        <div className="space-y-2">
          {/* Search + status */}
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

          {/* Date range */}
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
            title="Total Savings"
            value={currency(totalSavings ?? 0)}
            subtitle={`${(portfolio as any[]).filter(m => m.savings_balance > 0).length} active savers`}
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

          {/* Loan Portfolio */}
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
                    <span className="text-sm font-semibold text-gray-900">
                      {currency(loanStats?.totalDisbursed ?? 0)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b border-gray-100">
                    <span className="text-sm text-gray-500">Total Outstanding</span>
                    <span className="text-sm font-semibold text-red-600">
                      {currency(loanStats?.totalOutstanding ?? 0)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b border-gray-100">
                    <span className="text-sm text-gray-500">Total Repaid</span>
                    <span className="text-sm font-semibold text-green-600">
                      {currency(loanStats?.totalRepaid ?? 0)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b border-gray-100">
                    <span className="text-sm text-gray-500">Active Loans</span>
                    <span className="text-sm font-semibold text-gray-900">
                      {formatNumber(loanStats?.activeLoans ?? 0)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center py-2">
                    <span className="text-sm text-gray-500">Defaulted Loans</span>
                    <span className="text-sm font-semibold text-red-600">
                      {formatNumber(loanStats?.defaultedLoans ?? 0)}
                    </span>
                  </div>
                </div>
              )}
            </CardBody>
          </Card>
        </div>

        {/* Loan Aging Report */}
        {loanConfigured && loanAging.length > 0 && (
          <Card>
            <CardHeader>
              <h3 className="text-base font-semibold text-gray-900">Loan Aging / Delinquency Report</h3>
            </CardHeader>
            <CardBody className="p-0">
              <Table>
                <Thead>
                  <Tr>
                    <Th>Aging Bucket</Th>
                    <Th className="text-center">Loans</Th>
                    <Th className="text-right">Outstanding Balance</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {loanAging.map((row) => {
                    const isOverdue = !['Current', 'Completed'].includes(row.bucket)
                    return (
                      <Tr key={row.bucket}>
                        <Td>
                          <span className={`font-medium ${isOverdue ? 'text-red-600' : 'text-gray-900'}`}>
                            {row.bucket}
                          </span>
                        </Td>
                        <Td className="text-center">{formatNumber(row.loan_count)}</Td>
                        <Td className="text-right">
                          <span className={isOverdue && row.total_outstanding > 0 ? 'text-red-600 font-semibold' : 'text-gray-900'}>
                            {currency(row.total_outstanding)}
                          </span>
                        </Td>
                      </Tr>
                    )
                  })}
                </Tbody>
              </Table>
            </CardBody>
          </Card>
        )}

        {/* Shares & Savings Overview */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Shares breakdown */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-semibold text-gray-900">Equity Shares</h3>
                  <p className="text-sm text-gray-500">Total: {currency(totalEquity ?? 0)}</p>
                </div>
              </div>
            </CardHeader>
            <CardBody className="p-0">
              {(portfolio as any[]).filter(m => m.equity.count > 0).length === 0 ? (
                <p className="text-sm text-gray-400 p-6 text-center">No shares on record</p>
              ) : (
                <Table>
                  <Thead>
                    <Tr>
                      <Th>Member</Th>
                      <Th className="text-center">Shares</Th>
                      <Th className="text-center">Completed</Th>
                      <Th className="text-right">Amount Paid</Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {(portfolio as any[])
                      .filter(m => m.equity.count > 0)
                      .sort((a, b) => b.equity.total - a.equity.total)
                      .map(m => (
                        <Tr
                          key={m.id}
                          className="cursor-pointer hover:bg-gray-50"
                          onClick={() => navigate(`/admin/members/${m.id}`)}
                        >
                          <Td className="font-medium text-gray-900">{m.full_name}</Td>
                          <Td className="text-center text-gray-600">{m.equity.count}</Td>
                          <Td className="text-center">
                            <span className={m.equity.completed === m.equity.count ? 'text-green-700 font-medium' : 'text-gray-500'}>
                              {m.equity.completed}
                            </span>
                          </Td>
                          <Td className="text-right font-semibold text-gray-900">{currency(m.equity.total)}</Td>
                        </Tr>
                      ))}
                  </Tbody>
                </Table>
              )}
            </CardBody>
          </Card>

          {/* Savings breakdown */}
          <Card>
            <CardHeader>
              <div>
                <h3 className="text-base font-semibold text-gray-900">Savings Balances</h3>
                <p className="text-sm text-gray-500">Total: {currency(totalSavings ?? 0)}</p>
              </div>
            </CardHeader>
            <CardBody className="p-0">
              {(portfolio as any[]).filter(m => m.savings_balance > 0).length === 0 ? (
                <p className="text-sm text-gray-400 p-6 text-center">No savings on record</p>
              ) : (
                <Table>
                  <Thead>
                    <Tr>
                      <Th>Member</Th>
                      <Th className="text-right">Balance</Th>
                      <Th className="text-right">% of Total</Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {(portfolio as any[])
                      .filter(m => m.savings_balance > 0)
                      .sort((a, b) => b.savings_balance - a.savings_balance)
                      .map(m => (
                        <Tr
                          key={m.id}
                          className="cursor-pointer hover:bg-gray-50"
                          onClick={() => navigate(`/admin/members/${m.id}`)}
                        >
                          <Td className="font-medium text-gray-900">{m.full_name}</Td>
                          <Td className="text-right font-semibold text-gray-900">{currency(m.savings_balance)}</Td>
                          <Td className="text-right text-gray-500 text-xs">
                            {totalSavings ? `${((m.savings_balance / (totalSavings ?? 1)) * 100).toFixed(1)}%` : '—'}
                          </Td>
                        </Tr>
                      ))}
                  </Tbody>
                </Table>
              )}
            </CardBody>
          </Card>
        </div>

        {/* Members Portfolio Table */}
        <Card>
          <CardHeader>
            <div>
              <h3 className="text-base font-semibold text-gray-900">Members Portfolio</h3>
              <p className="text-sm text-gray-500">
                {filteredPortfolio.length} member{filteredPortfolio.length !== 1 ? 's' : ''} · click a row to view full profile
              </p>
            </div>
          </CardHeader>
          <CardBody className="p-0">
            {filteredPortfolio.length === 0 ? (
              <p className="text-sm text-gray-500 p-6 text-center">No members found</p>
            ) : (
              <Table>
                <Thead>
                  <Tr>
                    <Th>Member</Th>
                    <Th>Membership</Th>
                    <Th className="text-right">Total Equity</Th>
                    <Th className="text-right">Savings</Th>
                    <Th className="text-center">Active Loans</Th>
                    <Th className="text-right">Loan Outstanding</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {(filteredPortfolio as any[]).map(m => (
                    <Tr
                      key={m.id}
                      className="cursor-pointer hover:bg-gray-50"
                      onClick={() => navigate(`/admin/members/${m.id}`)}
                    >
                      <Td>
                        <p className="font-medium text-gray-900">{m.full_name}</p>
                        <p className="text-xs text-gray-400">{m.equity.completed} completed share{m.equity.completed !== 1 ? 's' : ''}</p>
                      </Td>
                      <Td><StatusBadge status={m.membership_status?.status ?? 'pending'} /></Td>
                      <Td className="text-right font-semibold text-gray-900">{currency(m.equity.total)}</Td>
                      <Td className="text-right font-semibold text-gray-900">
                        {m.savings_balance > 0 ? currency(m.savings_balance) : <span className="text-gray-300">—</span>}
                      </Td>
                      <Td className="text-center">
                        {m.loans.active > 0
                          ? <span className="font-medium text-amber-700">{m.loans.active}</span>
                          : <span className="text-gray-300">—</span>}
                      </Td>
                      <Td className="text-right">
                        {m.loans.outstanding > 0
                          ? <span className="font-semibold text-red-600">{currency(m.loans.outstanding)}</span>
                          : <span className="text-gray-300">—</span>}
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  )
}
