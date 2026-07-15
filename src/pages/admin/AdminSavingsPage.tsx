import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useCurrency } from '../../hooks/useCurrency'
import { usePendingSavingsDepositCount, usePendingSavingsWithdrawalCount, useReleaseSavingsInterest } from '../../hooks/useSavings'
import { StatusBadge } from '../../components/shared/StatusBadge'
import { formatDate } from '../../lib/utils'
import { Button } from '../../components/ui/Button'
import { useState, useMemo } from 'react'

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function useInterestReleaseMonths() {
  return useQuery({
    queryKey: ['savings_interest_release_months'],
    queryFn: async () => {
      const { data } = await supabase
        .from('system_config')
        .select('config_value')
        .eq('config_key', 'savings_interest_release_months')
        .single()
      return (data?.config_value ?? '6,12')
        .split(',')
        .map((s: string) => parseInt(s.trim(), 10))
        .filter((n: number) => n >= 1 && n <= 12)
        .sort((a: number, b: number) => a - b) as number[]
    },
    staleTime: 60_000,
  })
}

function getNextReleaseDate(releaseMonths: number[]): Date | null {
  if (!releaseMonths.length) return null
  const now = new Date()
  const currentMonth = now.getMonth() + 1 // 1-based
  const currentYear = now.getFullYear()
  const currentDay = now.getDate()

  // Find next month that is >= current month (and not already passed the 1st today)
  for (const m of releaseMonths) {
    if (m > currentMonth || (m === currentMonth && currentDay < 1)) {
      return new Date(currentYear, m - 1, 1)
    }
  }
  // All configured months already passed this year — take the first month next year
  return new Date(currentYear + 1, releaseMonths[0] - 1, 1)
}

// ─── Hooks ───────────────────────────────────────────────────────────────────

interface SavingsAccountRow {
  id: string
  user_id: string
  balance: number
  status: string
  opened_at: string
  updated_at: string
  full_name: string
  last_deposit_at: string | null
  total_deposited: number
  interest_earned: number
}

function useAllSavingsAccounts() {
  return useQuery({
    queryKey: ['all_savings_accounts'],
    queryFn: async (): Promise<SavingsAccountRow[]> => {
      // Step 1: fetch all accounts
      const { data: accounts, error } = await supabase
        .from('savings_accounts')
        .select('id, user_id, balance, status, opened_at, updated_at')
        .order('balance', { ascending: false })

      if (error) throw error
      if (!accounts || accounts.length === 0) return []

      const userIds = accounts.map((a: { user_id: string }) => a.user_id)

      // Step 2: profile names
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name')
        .in('id', userIds)

      const profileMap = Object.fromEntries(
        (profiles ?? []).map((p: { id: string; full_name: string }) => [p.id, p.full_name])
      )

      // Step 3: last deposit date + total deposited per account
      const accountIds = accounts.map((a: { id: string }) => a.id)

      const { data: contributions } = await supabase
        .from('savings_contributions')
        .select('account_id, amount, contributed_at')
        .in('account_id', accountIds)
        .order('contributed_at', { ascending: false })

      const lastDepositMap: Record<string, string> = {}
      const totalDepositedMap: Record<string, number> = {}
      for (const c of contributions ?? []) {
        const acc = c as { account_id: string; amount: number; contributed_at: string }
        if (!lastDepositMap[acc.account_id]) lastDepositMap[acc.account_id] = acc.contributed_at
        totalDepositedMap[acc.account_id] = (totalDepositedMap[acc.account_id] ?? 0) + acc.amount
      }

      // Step 4: total interest earned per account
      const { data: interestLogs } = await supabase
        .from('savings_interest_logs')
        .select('account_id, interest_earned')
        .in('account_id', accountIds)

      const interestMap: Record<string, number> = {}
      for (const log of interestLogs ?? []) {
        const l = log as { account_id: string; interest_earned: number }
        interestMap[l.account_id] = (interestMap[l.account_id] ?? 0) + l.interest_earned
      }

      return accounts.map((a: { id: string; user_id: string; balance: number; status: string; opened_at: string; updated_at: string }) => ({
        ...a,
        full_name: profileMap[a.user_id] ?? '—',
        last_deposit_at: lastDepositMap[a.id] ?? null,
        total_deposited: totalDepositedMap[a.id] ?? 0,
        interest_earned: interestMap[a.id] ?? 0,
      }))
    },
    staleTime: 0,
  })
}

function useTotalInterestPaid() {
  return useQuery({
    queryKey: ['total_savings_interest'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('savings_interest_logs')
        .select('interest_earned')

      if (error) return 0
      return (data ?? []).reduce((sum: number, r: { interest_earned: number }) => sum + r.interest_earned, 0)
    },
    staleTime: 60_000,
  })
}

// ─── KPI Card ────────────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, color = 'default' }: {
  label: string
  value: string | number
  sub?: string
  color?: 'default' | 'blue' | 'green' | 'yellow' | 'red'
}) {
  const colorClass = {
    default: 'text-gray-900',
    blue: 'text-blue-600',
    green: 'text-emerald-600',
    yellow: 'text-yellow-600',
    red: 'text-red-600',
  }[color]

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
      <p className="text-xs font-medium text-gray-500 mb-1">{label}</p>
      <p className={`text-2xl font-bold ${colorClass}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  )
}

// ─── Page ────────────────────────────────────────────────────────────────────

export function AdminSavingsPage() {
  const navigate = useNavigate()
  const { format: currency } = useCurrency()
  const [showReleaseConfirm, setShowReleaseConfirm] = useState(false)

  const { data: accounts = [], isLoading, refetch } = useAllSavingsAccounts()
  const { data: totalInterest = 0 } = useTotalInterestPaid()
  const { data: pendingDeposits = 0 } = usePendingSavingsDepositCount()
  const { data: pendingWithdrawals = 0 } = usePendingSavingsWithdrawalCount()
  const releaseInterest = useReleaseSavingsInterest()
  const { data: releaseMonths = [6, 12] } = useInterestReleaseMonths()

  const nextRelease = useMemo(() => getNextReleaseDate(releaseMonths), [releaseMonths])
  const releaseMonthLabels = releaseMonths.map(m => MONTH_NAMES[m - 1]).join(' & ')

  const totalBalance = accounts.reduce((sum, a) => sum + a.balance, 0)
  const activeAccounts = accounts.filter(a => a.status === 'active').length
  const dormantAccounts = accounts.filter(a => a.status === 'dormant').length

  const handleRelease = () => {
    releaseInterest.mutate(undefined, {
      onSuccess: () => {
        setShowReleaseConfirm(false)
        refetch()
      },
    })
  }

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Savings Dashboard</h1>
          <p className="text-sm text-gray-500 mt-0.5">{accounts.length} member accounts</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => navigate('/admin/savings-deposits')}
          >
            Deposit Queue
            {pendingDeposits > 0 && (
              <span className="ml-1.5 flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-yellow-400 text-gray-900 text-[10px] font-bold">
                {pendingDeposits}
              </span>
            )}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => navigate('/admin/savings-withdrawals')}
          >
            Withdrawals
            {pendingWithdrawals > 0 && (
              <span className="ml-1.5 flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold">
                {pendingWithdrawals}
              </span>
            )}
          </Button>
          <div className="flex flex-col items-end gap-0.5">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowReleaseConfirm(true)}
            >
              Release Interest Now
            </Button>
            {nextRelease && (
              <p className="text-[10px] text-gray-400 whitespace-nowrap">
                Auto: {releaseMonthLabels} · next {nextRelease.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 xl:grid-cols-5 gap-3">
        <KpiCard label="Total Savings Balance" value={currency(totalBalance)} color="blue" />
        <KpiCard label="Total Interest Paid" value={currency(totalInterest)} color="green" />
        <KpiCard label="Active Accounts" value={activeAccounts} />
        <KpiCard
          label="Pending Deposits"
          value={pendingDeposits}
          color={pendingDeposits > 0 ? 'yellow' : 'default'}
          sub={pendingDeposits > 0 ? 'Needs review' : 'All clear'}
        />
        <KpiCard
          label="Pending Withdrawals"
          value={pendingWithdrawals}
          color={pendingWithdrawals > 0 ? 'red' : 'default'}
          sub={pendingWithdrawals > 0 ? 'Needs review' : 'All clear'}
        />
      </div>

      {/* Accounts Table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-900">Member Savings Accounts</h2>
          {dormantAccounts > 0 && (
            <span className="text-xs text-yellow-600 bg-yellow-50 px-2 py-0.5 rounded-full">
              {dormantAccounts} dormant
            </span>
          )}
        </div>

        {isLoading ? (
          <div className="py-12 text-center text-gray-400 text-sm">Loading accounts…</div>
        ) : accounts.length === 0 ? (
          <div className="py-12 text-center text-gray-400 text-sm">No savings accounts yet.</div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  <tr>
                    <th className="px-4 py-3 text-left">Member</th>
                    <th className="px-4 py-3 text-right">Balance</th>
                    <th className="px-4 py-3 text-right">Total Deposited</th>
                    <th className="px-4 py-3 text-right">Interest Earned</th>
                    <th className="px-4 py-3 text-left">Last Deposit</th>
                    <th className="px-4 py-3 text-left">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {accounts.map(account => (
                    <tr
                      key={account.id}
                      onClick={() => navigate(`/admin/members/${account.user_id}`)}
                      className="hover:bg-gray-50 cursor-pointer transition-colors"
                    >
                      <td className="px-4 py-3 font-medium text-gray-900">{account.full_name}</td>
                      <td className="px-4 py-3 text-right font-semibold text-gray-900">
                        {currency(account.balance)}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-600">
                        {currency(account.total_deposited)}
                      </td>
                      <td className="px-4 py-3 text-right text-emerald-600 font-medium">
                        {account.interest_earned > 0 ? currency(account.interest_earned) : '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-500">
                        {account.last_deposit_at ? formatDate(account.last_deposit_at) : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={account.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-gray-50 border-t border-gray-200">
                  <tr>
                    <td className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Total</td>
                    <td className="px-4 py-3 text-right font-bold text-gray-900">{currency(totalBalance)}</td>
                    <td className="px-4 py-3 text-right font-semibold text-gray-600">
                      {currency(accounts.reduce((s, a) => s + a.total_deposited, 0))}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-emerald-600">
                      {currency(totalInterest)}
                    </td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden divide-y divide-gray-100">
              {accounts.map(account => (
                <div
                  key={account.id}
                  onClick={() => navigate(`/admin/members/${account.user_id}`)}
                  className="px-4 py-3 hover:bg-gray-50 cursor-pointer transition-colors"
                >
                  <div className="flex items-start justify-between mb-1.5">
                    <span className="font-medium text-gray-900 text-sm">{account.full_name}</span>
                    <StatusBadge status={account.status} />
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                    <div>
                      <span className="text-gray-400">Balance </span>
                      <span className="font-semibold text-gray-900">{currency(account.balance)}</span>
                    </div>
                    <div>
                      <span className="text-gray-400">Interest </span>
                      <span className="text-emerald-600 font-medium">
                        {account.interest_earned > 0 ? currency(account.interest_earned) : '—'}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-400">Last deposit </span>
                      <span className="text-gray-600">
                        {account.last_deposit_at ? formatDate(account.last_deposit_at) : '—'}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Release Interest Confirmation */}
      {showReleaseConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm">
            <h3 className="text-base font-semibold text-gray-900 mb-1">Release Savings Interest Now?</h3>
            <p className="text-sm text-gray-500 mb-5">
              This will immediately credit interest to all active savings accounts based on the configured rate.
              Interest is normally released automatically in <strong>{releaseMonthLabels}</strong>.
              This manual release will bypass that schedule. The action cannot be undone.
            </p>
            <div className="flex gap-3">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setShowReleaseConfirm(false)}
                disabled={releaseInterest.isPending}
              >
                Cancel
              </Button>
              <Button
                className="flex-1"
                loading={releaseInterest.isPending}
                onClick={handleRelease}
              >
                Confirm Release
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
