import { useState } from 'react'
import { Header } from '../../components/layout/Header'
import { Card } from '../../components/ui/Card'
import { useBranches, useAllBranchIncome, useMyBranchIncomeDistributions } from '../../hooks/useBranches'
import { useCurrency } from '../../hooks/useCurrency'
import { formatDate } from '../../lib/utils'

type Period = 'month' | '3months' | 'year' | 'all'

const PERIOD_OPTIONS: { value: Period; label: string }[] = [
  { value: 'month', label: 'This Month' },
  { value: '3months', label: 'Last 3 Months' },
  { value: 'year', label: 'This Year' },
  { value: 'all', label: 'All Time' },
]

function getPeriodDates(period: Period): { start?: string; end?: string } {
  const today = new Date()
  if (period === 'month') return {
    start: new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0],
    end: today.toISOString().split('T')[0],
  }
  if (period === '3months') {
    const d = new Date(today); d.setMonth(d.getMonth() - 3)
    return { start: d.toISOString().split('T')[0], end: today.toISOString().split('T')[0] }
  }
  if (period === 'year') return {
    start: new Date(today.getFullYear(), 0, 1).toISOString().split('T')[0],
    end: today.toISOString().split('T')[0],
  }
  return {}
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
  const [period, setPeriod] = useState<Period>('month')
  const { start, end } = getPeriodDates(period)

  const { data: branches = [], isLoading: branchesLoading } = useBranches()
  const { data: allIncome = [], isLoading: incomeLoading } = useAllBranchIncome(start, end)
  const { data: myDistributions = [], isLoading: distLoading } = useMyBranchIncomeDistributions()

  const isLoading = branchesLoading || incomeLoading

  // Build a map of income_id → my distribution for quick lookup
  const myDistByIncomeId = new Map(myDistributions.map(d => [d.income_id, d]))

  // My earnings within selected period (join to allIncome to filter by period)
  const incomeIdsInPeriod = new Set(allIncome.map(i => i.id))
  const myEarningsInPeriod = myDistributions.filter(d => incomeIdsInPeriod.has(d.income_id))
  const myTotalEarnings = myEarningsInPeriod.reduce((s, d) => s + d.amount, 0)

  // Overall totals — computed from income records
  const totalGross = allIncome.reduce((s, i) => s + (i.gross_sales ?? i.amount), 0)
  const totalSalary = allIncome.reduce((s, i) => s + (i.salary ?? 0), 0)
  const totalExpenses = allIncome.reduce((s, i) => s + (i.expenses_total ?? 0), 0)
  const totalVault = allIncome.reduce((s, i) => s + (i.bills ?? 0), 0)
  const totalNet = allIncome.reduce((s, i) => s + i.amount, 0)

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
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <KPICard label="Gross Sales" value={currency(totalGross)} sub="All branches, all time" />
            <KPICard label="Salary" value={currency(totalSalary)} sub="Total paid out" valueClass="text-orange-600" />
            <KPICard label="Other Expenses" value={currency(totalExpenses)} sub="Operations" valueClass="text-red-600" />
            <KPICard label="Vault" value={currency(totalVault)} sub="Vault & reserves" valueClass="text-purple-600" />
            <KPICard
              label="Net Profit"
              value={currency(totalNet)}
              sub="Gross minus all"
              valueClass={totalNet >= 0 ? 'text-green-700' : 'text-red-600'}
            />
          </div>
        </div>

        {/* My Earnings */}
        <div>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">My Earnings</h2>
          {distLoading ? (
            <p className="text-sm text-gray-400">Loading…</p>
          ) : myDistributions.length === 0 ? (
            <Card>
              <p className="px-6 py-6 text-sm text-gray-400 text-center">No distributions received yet. Earnings from branch income will appear here once distributed by an admin.</p>
            </Card>
          ) : (
            <Card>
              {/* Summary row */}
              <div className="px-4 py-3 grid grid-cols-2 sm:grid-cols-3 gap-3 bg-gray-50 text-xs border-b border-gray-100">
                <div>
                  <p className="text-gray-500">Earned This Period</p>
                  <p className="font-bold text-lg text-green-700">{currency(myTotalEarnings)}</p>
                </div>
                <div>
                  <p className="text-gray-500">Total Earnings (All Time)</p>
                  <p className="font-bold text-lg text-gray-900">{currency(myDistributions.reduce((s, d) => s + d.amount, 0))}</p>
                </div>
                <div>
                  <p className="text-gray-500">Total Distributions</p>
                  <p className="font-bold text-lg text-gray-900">{myDistributions.length}</p>
                </div>
              </div>

              {/* Distribution list for selected period */}
              {myEarningsInPeriod.length === 0 ? (
                <p className="px-4 py-3 text-xs text-gray-400 italic">No earnings in this period. Try selecting a wider range.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-gray-100 bg-gray-50 text-gray-400 uppercase tracking-wide">
                        <th className="px-4 py-2 text-left font-medium">Date</th>
                        <th className="px-4 py-2 text-left font-medium">Branch</th>
                        <th className="px-4 py-2 text-right font-medium">Shares</th>
                        <th className="px-4 py-2 text-right font-medium">Earned</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {myEarningsInPeriod.map(dist => {
                        const inc = allIncome.find(i => i.id === dist.income_id)
                        const branch = inc ? branches.find(b => b.id === inc.branch_id) : null
                        const d = new Date((inc?.period_start ?? dist.created_at) + (inc ? 'T00:00:00' : ''))
                        const dayName = d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase()
                        const dateFmt = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase()
                        return (
                          <tr key={dist.id} className="hover:bg-gray-50 transition-colors">
                            <td className="px-4 py-3 font-semibold text-gray-900">{dayName}, {dateFmt}</td>
                            <td className="px-4 py-3 text-gray-600">{branch?.name ?? '—'}</td>
                            <td className="px-4 py-3 text-right text-gray-500">{dist.share_count}</td>
                            <td className="px-4 py-3 text-right font-semibold text-green-700">{currency(dist.amount)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          )}
        </div>

        {/* Per-branch cards */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
              Branches ({branches.length})
            </h2>
            <div className="flex items-center gap-1.5">
              {PERIOD_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setPeriod(opt.value)}
                  className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors ${
                    period === opt.value ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {isLoading ? (
            <p className="text-sm text-gray-400 text-center py-8">Loading branch data…</p>
          ) : branches.length === 0 ? (
            <Card>
              <p className="px-6 py-8 text-sm text-gray-400 text-center">No branches have been set up yet.</p>
            </Card>
          ) : (
            <div className="space-y-4">
              {branches.map(branch => {
                const income = [...allIncome.filter(i => i.branch_id === branch.id)]
                  .sort((a, b) => b.period_start.localeCompare(a.period_start))

                const branchGross = income.reduce((s, i) => s + (i.gross_sales ?? i.amount), 0)
                const branchSalary = income.reduce((s, i) => s + (i.salary ?? 0), 0)
                const branchExpenses = income.reduce((s, i) => s + (i.expenses_total ?? 0), 0)
                const branchVault = income.reduce((s, i) => s + (i.bills ?? 0), 0)
                const branchNet = income.reduce((s, i) => s + i.amount, 0)

                return (
                  <Card key={branch.id}>
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
                            {branch.location && <p className="text-xs text-gray-500">{branch.location}</p>}
                            {income.length > 0 ? (() => {
                              const first = income[income.length - 1].period_start
                              const last = income[0].period_start
                              return (
                                <p className="text-xs text-gray-400 mt-0.5">
                                  {first === last ? formatDate(first) : `${formatDate(first)} – ${formatDate(last)}`}
                                  {' '}· {income.length} entry{income.length !== 1 ? 's' : ''}
                                </p>
                              )
                            })() : (
                              <p className="text-xs text-gray-400 mt-0.5">No income recorded yet</p>
                            )}
                          </div>
                        </div>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${branch.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                          {branch.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                    </div>

                    {/* Branch KPI row */}
                    <div className="px-4 py-3 grid grid-cols-2 sm:grid-cols-5 gap-3 bg-gray-50 text-xs">
                      <div>
                        <p className="text-gray-500">Gross Sales</p>
                        <p className="font-semibold text-gray-900">{currency(branchGross)}</p>
                      </div>
                      <div>
                        <p className="text-gray-500">Salary</p>
                        <p className="font-semibold text-orange-600">{currency(branchSalary)}</p>
                      </div>
                      <div>
                        <p className="text-gray-500">Other Expenses</p>
                        <p className="font-semibold text-red-600">{currency(branchExpenses)}</p>
                      </div>
                      <div>
                        <p className="text-gray-500">Vault</p>
                        <p className="font-semibold text-purple-600">{currency(branchVault)}</p>
                      </div>
                      <div>
                        <p className="text-gray-500">Net Profit</p>
                        <p className={`font-semibold ${branchNet >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                          {currency(branchNet)}
                        </p>
                      </div>
                    </div>

                    {/* Income table */}
                    {income.length === 0 ? (
                      <p className="px-4 py-3 text-xs text-gray-400 italic">No income recorded yet.</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-gray-100 bg-gray-50 text-gray-400 uppercase tracking-wide">
                              <th className="px-4 py-2 text-left font-medium">Date</th>
                              <th className="px-4 py-2 text-right font-medium">Gross</th>
                              <th className="px-4 py-2 text-right font-medium">Salary</th>
                              <th className="px-4 py-2 text-right font-medium">Expenses</th>
                              <th className="px-4 py-2 text-right font-medium">Vault</th>
                              <th className="px-4 py-2 text-right font-medium">Net Profit</th>
                              <th className="px-4 py-2 text-right font-medium">My Earnings</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-50">
                            {income.map(inc => {
                              const d = new Date(inc.period_start + 'T00:00:00')
                              const dayName = d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase()
                              const dateFmt = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase()
                              const myDist = myDistByIncomeId.get(inc.id)
                              return (
                                <tr key={inc.id} className="hover:bg-gray-50 transition-colors">
                                  <td className="px-4 py-3">
                                    <p className="font-semibold text-gray-900">{dayName}, {dateFmt}</p>
                                    {inc.description && <p className="text-gray-400 mt-0.5">{inc.description}</p>}
                                  </td>
                                  <td className="px-4 py-3 text-right font-semibold text-gray-900">
                                    {currency(inc.gross_sales ?? inc.amount)}
                                  </td>
                                  <td className="px-4 py-3 text-right font-semibold text-orange-500">
                                    {inc.salary ? currency(inc.salary) : <span className="text-gray-300">—</span>}
                                  </td>
                                  <td className="px-4 py-3 text-right font-semibold text-red-500">
                                    {inc.expenses_total ? currency(inc.expenses_total) : <span className="text-gray-300">—</span>}
                                  </td>
                                  <td className="px-4 py-3 text-right font-semibold text-purple-500">
                                    {inc.bills ? currency(inc.bills) : <span className="text-gray-300">—</span>}
                                  </td>
                                  <td className="px-4 py-3 text-right">
                                    <p className={`font-semibold ${inc.amount >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                      {currency(inc.amount)}
                                    </p>
                                    {inc.roi != null && (
                                      <p className="text-gray-400 mt-0.5">{inc.roi.toFixed(1)}% ROI</p>
                                    )}
                                  </td>
                                  <td className="px-4 py-3 text-right">
                                    {myDist ? (
                                      <p className="font-semibold text-green-700">{currency(myDist.amount)}</p>
                                    ) : inc.distributed ? (
                                      <span className="text-gray-300">—</span>
                                    ) : (
                                      <span className="text-xs text-amber-500">Pending</span>
                                    )}
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
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
