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

function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <div className="w-full bg-gray-100 rounded-full h-2.5 overflow-hidden">
      <div
        className="h-2.5 rounded-full transition-all duration-500"
        style={{ width: `${pct}%`, backgroundColor: pct >= 100 ? '#16a34a' : '#2563eb' }}
      />
    </div>
  )
}

function SectionLock({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center">
      <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mb-3">
        <svg className="w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
        </svg>
      </div>
      <p className="text-sm text-gray-500 max-w-xs">{message}</p>
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
    return (
      <div className="py-8 text-center">
        <p className="text-sm text-gray-500">No share subscription found. Contact admin.</p>
      </div>
    )
  }

  const activeShare = shares.find(s => s.status === 'in_progress') ?? shares[shares.length - 1]
  const completedCount = shares.filter(s => s.status === 'completed').length
  const totalPaid = shares.reduce((sum, s) => sum + (s.paid_amount ?? 0), 0)
  const recentContributions = contributions.slice(0, 5)
  const pct = activeShare.target_amount > 0
    ? Math.min(100, Math.round((activeShare.paid_amount / activeShare.target_amount) * 100))
    : 0

  return (
    <div className="space-y-4">
      <div className="bg-blue-50 rounded-xl p-4">
        <div className="flex items-center justify-between mb-1">
          <span className="text-sm font-medium text-blue-800">
            Share #{activeShare.share_number}
            {activeShare.status === 'completed' && (
              <span className="ml-2 text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Completed</span>
            )}
          </span>
          <span className="text-sm font-semibold text-blue-900">{pct}%</span>
        </div>
        <ProgressBar value={activeShare.paid_amount} max={activeShare.target_amount} />
        <div className="flex justify-between mt-1.5 text-xs text-blue-700">
          <span>{currency(activeShare.paid_amount)} paid</span>
          <span>{currency(activeShare.target_amount)} target</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="bg-gray-50 rounded-xl p-3 text-center">
          <p className="text-xl font-bold text-gray-900">{completedCount}</p>
          <p className="text-xs text-gray-500 mt-0.5">Shares completed</p>
        </div>
        <div className="bg-gray-50 rounded-xl p-3 text-center">
          <p className="text-xl font-bold text-gray-900">{currency(totalPaid)}</p>
          <p className="text-xs text-gray-500 mt-0.5">Total contributed</p>
        </div>
      </div>

      {recentContributions.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Recent deposits</p>
          <div className="divide-y divide-gray-100">
            {recentContributions.map(c => (
              <div key={c.id} className="flex justify-between items-center py-2.5">
                <div>
                  <p className="text-sm text-gray-700">{fmt(c.contribution_at ?? c.created_at)}</p>
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
    return <SectionLock message="Complete your first share to unlock your savings account." />
  }

  if (isLoading) return <div className="py-8 text-center text-sm text-gray-400">Loading…</div>

  if (!account) {
    return (
      <div className="py-8 text-center">
        <p className="text-sm text-gray-500">No savings account yet. Contact admin.</p>
      </div>
    )
  }

  const recent = contributions.slice(0, 5)

  return (
    <div className="space-y-4">
      <div className="bg-green-50 rounded-xl p-4 text-center">
        <p className="text-xs text-green-700 font-medium mb-1">Current Balance</p>
        <p className="text-3xl font-bold text-green-800">{currency(account.balance)}</p>
        <p className="text-xs text-green-600 mt-1 capitalize">{account.status}</p>
      </div>

      {recent.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Recent transactions</p>
          <div className="divide-y divide-gray-100">
            {recent.map(c => (
              <div key={c.id} className="flex justify-between items-center py-2.5">
                <div>
                  <p className="text-sm text-gray-700">{fmt(c.contributed_at ?? c.created_at)}</p>
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

  return (
    <div className="space-y-3">
      {activeLoans.length === 0 && (
        <div className="py-6 text-center">
          <p className="text-sm text-gray-500 mb-3">No active loans.</p>
          <button
            onClick={() => navigate('/loans/apply')}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            Apply for a Loan
          </button>
        </div>
      )}

      {activeLoans.map(loan => {
        const progress = loan.total_repayable > 0
          ? Math.min(100, Math.round(((loan.amount_paid ?? 0) / loan.total_repayable) * 100))
          : 0
        return (
          <div
            key={loan.id}
            className="border border-gray-100 rounded-xl p-4 cursor-pointer hover:border-blue-200 hover:bg-blue-50/30 transition-colors"
            onClick={() => navigate(`/loans/${loan.id}`)}
          >
            <div className="flex justify-between items-start mb-2">
              <div>
                <p className="text-sm font-semibold text-gray-900">{currency(loan.principal)}</p>
                <p className="text-xs text-gray-500">{loan.term_months} months · {loan.interest_rate}%</p>
              </div>
              <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full capitalize">{loan.status}</span>
            </div>
            <ProgressBar value={loan.amount_paid ?? 0} max={loan.total_repayable} />
            <div className="flex justify-between mt-1.5 text-xs text-gray-500">
              <span>{currency(loan.outstanding)} remaining</span>
              <span>{progress}% paid</span>
            </div>
            {loan.due_date && (
              <p className="text-xs text-orange-600 mt-2">Due: {fmt(loan.due_date)}</p>
            )}
          </div>
        )
      })}

      {activeLoans.length > 0 && (
        <button
          onClick={() => navigate('/loans/apply')}
          className="w-full py-2 text-sm text-blue-600 hover:text-blue-700 font-medium"
        >
          + Apply for another loan
        </button>
      )}
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

  const tabs: { value: Tab; label: string; locked: boolean }[] = [
    { value: 'shares', label: 'Shares', locked: false },
    { value: 'savings', label: 'Savings', locked: !hasCompletedShare },
    { value: 'loans', label: 'Loans', locked: !hasCompletedShare },
  ]

  return (
    <div>
      <Header
        title={`Hi, ${profile?.full_name?.split(' ')[0] ?? 'there'}`}
        subtitle="Your cooperative accounts"
      />

      <div className="p-4 sm:p-6">
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1 mb-5">
          {tabs.map(t => (
            <button
              key={t.value}
              onClick={() => setTab(t.value)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium transition-colors ${
                tab === t.value ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {t.label}
              {t.locked && (
                <svg className="w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              )}
            </button>
          ))}
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 p-4 sm:p-5">
          {tab === 'shares' && <SharesSection />}
          {tab === 'savings' && <SavingsSection hasCompletedShare={hasCompletedShare} />}
          {tab === 'loans' && <LoansSection hasCompletedShare={hasCompletedShare} />}
        </div>
      </div>
    </div>
  )
}
