import { useState } from 'react'
import { Header } from '../../components/layout/Header'
import { Card } from '../../components/ui/Card'
import { useBranches, useAllBranchIncome, useAllBranchExpenses } from '../../hooks/useBranches'
import { useCurrency } from '../../hooks/useCurrency'
import { formatDate } from '../../lib/utils'
import type { ExpenseCategory } from '../../types'

const categoryBadgeColors: Record<ExpenseCategory, string> = {
  salary: 'bg-purple-100 text-purple-700',
  utilities: 'bg-blue-100 text-blue-700',
  rent: 'bg-orange-100 text-orange-700',
  supplies: 'bg-yellow-100 text-yellow-700',
  maintenance: 'bg-red-100 text-red-700',
  other: 'bg-gray-100 text-gray-600',
}

function KPICard({
  label,
  value,
  sub,
  valueClass = 'text-gray-900',
}: {
  label: string
  value: string
  sub?: string
  valueClass?: string
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className={`text-xl font-bold ${valueClass}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  )
}

export function BranchKPIPage() {
  const { format: currency } = useCurrency()
  const { data: branches = [], isLoading: branchesLoading } = useBranches()
  const { data: allIncome = [], isLoading: incomeLoading } = useAllBranchIncome()
  const { data: allExpenses = [], isLoading: expensesLoading } = useAllBranchExpenses()

  // Per-branch collapsed state for income/expense lists
  const [expandedBranch, setExpandedBranch] = useState<string | null>(null)
  const [branchTab, setBranchTab] = useState<Record<string, 'income' | 'expenses'>>({})

  const isLoading = branchesLoading || incomeLoading || expensesLoading

  // Overall totals
  const totalRevenue = allIncome.reduce((s, i) => s + i.amount, 0)
  const totalExpenses = allExpenses.reduce((s, e) => s + e.amount, 0)
  const netProfit = totalRevenue - totalExpenses
  const overallMargin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : null

  const getTab = (branchId: string) => branchTab[branchId] ?? 'income'
  const setTab = (branchId: string, tab: 'income' | 'expenses') =>
    setBranchTab(prev => ({ ...prev, [branchId]: tab }))

  return (
    <div>
      <Header
        title="Branch Portfolio"
        subtitle="Cooperative business ventures and their financial performance"
      />

      <div className="p-4 sm:p-6 space-y-6">
        {/* Overall KPI cards */}
        <div>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Overall Performance</h2>
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
            <KPICard
              label="Total Revenue"
              value={currency(totalRevenue)}
              sub="All branches, all time"
            />
            <KPICard
              label="Total Expenses"
              value={currency(totalExpenses)}
              sub="All branches, all time"
              valueClass="text-red-600"
            />
            <KPICard
              label="Net Profit"
              value={currency(netProfit)}
              sub="Revenue minus expenses"
              valueClass={netProfit >= 0 ? 'text-green-700' : 'text-red-600'}
            />
            <KPICard
              label="Overall Profit Margin"
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
            <Card>
              <p className="px-6 py-8 text-sm text-gray-400 text-center">
                No branches have been set up yet.
              </p>
            </Card>
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
                  <Card key={branch.id}>
                    {/* Branch header */}
                    <div className="px-4 py-3 border-b border-gray-100">
                      <div className="flex items-start justify-between gap-3">
                        <div>
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
                        {/* Tabs */}
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

                        {/* Income list */}
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

                        {/* Expenses list */}
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
                  </Card>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
