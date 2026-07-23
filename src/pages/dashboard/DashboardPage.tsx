import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useEquityShares, useAllContributions } from '../../hooks/useEquity'
import { useSavingsAccount, useSavingsContributions } from '../../hooks/useSavings'
import { useLoans } from '../../hooks/useLoans'
import { useCurrency } from '../../hooks/useCurrency'
import { useAuth } from '../../context/AuthContext'
import { Header } from '../../components/layout/Header'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(date: string) {
  return new Date(date).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
}

function ProgressBar({ value, max, color = 'blue' }: { value: number; max: number; color?: 'blue' | 'green' }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  const bg = color === 'green' ? '#16a34a' : pct >= 100 ? '#16a34a' : '#2563eb'
  return (
    <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
      <div className="h-1.5 rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: bg }} />
    </div>
  )
}

function SectionLock({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-center">
      <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center mb-2.5">
        <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
        </svg>
      </div>
      <p className="text-xs text-gray-400 max-w-[180px]">{message}</p>
    </div>
  )
}

function SectionTitle({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <div className="w-7 h-7 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
        {icon}
      </div>
      <h2 className="text-sm font-semibold text-gray-700">{label}</h2>
    </div>
  )
}

// ─── Shares section ───────────────────────────────────────────────────────────

function SharesSection() {
  const { format: currency } = useCurrency()
  const { data: shares = [], isLoading } = useEquityShares()
  const { data: contributions = [] } = useAllContributions()

  if (isLoading) return <div className="py-8 text-center text-sm text-gray-400">Loading…</div>

  if (shares.length === 0) {
    return <p className="text-sm text-gray-400 text-center py-8">No share subscription found. Contact admin.</p>
  }

  const activeShare = shares.find(s => s.status === 'in_progress') ?? shares[shares.length - 1]
  const completedCount = shares.filter(s => s.status === 'completed').length
  const totalPaid = shares.reduce((sum, s) => sum + (s.paid_amount ?? 0), 0)
  const pct = activeShare.target_amount > 0
    ? Math.min(100, Math.round((activeShare.paid_amount / activeShare.target_amount) * 100))
    : 0
  const recentContributions = contributions.slice(0, 5)

  return (
    <div className="space-y-4">
      {/* Active share card */}
      <div className="rounded-xl bg-blue-50 p-4">
        <div className="flex items-center justify-between mb-2">
          <div>
            <p className="text-xs text-blue-600 font-medium">Share #{activeShare.share_number}</p>
            <p className="text-2xl font-bold text-blue-900 mt-0.5">{currency(activeShare.paid_amount)}</p>
            <p className="text-xs text-blue-500 mt-0.5">of {currency(activeShare.target_amount)}</p>
          </div>
          <div className="text-right">
            <span className={`text-2xl font-bold ${pct >= 100 ? 'text-green-600' : 'text-blue-700'}`}>{pct}%</span>
            {activeShare.status === 'completed' && (
              <p className="text-xs text-green-600 font-medium mt-0.5">Completed</p>
            )}
          </div>
        </div>
        <ProgressBar value={activeShare.paid_amount} max={activeShare.target_amount} />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl border border-gray-100 p-3 text-center">
          <p className="text-xl font-bold text-gray-900">{completedCount}</p>
          <p className="text-xs text-gray-400 mt-0.5">Completed</p>
        </div>
        <div className="rounded-xl border border-gray-100 p-3 text-center">
          <p className="text-xl font-bold text-gray-900">{currency(totalPaid)}</p>
          <p className="text-xs text-gray-400 mt-0.5">Total paid</p>
        </div>
      </div>

      {/* Recent deposits */}
      {recentContributions.length > 0 && (
        <div>
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Recent deposits</p>
          <div className="divide-y divide-gray-50">
            {recentContributions.map(c => (
              <div key={c.id} className="flex justify-between items-center py-2">
                <div>
                  <p className="text-xs text-gray-600">{fmt(c.contribution_at ?? c.created_at)}</p>
                  {c.reference && <p className="text-xs text-gray-400">{c.reference}</p>}
                </div>
                <span className="text-sm font-medium text-gray-900">{currency(c.amount)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Savings section ──────────────────────────────────────────────────────────

function SavingsSection({ hasCompletedShare }: { hasCompletedShare: boolean }) {
  const { format: currency } = useCurrency()
  const { data: account, isLoading } = useSavingsAccount()
  const { data: contributions = [] } = useSavingsContributions(account?.id ?? '')

  if (!hasCompletedShare) {
    return <SectionLock message="Complete your first share to unlock savings." />
  }
  if (isLoading) return <div className="py-8 text-center text-sm text-gray-400">Loading…</div>
  if (!account) {
    return <p className="text-sm text-gray-400 text-center py-8">No savings account yet. Contact admin.</p>
  }

  const recent = contributions.slice(0, 5)

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-green-50 p-4 text-center">
        <p className="text-xs text-green-600 font-medium">Balance</p>
        <p className="text-2xl font-bold text-green-800 mt-1">{currency(account.balance)}</p>
        <p className="text-xs text-green-500 mt-0.5 capitalize">{account.status}</p>
      </div>

      {recent.length > 0 && (
        <div>
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Recent transactions</p>
          <div className="divide-y divide-gray-50">
            {recent.map(c => (
              <div key={c.id} className="flex justify-between items-center py-2">
                <div>
                  <p className="text-xs text-gray-600">{fmt(c.contributed_at ?? c.created_at)}</p>
                  {c.reference && <p className="text-xs text-gray-400">{c.reference}</p>}
                </div>
                <span className="text-sm font-medium text-green-700">+{currency(c.amount)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Loans section ────────────────────────────────────────────────────────────

function LoansSection({ hasCompletedShare }: { hasCompletedShare: boolean }) {
  const { format: currency } = useCurrency()
  const navigate = useNavigate()
  const { data: loans = [], isLoading } = useLoans()

  if (!hasCompletedShare) {
    return <SectionLock message="Complete your first share to become eligible for loans." />
  }
  if (isLoading) return <div className="py-8 text-center text-sm text-gray-400">Loading…</div>

  const activeLoans = loans.filter(l => l.status === 'active')

  if (activeLoans.length === 0) {
    return (
      <div className="py-6 text-center space-y-3">
        <p className="text-sm text-gray-400">No active loans.</p>
        <button
          onClick={() => navigate('/loans/apply')}
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          Apply for a Loan
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {activeLoans.map(loan => {
        const progress = loan.total_repayable > 0
          ? Math.min(100, Math.round(((loan.amount_paid ?? 0) / loan.total_repayable) * 100))
          : 0
        return (
          <div
            key={loan.id}
            className="border border-gray-100 rounded-xl p-3.5 cursor-pointer hover:border-blue-200 hover:bg-blue-50/30 transition-colors"
            onClick={() => navigate(`/loans/${loan.id}`)}
          >
            <div className="flex justify-between items-start mb-2">
              <div>
                <p className="text-sm font-semibold text-gray-900">{currency(loan.principal)}</p>
                <p className="text-xs text-gray-400 mt-0.5">{loan.term_months}mo · {loan.interest_rate}%</p>
              </div>
              <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">{loan.status}</span>
            </div>
            <ProgressBar value={loan.amount_paid ?? 0} max={loan.total_repayable} />
            <div className="flex justify-between mt-1.5 text-xs text-gray-400">
              <span>{currency(loan.outstanding)} left</span>
              <span>{progress}% paid</span>
            </div>
            {loan.due_date && (
              <p className="text-xs text-orange-500 mt-1.5">Due {fmt(loan.due_date)}</p>
            )}
          </div>
        )
      })}
      <button
        onClick={() => navigate('/loans/apply')}
        className="w-full py-2 text-sm text-blue-600 hover:text-blue-700 font-medium"
      >
        + Apply for another loan
      </button>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

type Tab = 'shares' | 'savings' | 'loans'

export function DashboardPage() {
  const { profile } = useAuth()
  const { data: shares = [] } = useEquityShares()
  const [tab, setTab] = useState<Tab>('shares')

  const hasCompletedShare = shares.some(s => s.status === 'completed')

  const tabs: { value: Tab; label: string; icon: React.ReactNode; locked: boolean }[] = [
    {
      value: 'shares',
      label: 'Shares',
      locked: false,
      icon: (
        <svg className="w-3.5 h-3.5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
      ),
    },
    {
      value: 'savings',
      label: 'Savings',
      locked: !hasCompletedShare,
      icon: (
        <svg className="w-3.5 h-3.5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
        </svg>
      ),
    },
    {
      value: 'loans',
      label: 'Loans',
      locked: !hasCompletedShare,
      icon: (
        <svg className="w-3.5 h-3.5 text-purple-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    },
  ]

  return (
    <div>
      <Header
        title={`Hi, ${profile?.full_name?.split(' ')[0] ?? 'there'} 👋`}
        subtitle="Your cooperative accounts at a glance"
      />

      <div className="p-4 sm:p-6">

        {/* ── Desktop: 3-column grid ── */}
        <div className="hidden lg:grid lg:grid-cols-3 lg:gap-5">
          {tabs.map(t => (
            <div key={t.value} className="bg-white rounded-2xl border border-gray-100 p-5">
              <SectionTitle icon={t.icon} label={t.label} />
              {t.value === 'shares' && <SharesSection />}
              {t.value === 'savings' && <SavingsSection hasCompletedShare={hasCompletedShare} />}
              {t.value === 'loans' && <LoansSection hasCompletedShare={hasCompletedShare} />}
            </div>
          ))}
        </div>

        {/* ── Mobile: tab switcher ── */}
        <div className="lg:hidden space-y-4">
          <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
            {tabs.map(t => (
              <button
                key={t.value}
                onClick={() => setTab(t.value)}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium transition-colors ${
                  tab === t.value ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
                }`}
              >
                {t.label}
                {t.locked && (
                  <svg className="w-3 h-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                )}
              </button>
            ))}
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 p-4">
            {tab === 'shares' && <SharesSection />}
            {tab === 'savings' && <SavingsSection hasCompletedShare={hasCompletedShare} />}
            {tab === 'loans' && <LoansSection hasCompletedShare={hasCompletedShare} />}
          </div>
        </div>

      </div>
    </div>
  )
}
