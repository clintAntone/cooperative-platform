import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
// @ts-ignore
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts'
import { supabase } from '../../lib/supabase'
import { useCurrency } from '../../hooks/useCurrency'
import { useLoanPortfolioStats } from '../../hooks/useLoans'
import { useMembershipBreakdown } from '../../hooks/useMembership'
import { useBranches, useAllBranchIncome, useAllBranchExpenses } from '../../hooks/useBranches'
import { useMonthlyContributions, useMonthlyNewMembers } from '../../hooks/useReports'
import { Header } from '../../components/layout/Header'
import { StatusBadge } from '../../components/shared/StatusBadge'
import { formatDate, formatNumber } from '../../lib/utils'
import { exportToExcel } from '../../lib/exportExcel'
import { exportMembersPdf, exportLoanPortfolioPdf } from '../../lib/exportPdf'
import type { ExpenseCategory } from '../../types'

// ─── Category badge colors (mirrors BranchKPIPage) ───────────────────────────

const categoryBadgeColors: Record<ExpenseCategory, string> = {
  salary: 'bg-purple-100 text-purple-700',
  utilities: 'bg-blue-100 text-blue-700',
  rent: 'bg-orange-100 text-orange-700',
  supplies: 'bg-yellow-100 text-yellow-700',
  maintenance: 'bg-red-100 text-red-700',
  other: 'bg-gray-100 text-gray-600',
}

// ─── Shared KPI card ──────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  sub,
  valueClass = 'text-gray-900',
}: {
  label: string
  value: string | number
  sub?: string
  valueClass?: string
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className={`text-2xl font-bold ${valueClass}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  )
}

// ─── Inline hooks ─────────────────────────────────────────────────────────────

function useTotalEquity() {
  return useQuery({
    queryKey: ['overview_total_equity'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('equity_contributions')
        .select('amount')
      if (error) throw error
      return (data as { amount: number }[]).reduce((sum, r) => sum + r.amount, 0)
    },
  })
}

function usePendingDepositCountOverview() {
  return useQuery({
    queryKey: ['overview_pending_deposits'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('equity_deposit_requests')
        .select('id')
        .eq('status', 'pending')
      if (error) throw error
      return data?.length ?? 0
    },
  })
}

function useCompletedSharesCount() {
  return useQuery({
    queryKey: ['overview_completed_shares'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('equity_shares')
        .select('id')
        .eq('status', 'completed')
      if (error) throw error
      return data?.length ?? 0
    },
  })
}

interface MemberEquityRow {
  user_id: string
  full_name: string
  shareCount: number
  completedCount: number
  totalPaid: number
}

function useMemberEquityReport() {
  return useQuery({
    queryKey: ['overview_member_equity_report'],
    queryFn: async () => {
      // Step 1: fetch member profiles
      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('id, full_name')
        .eq('role', 'member')
        .order('full_name')
      if (profilesError) throw profilesError

      const userIds = (profiles as { id: string; full_name: string }[]).map(p => p.id)
      if (userIds.length === 0) return []

      // Step 2: fetch equity shares for those members
      const { data: shares, error: sharesError } = await supabase
        .from('equity_shares')
        .select('user_id, paid_amount, status')
        .in('user_id', userIds)
      if (sharesError) throw sharesError

      // Step 3: build map
      const map: Record<string, { total: number; count: number; completed: number }> = {}
      for (const s of shares as { user_id: string; paid_amount: number; status: string }[]) {
        if (!map[s.user_id]) map[s.user_id] = { total: 0, count: 0, completed: 0 }
        map[s.user_id].total += s.paid_amount
        map[s.user_id].count++
        if (s.status === 'completed') map[s.user_id].completed++
      }

      // Step 4: merge and sort
      return (profiles as { id: string; full_name: string }[])
        .map(p => ({
          user_id: p.id,
          full_name: p.full_name,
          shareCount: map[p.id]?.count ?? 0,
          completedCount: map[p.id]?.completed ?? 0,
          totalPaid: map[p.id]?.total ?? 0,
        }))
        .sort((a, b) => b.totalPaid - a.totalPaid) as MemberEquityRow[]
    },
  })
}

interface SavingsOverviewRow {
  account_id: string
  user_id: string
  full_name: string
  balance: number
  status: string
  totalDeposited: number
  interestEarned: number
  lastDepositAt: string | null
}

function useAllSavingsOverview() {
  return useQuery({
    queryKey: ['overview_savings'],
    queryFn: async () => {
      // Step 1: savings accounts
      const { data: accounts, error: accErr } = await supabase
        .from('savings_accounts')
        .select('id, user_id, balance, status')
      if (accErr) throw accErr

      const accs = accounts as { id: string; user_id: string; balance: number; status: string }[]
      if (accs.length === 0) return []

      const userIds = [...new Set(accs.map(a => a.user_id))]
      const accountIds = accs.map(a => a.id)

      // Step 2: profiles
      const { data: profiles, error: profErr } = await supabase
        .from('profiles')
        .select('id, full_name')
        .in('id', userIds)
      if (profErr) throw profErr
      const profileMap: Record<string, string> = {}
      for (const p of profiles as { id: string; full_name: string }[]) {
        profileMap[p.id] = p.full_name
      }

      // Step 3: savings_contributions — total deposited + last deposit per account
      const { data: contribs, error: contribErr } = await supabase
        .from('savings_contributions')
        .select('account_id, amount, contributed_at')
        .in('account_id', accountIds)
        .order('contributed_at', { ascending: false })
      if (contribErr) throw contribErr

      const depositMap: Record<string, { total: number; lastAt: string | null }> = {}
      for (const c of contribs as { account_id: string; amount: number; contributed_at: string }[]) {
        if (!depositMap[c.account_id]) depositMap[c.account_id] = { total: 0, lastAt: null }
        depositMap[c.account_id].total += c.amount
        if (!depositMap[c.account_id].lastAt) depositMap[c.account_id].lastAt = c.contributed_at
      }

      // Step 4: savings_interest_logs — interest per account
      const { data: interest, error: intErr } = await supabase
        .from('savings_interest_logs')
        .select('account_id, interest_earned')
        .in('account_id', accountIds)
      if (intErr) throw intErr

      const interestMap: Record<string, number> = {}
      for (const i of interest as { account_id: string; interest_earned: number }[]) {
        interestMap[i.account_id] = (interestMap[i.account_id] ?? 0) + i.interest_earned
      }

      return accs.map(a => ({
        account_id: a.id,
        user_id: a.user_id,
        full_name: profileMap[a.user_id] ?? 'Unknown',
        balance: a.balance,
        status: a.status,
        totalDeposited: depositMap[a.id]?.total ?? 0,
        interestEarned: interestMap[a.id] ?? 0,
        lastDepositAt: depositMap[a.id]?.lastAt ?? null,
      })) as SavingsOverviewRow[]
    },
  })
}

function usePendingSavingsDeposits() {
  return useQuery({
    queryKey: ['overview_pending_savings_deposits'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('savings_deposit_requests')
        .select('id')
        .eq('status', 'pending')
      if (error) throw error
      return data?.length ?? 0
    },
  })
}

function usePendingSavingsWithdrawals() {
  return useQuery({
    queryKey: ['overview_pending_savings_withdrawals'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('savings_withdrawal_requests')
        .select('id')
        .eq('status', 'pending')
      if (error) throw error
      return data?.length ?? 0
    },
  })
}

interface LoanOverviewRow {
  id: string
  user_id: string
  full_name: string
  principal: number
  outstanding: number
  status: string
  disbursed_at: string
}

function useOverviewLoanList() {
  return useQuery({
    queryKey: ['overview_loans'],
    queryFn: async () => {
      // Step 1: loans
      const { data: loans, error: loanErr } = await supabase
        .from('loans')
        .select('id, user_id, principal, outstanding, status, disbursed_at')
        .order('disbursed_at', { ascending: false })
        .limit(50)
      if (loanErr) throw loanErr

      const rows = loans as { id: string; user_id: string; principal: number; outstanding: number; status: string; disbursed_at: string }[]
      if (rows.length === 0) return []

      // Step 2: profiles
      const userIds = [...new Set(rows.map(l => l.user_id))]
      const { data: profiles, error: profErr } = await supabase
        .from('profiles')
        .select('id, full_name')
        .in('id', userIds)
      if (profErr) throw profErr

      const profileMap: Record<string, string> = {}
      for (const p of profiles as { id: string; full_name: string }[]) {
        profileMap[p.id] = p.full_name
      }

      return rows.map(l => ({
        ...l,
        full_name: profileMap[l.user_id] ?? 'Unknown',
      })) as LoanOverviewRow[]
    },
  })
}

interface AgingRow {
  loan_id: string
  full_name: string
  principal: number
  outstanding: number
  days_overdue: number
  status: string
}

function useLoanAgingReport() {
  return useQuery({
    queryKey: ['loan_aging_report'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_loan_aging_report')
      if (error) throw error
      return (data ?? []) as AgingRow[]
    },
  })
}

function usePendingLoanApplications() {
  return useQuery({
    queryKey: ['overview_pending_loan_applications'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('loan_applications')
        .select('id')
        .in('status', ['submitted', 'under_review'])
      if (error) throw error
      return data?.length ?? 0
    },
  })
}

// ─── Pending Actions Bar ──────────────────────────────────────────────────────

function PendingActionsBar({
  pendingDeposits,
  pendingSavingsDeposits,
  pendingSavingsWithdrawals,
  pendingLoanApplications,
}: {
  pendingDeposits: number
  pendingSavingsDeposits: number
  pendingSavingsWithdrawals: number
  pendingLoanApplications: number
}) {
  const navigate = useNavigate()
  const total = pendingDeposits + pendingSavingsDeposits + pendingSavingsWithdrawals + pendingLoanApplications

  if (total === 0) return null

  const chips = [
    { label: 'Equity Deposits', count: pendingDeposits, route: '/admin/deposits' },
    { label: 'Savings Deposits', count: pendingSavingsDeposits, route: '/admin/savings-deposits' },
    { label: 'Savings Withdrawals', count: pendingSavingsWithdrawals, route: '/admin/savings-withdrawals' },
    { label: 'Loan Applications', count: pendingLoanApplications, route: '/admin/loans/applications' },
  ].filter(c => c.count > 0)

  return (
    <div className="bg-amber-50 border-b border-amber-100 px-4 sm:px-6 py-2 flex items-center gap-2 overflow-x-auto">
      <span className="text-xs text-amber-700 font-semibold uppercase tracking-wide whitespace-nowrap flex-shrink-0">Needs Attention</span>
      <div className="flex items-center gap-2 flex-wrap">
        {chips.map(chip => (
          <button
            key={chip.route}
            onClick={() => navigate(chip.route)}
            className="inline-flex items-center gap-1.5 bg-white border border-amber-300 rounded-full px-3 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100 transition-colors whitespace-nowrap"
          >
            {chip.label}
            <span className="bg-amber-500 text-white rounded-full text-xs font-bold px-1.5 py-0.5 min-w-[20px] text-center leading-none">
              {chip.count}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

// ─── Modal data hooks ─────────────────────────────────────────────────────────

function useMemberEquityShares(userId: string | null) {
  return useQuery({
    queryKey: ['modal_equity_shares', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('equity_shares')
        .select('id, share_number, target_amount, paid_amount, status, completed_at, created_at')
        .eq('user_id', userId!)
        .order('share_number')
      if (error) throw error
      return data as { id: string; share_number: number; target_amount: number; paid_amount: number; status: string; completed_at: string | null; created_at: string }[]
    },
  })
}

function useMemberSavingsModal(userId: string | null) {
  return useQuery({
    queryKey: ['modal_savings', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data: accounts } = await supabase
        .from('savings_accounts')
        .select('id, balance, status, opened_at')
        .eq('user_id', userId!)
        .maybeSingle()

      if (!accounts) return { account: null, deposits: [], withdrawals: [], interest: [] }

      const [dep, with_, int] = await Promise.all([
        supabase.from('savings_deposit_requests')
          .select('id, amount, payment_method, status, created_at')
          .eq('user_id', userId!)
          .order('created_at', { ascending: false })
          .limit(8),
        supabase.from('savings_withdrawal_requests')
          .select('id, amount, status, created_at')
          .eq('user_id', userId!)
          .order('created_at', { ascending: false })
          .limit(8),
        supabase.from('savings_interest_logs')
          .select('id, interest_earned, period_start, period_end, created_at')
          .eq('account_id', accounts.id)
          .order('created_at', { ascending: false }),
      ])

      return {
        account: accounts,
        deposits: dep.data ?? [],
        withdrawals: with_.data ?? [],
        interest: int.data ?? [],
      }
    },
  })
}

function useLoanModal(loanId: string | null) {
  return useQuery({
    queryKey: ['modal_loan', loanId],
    enabled: !!loanId,
    queryFn: async () => {
      const { data: loan, error: loanErr } = await supabase
        .from('loans')
        .select('id, user_id, principal, outstanding, amount_paid, status, disbursed_at')
        .eq('id', loanId!)
        .single()
      if (loanErr) throw loanErr

      const { data: schedule } = await supabase
        .from('loan_repayment_schedules')
        .select('id, due_date, amount, principal_portion, interest_portion, status')
        .eq('loan_id', loanId!)
        .order('due_date')

      const { data: memberProfile } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', loan.user_id)
        .single()

      return {
        loan,
        schedule: schedule ?? [],
        full_name: memberProfile?.full_name ?? 'Unknown',
      }
    },
  })
}

// ─── Modal base ───────────────────────────────────────────────────────────────

function ModalBase({ title, subtitle, onClose, children, wide = false }: {
  title: string
  subtitle?: string
  onClose: () => void
  children: React.ReactNode
  wide?: boolean
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose])

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className={`relative bg-white rounded-2xl shadow-xl flex flex-col max-h-[85vh] ${wide ? 'w-full max-w-2xl' : 'w-full max-w-lg'}`}>
        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <div>
            <h2 className="text-base font-semibold text-gray-900">{title}</h2>
            {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors flex-shrink-0 ml-3"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        {/* Body */}
        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">
          {children}
        </div>
      </div>
    </div>,
    document.body
  )
}

// ─── Equity member modal ──────────────────────────────────────────────────────

function EquityMemberModal({ userId, fullName, onClose }: {
  userId: string
  fullName: string
  onClose: () => void
}) {
  const { format: currency } = useCurrency()
  const { data: shares = [], isLoading } = useMemberEquityShares(userId)

  const totalPaid = shares.reduce((s, sh) => s + sh.paid_amount, 0)
  const totalTarget = shares.reduce((s, sh) => s + sh.target_amount, 0)
  const remaining = totalTarget - totalPaid

  return (
    <ModalBase title={fullName} subtitle="Equity Shares" onClose={onClose} wide>
      {isLoading ? (
        <p className="text-sm text-gray-400 text-center py-6">Loading…</p>
      ) : shares.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-6">No equity shares found.</p>
      ) : (
        <>
          {/* Summary row */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Total Paid', value: currency(totalPaid), cls: 'text-blue-700' },
              { label: 'Total Target', value: currency(totalTarget), cls: 'text-gray-900' },
              { label: 'Remaining', value: currency(remaining), cls: remaining > 0 ? 'text-amber-600' : 'text-green-600' },
            ].map(c => (
              <div key={c.label} className="bg-gray-50 rounded-lg p-3 text-center">
                <p className="text-xs text-gray-500 mb-1">{c.label}</p>
                <p className={`text-lg font-bold ${c.cls}`}>{c.value}</p>
              </div>
            ))}
          </div>
          {/* Shares table */}
          <div className="overflow-x-auto rounded-lg border border-gray-100">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                  <th className="text-left px-3 py-2 font-medium">Share #</th>
                  <th className="text-right px-3 py-2 font-medium">Target</th>
                  <th className="text-right px-3 py-2 font-medium">Paid</th>
                  <th className="text-right px-3 py-2 font-medium">Remaining</th>
                  <th className="text-left px-3 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {shares.map(sh => (
                  <tr key={sh.id}>
                    <td className="px-3 py-2.5 font-medium text-gray-800">#{sh.share_number}</td>
                    <td className="px-3 py-2.5 text-right text-gray-600">{currency(sh.target_amount)}</td>
                    <td className="px-3 py-2.5 text-right text-gray-900 font-medium">{currency(sh.paid_amount)}</td>
                    <td className="px-3 py-2.5 text-right">
                      <span className={sh.target_amount - sh.paid_amount > 0 ? 'text-amber-600' : 'text-green-600'}>
                        {currency(Math.max(0, sh.target_amount - sh.paid_amount))}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusBadge status={sh.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </ModalBase>
  )
}

// ─── Savings member modal ─────────────────────────────────────────────────────

function SavingsMemberModal({ userId, fullName, onClose }: {
  userId: string
  fullName: string
  onClose: () => void
}) {
  const { format: currency } = useCurrency()
  const { data, isLoading } = useMemberSavingsModal(userId)
  const [tab, setTab] = useState<'deposits' | 'withdrawals' | 'interest'>('deposits')

  return (
    <ModalBase title={fullName} subtitle="Savings Account" onClose={onClose} wide>
      {isLoading ? (
        <p className="text-sm text-gray-400 text-center py-6">Loading…</p>
      ) : !data?.account ? (
        <p className="text-sm text-gray-400 text-center py-6">No savings account found.</p>
      ) : (
        <>
          {/* Account summary */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-emerald-50 rounded-lg p-3">
              <p className="text-xs text-emerald-700 mb-1">Balance</p>
              <p className="text-xl font-bold text-emerald-800">{currency(data.account.balance)}</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-xs text-gray-500 mb-1">Status</p>
              <div className="mt-0.5"><StatusBadge status={data.account.status} /></div>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-gray-100">
            {([['deposits', 'Deposits'], ['withdrawals', 'Withdrawals'], ['interest', 'Interest']] as const).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  tab === key ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === 'deposits' && (
            <div className="overflow-x-auto rounded-lg border border-gray-100">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                    <th className="text-left px-3 py-2">Date</th>
                    <th className="text-right px-3 py-2">Amount</th>
                    <th className="text-left px-3 py-2">Method</th>
                    <th className="text-left px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {(data.deposits as any[]).length === 0 ? (
                    <tr><td colSpan={4} className="px-3 py-4 text-center text-gray-400">No deposits found.</td></tr>
                  ) : (data.deposits as any[]).map((d: any) => (
                    <tr key={d.id}>
                      <td className="px-3 py-2.5 text-gray-500">{formatDate(d.created_at)}</td>
                      <td className="px-3 py-2.5 text-right font-medium text-gray-900">{currency(d.amount)}</td>
                      <td className="px-3 py-2.5 text-gray-600 capitalize">{d.payment_method.replace('_', ' ')}</td>
                      <td className="px-3 py-2.5"><StatusBadge status={d.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {tab === 'withdrawals' && (
            <div className="overflow-x-auto rounded-lg border border-gray-100">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                    <th className="text-left px-3 py-2">Date</th>
                    <th className="text-right px-3 py-2">Amount</th>
                    <th className="text-left px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {(data.withdrawals as any[]).length === 0 ? (
                    <tr><td colSpan={3} className="px-3 py-4 text-center text-gray-400">No withdrawals found.</td></tr>
                  ) : (data.withdrawals as any[]).map((w: any) => (
                    <tr key={w.id}>
                      <td className="px-3 py-2.5 text-gray-500">{formatDate(w.created_at)}</td>
                      <td className="px-3 py-2.5 text-right font-medium text-gray-900">{currency(w.amount)}</td>
                      <td className="px-3 py-2.5"><StatusBadge status={w.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {tab === 'interest' && (
            <div className="overflow-x-auto rounded-lg border border-gray-100">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                    <th className="text-left px-3 py-2">Period</th>
                    <th className="text-right px-3 py-2">Interest Earned</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {(data.interest as any[]).length === 0 ? (
                    <tr><td colSpan={2} className="px-3 py-4 text-center text-gray-400">No interest credited yet.</td></tr>
                  ) : (data.interest as any[]).map((i: any) => (
                    <tr key={i.id}>
                      <td className="px-3 py-2.5 text-gray-600">{formatDate(i.period_start)} – {formatDate(i.period_end)}</td>
                      <td className="px-3 py-2.5 text-right font-medium text-green-700">{currency(i.interest_earned)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </ModalBase>
  )
}

// ─── Loan detail modal ────────────────────────────────────────────────────────

function LoanDetailModal({ loanId, onClose }: {
  loanId: string
  onClose: () => void
}) {
  const { format: currency } = useCurrency()
  const { data, isLoading } = useLoanModal(loanId)

  const loan = data?.loan
  const schedule = data?.schedule ?? []
  const paidInstallments = schedule.filter((s: any) => s.status === 'paid').length
  const overdueInstallments = schedule.filter((s: any) => s.status === 'overdue').length

  return (
    <ModalBase title={data?.full_name ?? '…'} subtitle="Loan Details" onClose={onClose} wide>
      {isLoading ? (
        <p className="text-sm text-gray-400 text-center py-6">Loading…</p>
      ) : !loan ? (
        <p className="text-sm text-gray-400 text-center py-6">Loan not found.</p>
      ) : (
        <>
          {/* Summary */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-blue-50 rounded-lg p-3">
              <p className="text-xs text-blue-700 mb-1">Principal</p>
              <p className="text-xl font-bold text-blue-900">{currency(loan.principal)}</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-xs text-gray-500 mb-1">Outstanding</p>
              <p className="text-xl font-bold text-gray-900">{currency(loan.outstanding)}</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-xs text-gray-500 mb-1">Disbursed</p>
              <p className="text-sm font-semibold text-gray-800">{formatDate(loan.disbursed_at)}</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-xs text-gray-500 mb-1">Status</p>
              <div className="mt-0.5"><StatusBadge status={loan.status} /></div>
            </div>
          </div>

          {/* Repayment schedule */}
          {schedule.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-semibold text-gray-700">Repayment Schedule</p>
                <p className="text-xs text-gray-500">
                  {paidInstallments}/{schedule.length} paid
                  {overdueInstallments > 0 && (
                    <span className="ml-2 text-red-600 font-medium">{overdueInstallments} overdue</span>
                  )}
                </p>
              </div>
              <div className="overflow-x-auto rounded-lg border border-gray-100 max-h-64">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-gray-50">
                    <tr className="text-xs text-gray-500 uppercase tracking-wide">
                      <th className="text-left px-3 py-2">Due Date</th>
                      <th className="text-right px-3 py-2">Amount</th>
                      <th className="text-right px-3 py-2 hidden sm:table-cell">Principal</th>
                      <th className="text-right px-3 py-2 hidden sm:table-cell">Interest</th>
                      <th className="text-left px-3 py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {(schedule as any[]).map((row: any) => (
                      <tr key={row.id} className={row.status === 'overdue' ? 'bg-red-50' : ''}>
                        <td className="px-3 py-2.5 text-gray-600">{formatDate(row.due_date)}</td>
                        <td className="px-3 py-2.5 text-right font-medium text-gray-900">{currency(row.amount)}</td>
                        <td className="px-3 py-2.5 text-right text-gray-600 hidden sm:table-cell">{currency(row.principal_portion)}</td>
                        <td className="px-3 py-2.5 text-right text-gray-600 hidden sm:table-cell">{currency(row.interest_portion)}</td>
                        <td className="px-3 py-2.5"><StatusBadge status={row.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </ModalBase>
  )
}

// ─── Tab components ───────────────────────────────────────────────────────────

function EquityTab() {
  const { format: currency } = useCurrency()
  const { data: totalEquity = 0, isLoading: equityLoading } = useTotalEquity()
  const { data: membership } = useMembershipBreakdown()
  const { data: completedShares = 0 } = useCompletedSharesCount()
  const { data: pendingDeposits = 0 } = usePendingDepositCountOverview()
  const { data: memberReport = [], isLoading: reportLoading } = useMemberEquityReport()
  const [selectedMember, setSelectedMember] = useState<{ userId: string; fullName: string } | null>(null)

  const activeMembers = membership?.active ?? 0

  return (
    <div className="space-y-6">
      {/* KPI row */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <KpiCard
          label="Total Equity Raised"
          value={equityLoading ? '…' : currency(totalEquity)}
          sub="Sum of all contributions"
        />
        <KpiCard
          label="Active Members"
          value={activeMembers}
          sub="Membership status: active"
          valueClass="text-green-700"
        />
        <KpiCard
          label="Completed Shares"
          value={completedShares}
          sub="Shares at 100% target"
          valueClass="text-blue-700"
        />
        <KpiCard
          label="Pending Deposits"
          value={pendingDeposits}
          sub="Awaiting admin approval"
          valueClass={pendingDeposits > 0 ? 'text-amber-600' : 'text-gray-900'}
        />
      </div>

      {/* Per-member equity table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-700">Per-Member Equity</h3>
        </div>
        {reportLoading ? (
          <p className="text-sm text-gray-400 text-center py-8">Loading…</p>
        ) : memberReport.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">No member data found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                  <th className="text-left px-4 py-2 font-medium">Member</th>
                  <th className="text-right px-4 py-2 font-medium">Shares</th>
                  <th className="text-right px-4 py-2 font-medium">Completed</th>
                  <th className="text-right px-4 py-2 font-medium">Amount Paid</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {memberReport.map(row => (
                  <tr
                    key={row.user_id}
                    className="hover:bg-gray-50 cursor-pointer transition-colors"
                    onClick={() => setSelectedMember({ userId: row.user_id, fullName: row.full_name })}
                  >
                    <td className="px-4 py-2.5 font-medium text-gray-900">{row.full_name}</td>
                    <td className="px-4 py-2.5 text-right text-gray-600">{row.shareCount}</td>
                    <td className="px-4 py-2.5 text-right text-gray-600">{row.completedCount}</td>
                    <td className="px-4 py-2.5 text-right font-semibold text-gray-900">{currency(row.totalPaid)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selectedMember && (
        <EquityMemberModal
          userId={selectedMember.userId}
          fullName={selectedMember.fullName}
          onClose={() => setSelectedMember(null)}
        />
      )}
    </div>
  )
}

function SavingsTab() {
  const navigate = useNavigate()
  const { format: currency } = useCurrency()
  const { data: savingsRows = [], isLoading } = useAllSavingsOverview()
  const { data: pendingDeposits = 0 } = usePendingSavingsDeposits()
  const { data: pendingWithdrawals = 0 } = usePendingSavingsWithdrawals()
  const [selectedMember, setSelectedMember] = useState<{ userId: string; fullName: string } | null>(null)

  const totalBalance = savingsRows.reduce((s, r) => s + r.balance, 0)
  const totalInterest = savingsRows.reduce((s, r) => s + r.interestEarned, 0)
  const activeAccounts = savingsRows.filter(r => r.status === 'active').length

  return (
    <div className="space-y-6">
      {/* KPI row */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <KpiCard
          label="Total Balance"
          value={isLoading ? '…' : currency(totalBalance)}
          sub="Sum of all account balances"
          valueClass="text-green-700"
        />
        <KpiCard
          label="Total Interest Paid"
          value={isLoading ? '…' : currency(totalInterest)}
          sub="Cumulative interest released"
        />
        <KpiCard
          label="Active Accounts"
          value={activeAccounts}
          sub="Savings accounts open"
          valueClass="text-blue-700"
        />
        <KpiCard
          label="Pending"
          value={`${pendingDeposits}D / ${pendingWithdrawals}W`}
          sub="Deposits / Withdrawals"
          valueClass={pendingDeposits + pendingWithdrawals > 0 ? 'text-amber-600' : 'text-gray-900'}
        />
      </div>

      {/* Quick actions */}
      <div className="flex flex-wrap gap-3">
        <button
          onClick={() => navigate('/admin/savings-deposits')}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          Deposit Queue
          {pendingDeposits > 0 && (
            <span className="bg-white text-blue-600 rounded-full text-xs font-bold px-1.5 py-0.5 min-w-[20px] text-center">
              {pendingDeposits}
            </span>
          )}
        </button>
        <button
          onClick={() => navigate('/admin/savings-withdrawals')}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white border border-gray-200 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors"
        >
          Withdrawals
          {pendingWithdrawals > 0 && (
            <span className="bg-amber-100 text-amber-700 rounded-full text-xs font-bold px-1.5 py-0.5 min-w-[20px] text-center">
              {pendingWithdrawals}
            </span>
          )}
        </button>
      </div>

      {/* Savings accounts table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-700">Savings Accounts</h3>
        </div>
        {isLoading ? (
          <p className="text-sm text-gray-400 text-center py-8">Loading…</p>
        ) : savingsRows.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">No savings accounts found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                  <th className="text-left px-4 py-2 font-medium">Member</th>
                  <th className="text-right px-4 py-2 font-medium">Balance</th>
                  <th className="text-right px-4 py-2 font-medium">Interest Earned</th>
                  <th className="text-left px-4 py-2 font-medium hidden sm:table-cell">Last Deposit</th>
                  <th className="text-left px-4 py-2 font-medium hidden sm:table-cell">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {savingsRows.map(row => (
                  <tr
                    key={row.account_id}
                    className="hover:bg-gray-50 cursor-pointer transition-colors"
                    onClick={() => setSelectedMember({ userId: row.user_id, fullName: row.full_name })}
                  >
                    <td className="px-4 py-2.5 font-medium text-gray-900">{row.full_name}</td>
                    <td className="px-4 py-2.5 text-right font-semibold text-gray-900">{currency(row.balance)}</td>
                    <td className="px-4 py-2.5 text-right text-green-700">{currency(row.interestEarned)}</td>
                    <td className="px-4 py-2.5 text-gray-500 hidden sm:table-cell">
                      {row.lastDepositAt ? formatDate(row.lastDepositAt) : '—'}
                    </td>
                    <td className="px-4 py-2.5 hidden sm:table-cell">
                      <StatusBadge status={row.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selectedMember && (
        <SavingsMemberModal
          userId={selectedMember.userId}
          fullName={selectedMember.fullName}
          onClose={() => setSelectedMember(null)}
        />
      )}
    </div>
  )
}

function LoansTab() {
  const { format: currency } = useCurrency()
  const { data: stats } = useLoanPortfolioStats()
  const { data: loans = [], isLoading: loansLoading } = useOverviewLoanList()
  const { data: aging = [], isLoading: agingLoading } = useLoanAgingReport()
  const [selectedLoanId, setSelectedLoanId] = useState<string | null>(null)

  return (
    <div className="space-y-6">
      {/* KPI row */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <KpiCard
          label="Total Disbursed"
          value={stats ? currency(stats.totalDisbursed) : '…'}
          sub="Principal across all loans"
        />
        <KpiCard
          label="Total Outstanding"
          value={stats ? currency(stats.totalOutstanding) : '…'}
          sub="Remaining balance"
          valueClass="text-amber-600"
        />
        <KpiCard
          label="Total Repaid"
          value={stats ? currency(stats.totalRepaid) : '…'}
          sub="Payments received"
          valueClass="text-green-700"
        />
        <KpiCard
          label="Active / Defaulted"
          value={stats ? `${stats.activeLoans} / ${stats.defaultedLoans}` : '…'}
          sub="Active loans / Defaulted"
          valueClass={stats && stats.defaultedLoans > 0 ? 'text-red-600' : 'text-gray-900'}
        />
      </div>

      {/* Aging / delinquency table */}
      {aging.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-700">Aging / Delinquency Report</h3>
          </div>
          {agingLoading ? (
            <p className="text-sm text-gray-400 text-center py-8">Loading…</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                    <th className="text-left px-4 py-2 font-medium">Member</th>
                    <th className="text-right px-4 py-2 font-medium">Principal</th>
                    <th className="text-right px-4 py-2 font-medium">Outstanding</th>
                    <th className="text-right px-4 py-2 font-medium">Days Overdue</th>
                    <th className="text-left px-4 py-2 font-medium hidden sm:table-cell">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {aging.map(row => (
                    <tr key={row.loan_id} className="hover:bg-gray-50 cursor-pointer transition-colors" onClick={() => setSelectedLoanId(row.loan_id)}>
                      <td className="px-4 py-2.5 font-medium text-gray-900">{row.full_name}</td>
                      <td className="px-4 py-2.5 text-right text-gray-600">{currency(row.principal)}</td>
                      <td className="px-4 py-2.5 text-right font-semibold text-gray-900">{currency(row.outstanding)}</td>
                      <td className={`px-4 py-2.5 text-right font-semibold ${row.days_overdue > 30 ? 'text-red-600' : 'text-amber-600'}`}>
                        {row.days_overdue}
                      </td>
                      <td className="px-4 py-2.5 hidden sm:table-cell">
                        <StatusBadge status={row.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Loan portfolio table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-700">Loan Portfolio (Recent 50)</h3>
        </div>
        {loansLoading ? (
          <p className="text-sm text-gray-400 text-center py-8">Loading…</p>
        ) : loans.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">No loans found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                  <th className="text-left px-4 py-2 font-medium">Member</th>
                  <th className="text-right px-4 py-2 font-medium">Principal</th>
                  <th className="text-right px-4 py-2 font-medium">Outstanding</th>
                  <th className="text-left px-4 py-2 font-medium hidden sm:table-cell">Disbursed</th>
                  <th className="text-left px-4 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {loans.map(loan => (
                  <tr
                    key={loan.id}
                    className="hover:bg-gray-50 cursor-pointer transition-colors"
                    onClick={() => setSelectedLoanId(loan.id)}
                  >
                    <td className="px-4 py-2.5 font-medium text-gray-900">{loan.full_name}</td>
                    <td className="px-4 py-2.5 text-right text-gray-600">{currency(loan.principal)}</td>
                    <td className="px-4 py-2.5 text-right font-semibold text-gray-900">{currency(loan.outstanding)}</td>
                    <td className="px-4 py-2.5 text-gray-500 hidden sm:table-cell">{formatDate(loan.disbursed_at)}</td>
                    <td className="px-4 py-2.5">
                      <StatusBadge status={loan.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selectedLoanId && (
        <LoanDetailModal loanId={selectedLoanId} onClose={() => setSelectedLoanId(null)} />
      )}
    </div>
  )
}

function BranchesTab() {
  const { format: currency } = useCurrency()
  const { data: branches = [], isLoading: branchesLoading } = useBranches()
  const { data: allIncome = [], isLoading: incomeLoading } = useAllBranchIncome()
  const { data: allExpenses = [], isLoading: expensesLoading } = useAllBranchExpenses()

  const [expandedBranch, setExpandedBranch] = useState<string | null>(null)
  const [branchTab, setBranchTab] = useState<Record<string, 'income' | 'expenses'>>({})

  const isLoading = branchesLoading || incomeLoading || expensesLoading

  const totalRevenue = allIncome.reduce((s, i) => s + i.amount, 0)
  const totalExpenses = allExpenses.reduce((s, e) => s + e.amount, 0)
  const netProfit = totalRevenue - totalExpenses
  const overallMargin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : null

  const getTab = (branchId: string) => branchTab[branchId] ?? 'income'
  const setTab = (branchId: string, t: 'income' | 'expenses') =>
    setBranchTab(prev => ({ ...prev, [branchId]: t }))

  return (
    <div className="space-y-6">
      {/* Overall KPI cards */}
      <div>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Overall Performance</h2>
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
          <KpiCard
            label="Total Revenue"
            value={currency(totalRevenue)}
            sub="All branches, all time"
          />
          <KpiCard
            label="Total Expenses"
            value={currency(totalExpenses)}
            sub="All branches, all time"
            valueClass="text-red-600"
          />
          <KpiCard
            label="Net Profit"
            value={currency(netProfit)}
            sub="Revenue minus expenses"
            valueClass={netProfit >= 0 ? 'text-green-700' : 'text-red-600'}
          />
          <KpiCard
            label="Profit Margin"
            value={overallMargin === null ? '—' : `${overallMargin.toFixed(1)}%`}
            sub="Net profit as % of revenue"
            valueClass={
              overallMargin === null
                ? 'text-gray-400'
                : overallMargin >= 0
                ? 'text-green-700'
                : 'text-red-600'
            }
          />
        </div>
      </div>

      {/* Per-branch cards */}
      <div>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
          Branches ({branches.length})
        </h2>

        {isLoading ? (
          <p className="text-sm text-gray-400 text-center py-8">Loading branch data…</p>
        ) : branches.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
            <p className="px-6 py-8 text-sm text-gray-400 text-center">No branches have been set up yet.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {branches.map(branch => {
              const income = allIncome.filter(i => i.branch_id === branch.id)
              const expenses = allExpenses.filter(e => e.branch_id === branch.id)
              const branchRevenue = income.reduce((s, i) => s + i.amount, 0)
              const branchExpenses = expenses.reduce((s, e) => s + e.amount, 0)
              const branchNet = branchRevenue - branchExpenses
              const branchMargin = branchRevenue > 0 ? (branchNet / branchRevenue) * 100 : null

              const isExpanded = expandedBranch === branch.id
              const activeTab = getTab(branch.id)

              const recentIncome = income.slice(0, 3)
              const recentExpenses = expenses.slice(0, 3)

              return (
                <div key={branch.id} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                  {/* Branch header */}
                  <div className="px-4 py-3 border-b border-gray-100">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0">
                          <svg className="w-4 h-4 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                              d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                          </svg>
                        </div>
                        <div>
                          <h3 className="text-sm font-semibold text-gray-900">{branch.name}</h3>
                          {branch.location && (
                            <p className="text-xs text-gray-500">{branch.location}</p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${branch.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                          {branch.is_active ? 'Active' : 'Inactive'}
                        </span>
                        <button
                          onClick={() => setExpandedBranch(isExpanded ? null : branch.id)}
                          className="text-xs text-blue-600 hover:text-blue-700 font-medium"
                        >
                          {isExpanded ? 'Collapse' : 'Details'}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Branch KPI row */}
                  <div className="px-4 py-3 grid grid-cols-2 sm:grid-cols-4 gap-3 bg-gray-50 text-xs">
                    <div>
                      <p className="text-gray-500">Revenue</p>
                      <p className="font-semibold text-gray-900">{currency(branchRevenue)}</p>
                    </div>
                    <div>
                      <p className="text-gray-500">Expenses</p>
                      <p className="font-semibold text-red-600">{currency(branchExpenses)}</p>
                    </div>
                    <div>
                      <p className="text-gray-500">Net Profit</p>
                      <p className={`font-semibold ${branchNet >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                        {currency(branchNet)}
                      </p>
                    </div>
                    <div>
                      <p className="text-gray-500">Margin</p>
                      <p className={`font-semibold ${branchMargin === null ? 'text-gray-400' : branchMargin >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                        {branchMargin === null ? '—' : `${branchMargin.toFixed(1)}%`}
                      </p>
                    </div>
                  </div>

                  {/* Expandable details */}
                  {isExpanded && (
                    <>
                      <div className="flex border-b border-gray-100 bg-white">
                        <button
                          className={`px-4 py-2 text-xs font-medium transition-colors ${activeTab === 'income' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
                          onClick={() => setTab(branch.id, 'income')}
                        >
                          Recent Income
                        </button>
                        <button
                          className={`px-4 py-2 text-xs font-medium transition-colors ${activeTab === 'expenses' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
                          onClick={() => setTab(branch.id, 'expenses')}
                        >
                          Recent Expenses
                        </button>
                      </div>

                      {activeTab === 'income' && (
                        recentIncome.length === 0 ? (
                          <p className="px-4 py-3 text-xs text-gray-400 italic">No income recorded yet.</p>
                        ) : (
                          <div className="divide-y divide-gray-50">
                            {recentIncome.map(inc => (
                              <div key={inc.id} className="px-4 py-3 flex items-center gap-3">
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium text-gray-900">{currency(inc.amount)}</p>
                                  <p className="text-xs text-gray-500">
                                    {formatDate(inc.period_start)} – {formatDate(inc.period_end)}
                                    {inc.description && ` · ${inc.description}`}
                                  </p>
                                </div>
                                {inc.distributed && (
                                  <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium shrink-0">
                                    Distributed
                                  </span>
                                )}
                              </div>
                            ))}
                            {income.length > 3 && (
                              <p className="px-4 py-2 text-xs text-gray-400 italic">
                                +{income.length - 3} more records
                              </p>
                            )}
                          </div>
                        )
                      )}

                      {activeTab === 'expenses' && (
                        recentExpenses.length === 0 ? (
                          <p className="px-4 py-3 text-xs text-gray-400 italic">No expenses recorded yet.</p>
                        ) : (
                          <div className="divide-y divide-gray-50">
                            {recentExpenses.map(exp => (
                              <div key={exp.id} className="px-4 py-3 flex items-center gap-3">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 mb-0.5">
                                    <span className={`text-xs px-1.5 py-0.5 rounded font-medium capitalize ${categoryBadgeColors[exp.category]}`}>
                                      {exp.category}
                                    </span>
                                    <p className="text-sm font-medium text-gray-900">{currency(exp.amount)}</p>
                                  </div>
                                  <p className="text-xs text-gray-500">
                                    {formatDate(exp.period_start)} – {formatDate(exp.period_end)}
                                    {exp.description && ` · ${exp.description}`}
                                  </p>
                                </div>
                              </div>
                            ))}
                            {expenses.length > 3 && (
                              <p className="px-4 py-2 text-xs text-gray-400 italic">
                                +{expenses.length - 3} more records
                              </p>
                            )}
                          </div>
                        )
                      )}
                    </>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Combined member accounts tab ────────────────────────────────────────────

function MemberAccountsTab() {
  return (
    <div className="space-y-10">
      {/* Equity section */}
      <div>
        <div className="flex items-center gap-3 mb-4">
          <div className="flex items-center gap-2">
            <div className="w-1 h-5 bg-blue-500 rounded-full" />
            <h2 className="text-base font-semibold text-gray-900">Equity Shares</h2>
          </div>
          <div className="flex-1 h-px bg-gray-100" />
        </div>
        <EquityTab />
      </div>

      {/* Savings section */}
      <div>
        <div className="flex items-center gap-3 mb-4">
          <div className="flex items-center gap-2">
            <div className="w-1 h-5 bg-emerald-500 rounded-full" />
            <h2 className="text-base font-semibold text-gray-900">Savings</h2>
          </div>
          <div className="flex-1 h-px bg-gray-100" />
        </div>
        <SavingsTab />
      </div>
    </div>
  )
}

// ─── Reports tab ──────────────────────────────────────────────────────────────

function useMemberListForReport(dateFrom: string, dateTo: string) {
  return useQuery({
    queryKey: ['report_member_list', dateFrom, dateTo],
    queryFn: async () => {
      let q = supabase
        .from('profiles')
        .select('id, full_name, account_status, employee_id, created_at, membership_status(status, completed_shares)')
        .eq('role', 'member')
        .order('full_name')
      if (dateFrom) q = q.gte('created_at', dateFrom)
      if (dateTo) q = q.lte('created_at', dateTo + 'T23:59:59')
      const { data, error } = await q
      if (error) throw error
      return (data ?? []).map((m: any) => ({
        ...m,
        membership_status: Array.isArray(m.membership_status) ? m.membership_status[0] ?? null : m.membership_status ?? null,
      }))
    },
  })
}

function useAllLoansForExport() {
  return useQuery({
    queryKey: ['overview_all_loans_export'],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('loans')
        .select('principal, outstanding, status, disbursed_at, user_id')
        .order('disbursed_at', { ascending: false })
      if (error) throw error
      const userIds = [...new Set((data as any[]).map(r => r.user_id).filter(Boolean))]
      let nameMap: Record<string, string> = {}
      if (userIds.length > 0) {
        const { data: profiles } = await supabase.from('profiles').select('id, full_name').in('id', userIds)
        if (profiles) nameMap = Object.fromEntries((profiles as any[]).map(p => [p.id, p.full_name]))
      }
      return (data as any[]).map(r => ({
        member_name: nameMap[r.user_id] ?? 'Unknown',
        amount: r.principal,
        outstanding: r.outstanding,
        status: r.status,
        disbursed_at: r.disbursed_at,
      }))
    },
  })
}

function ReportsTab() {
  const { format: currency, symbol: currencySymbol } = useCurrency()
  const [modalOpen, setModalOpen] = useState(false)
  const [reportType, setReportType] = useState<'members' | 'loans'>('members')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const hasDateFilter = !!(dateFrom || dateTo)

  const { data: membershipBreakdown } = useMembershipBreakdown()
  const { data: loanStats } = useLoanPortfolioStats()
  const { data: totalEquity = 0 } = useTotalEquity()
  const { data: contributions = [] } = useMonthlyContributions()
  const { data: newMembers = [] } = useMonthlyNewMembers()
  const { data: membersRaw = [], isLoading: membersLoading } = useMemberListForReport(dateFrom, dateTo)
  const { data: allLoansExport = [] } = useAllLoansForExport()

  const totalMembers = membershipBreakdown ? Object.values(membershipBreakdown).reduce((a, b) => a + b, 0) : 0

  const filteredMembers = (membersRaw as any[]).filter((m: any) => {
    const matchesSearch = m.full_name.toLowerCase().includes(search.toLowerCase())
    const ms = m.membership_status?.status ?? 'pending'
    const matchesStatus = statusFilter === 'all' || ms === statusFilter
    return matchesSearch && matchesStatus
  })

  function closeModal() {
    setModalOpen(false)
    setReportType('members')
    setSearch('')
    setStatusFilter('all')
    setDateFrom('')
    setDateTo('')
  }

  function handleExcelExport() {
    const rows = filteredMembers.map((m: any) => ({
      Name: m.full_name,
      'Employee ID': m.employee_id ?? '',
      'Membership Status': m.membership_status?.status ?? 'pending',
      'Completed Shares': m.membership_status?.completed_shares ?? 0,
      Joined: m.created_at,
    }))
    exportToExcel(rows, 'members-report')
  }

  function handleMembersPdfExport() {
    exportMembersPdf(
      filteredMembers.map((m: any) => ({
        full_name: m.full_name,
        account_status: m.account_status,
        membership_status: m.membership_status?.status ?? 'pending',
        completed_shares: m.membership_status?.completed_shares ?? 0,
      })),
      `${filteredMembers.length} member${filteredMembers.length !== 1 ? 's' : ''}${hasDateFilter ? ' (filtered by date)' : ''}`
    )
  }

  function handleLoansPdfExport() {
    exportLoanPortfolioPdf(allLoansExport, {
      totalDisbursed: loanStats?.totalDisbursed ?? 0,
      totalOutstanding: loanStats?.totalOutstanding ?? 0,
      totalRepaid: loanStats?.totalRepaid ?? 0,
      activeLoans: loanStats?.activeLoans ?? 0,
    })
  }

  return (
    <div className="space-y-6">
      {/* Header row with Generate Report button */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-500">Analytics overview and printable reports for the cooperative.</p>
        </div>
        <button
          onClick={() => setModalOpen(true)}
          className="inline-flex items-center gap-2 bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-700 transition-colors shadow-sm"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          Generate Report
        </button>
      </div>

      {/* Generate Report Modal */}
      {modalOpen && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={closeModal} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh]">
            {/* Modal header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="text-base font-semibold text-gray-900">Generate Report</h2>
              <button onClick={closeModal} className="text-gray-400 hover:text-gray-600 transition-colors">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Modal body */}
            <div className="overflow-y-auto px-6 py-5 space-y-5">
              {/* Report type selector */}
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Report Type</label>
                <div className="grid grid-cols-2 gap-2">
                  {([
                    { value: 'members', label: 'Members List', icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z' },
                    { value: 'loans', label: 'Loan Portfolio', icon: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
                  ] as const).map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => setReportType(opt.value)}
                      className={`flex items-center gap-3 p-3 rounded-xl border-2 text-sm font-medium transition-all text-left ${
                        reportType === opt.value
                          ? 'border-blue-500 bg-blue-50 text-blue-700'
                          : 'border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50'
                      }`}
                    >
                      <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d={opt.icon} />
                      </svg>
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Members filters */}
              {reportType === 'members' && (
                <div className="space-y-3">
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide">Filters</label>

                  {/* Search */}
                  <div className="relative">
                    <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    <input
                      type="text"
                      placeholder="Search by name…"
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg pl-9 pr-8 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    {search && (
                      <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                      </button>
                    )}
                  </div>

                  {/* Status */}
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Membership Status</label>
                    <select
                      value={statusFilter}
                      onChange={e => setStatusFilter(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                    >
                      <option value="all">All statuses</option>
                      <option value="active">Active</option>
                      <option value="pending">Pending</option>
                      <option value="inactive">Inactive</option>
                      <option value="suspended">Suspended</option>
                    </select>
                  </div>

                  {/* Date range */}
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Joined Date Range</label>
                    <div className="flex items-center gap-2">
                      <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                        className="flex-1 border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      <span className="text-xs text-gray-400">–</span>
                      <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                        className="flex-1 border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      {hasDateFilter && (
                        <button onClick={() => { setDateFrom(''); setDateTo('') }}
                          className="flex-shrink-0 text-xs text-gray-500 hover:text-gray-700 border border-gray-300 rounded-lg px-2 py-1.5 hover:bg-gray-50">
                          Clear
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Preview count */}
                  <div className={`rounded-lg px-3 py-2.5 text-sm flex items-center gap-2 ${membersLoading ? 'bg-gray-50 text-gray-400' : 'bg-blue-50 text-blue-700'}`}>
                    <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    {membersLoading
                      ? 'Loading members…'
                      : <><strong>{filteredMembers.length}</strong>&nbsp;member{filteredMembers.length !== 1 ? 's' : ''} will be included in this report.</>
                    }
                  </div>
                </div>
              )}

              {/* Loans info */}
              {reportType === 'loans' && (
                <div className="bg-blue-50 rounded-lg px-3 py-2.5 text-sm flex items-center gap-2 text-blue-700">
                  <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span>Includes all <strong>{allLoansExport.length}</strong> loan record{allLoansExport.length !== 1 ? 's' : ''} with outstanding balances and status.</span>
                </div>
              )}
            </div>

            {/* Modal footer */}
            <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 rounded-b-2xl flex items-center justify-between gap-3">
              <button onClick={closeModal} className="text-sm text-gray-500 hover:text-gray-700 font-medium">Cancel</button>
              <div className="flex gap-2">
                {reportType === 'members' ? (
                  <>
                    <button
                      onClick={handleExcelExport}
                      disabled={membersLoading || filteredMembers.length === 0}
                      className="inline-flex items-center gap-1.5 bg-green-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" /></svg>
                      Export Excel
                    </button>
                    <button
                      onClick={handleMembersPdfExport}
                      disabled={membersLoading || filteredMembers.length === 0}
                      className="inline-flex items-center gap-1.5 bg-red-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" /></svg>
                      Export PDF
                    </button>
                  </>
                ) : (
                  <button
                    onClick={handleLoansPdfExport}
                    className="inline-flex items-center gap-1.5 bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-700 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" /></svg>
                    Export PDF
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <KpiCard label="Total Members" value={formatNumber(totalMembers)} sub="All roles" />
        <KpiCard label="Active Members" value={formatNumber(membershipBreakdown?.active ?? 0)} sub={`${formatNumber(membershipBreakdown?.pending ?? 0)} pending`} valueClass="text-green-700" />
        <KpiCard label="Total Equity Raised" value={currency(totalEquity)} sub="All contributions" />
        <KpiCard label="Active Loans" value={formatNumber(loanStats?.activeLoans ?? 0)} sub={`${currency(loanStats?.totalOutstanding ?? 0)} outstanding`} valueClass="text-amber-600" />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Monthly Contributions (Last 12 Months)</h3>
          {contributions.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">No data yet</p>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={contributions} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => `${currencySymbol}${(v / 1000).toFixed(0)}k`} width={55} />
                <Tooltip formatter={(v: number) => [currency(v), 'Amount']} />
                <Bar dataKey="amount" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">New Members (Last 12 Months)</h3>
          {newMembers.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">No data yet</p>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={newMembers} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} width={35} />
                <Tooltip formatter={(v: number) => [v, 'New Members']} />
                <Line type="monotone" dataKey="count" stroke="#10b981" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Membership breakdown */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">Membership Breakdown</h3>
        <div className="space-y-3">
          {membershipBreakdown && Object.entries(membershipBreakdown).map(([status, count]) => (
            <div key={status} className="flex items-center gap-3">
              <StatusBadge status={status} />
              <div className="flex-1 bg-gray-100 rounded-full h-2">
                <div className="h-2 rounded-full bg-blue-500" style={{ width: totalMembers > 0 ? `${(count / totalMembers) * 100}%` : '0%' }} />
              </div>
              <span className="text-sm font-semibold text-gray-900 w-8 text-right">{formatNumber(count)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const TABS = ['Member Accounts', 'Loans', 'Cooperative', 'Reports'] as const
type Tab = typeof TABS[number]

export function OverviewPage() {
  const [tab, setTab] = useState<Tab>('Member Accounts')

  const { data: pendingDeposits = 0 } = usePendingDepositCountOverview()
  const { data: pendingSavingsDeposits = 0 } = usePendingSavingsDeposits()
  const { data: pendingSavingsWithdrawals = 0 } = usePendingSavingsWithdrawals()
  const { data: pendingLoanApplications = 0 } = usePendingLoanApplications()

  return (
    <div>
      <Header
        title="Overview"
        subtitle="Operations, analytics, and printable reports"
      />

      <PendingActionsBar
        pendingDeposits={pendingDeposits}
        pendingSavingsDeposits={pendingSavingsDeposits}
        pendingSavingsWithdrawals={pendingSavingsWithdrawals}
        pendingLoanApplications={pendingLoanApplications}
      />

      {/* Tab bar */}
      <div className="bg-white border-b border-gray-200 px-4 sm:px-6 overflow-x-auto">
        <div className="flex w-max min-w-full sm:w-auto">
          {TABS.map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors border-b-2 -mb-px ${
                tab === t
                  ? 'text-blue-600 border-blue-600'
                  : 'text-gray-500 border-transparent hover:text-gray-700'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="p-4 sm:p-6 space-y-6">
        {tab === 'Member Accounts' && <MemberAccountsTab />}
        {tab === 'Loans' && <LoansTab />}
        {tab === 'Cooperative' && <BranchesTab />}
        {tab === 'Reports' && <ReportsTab />}
      </div>
    </div>
  )
}
