import { useState } from 'react'
import { Header } from '../../components/layout/Header'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import {
  useBranches,
  useSyncBranches,
  useUpdateBranch,
  useBranchIncome,
  useRecordBranchIncome,
  useUpdateBranchIncome,
  useDistributeBranchIncomeForPeriod,
  useBranchIncomeSummary,
  useShareholders,
} from '../../hooks/useBranches'
import { useCurrency } from '../../hooks/useCurrency'
import { formatDate } from '../../lib/utils'
import { PageGuide } from '../../components/shared/PageGuide'
import type { Branch, BranchIncome } from '../../types'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'

// ─── Constants ────────────────────────────────────────────────────────────────

type Period = 'month' | '3months' | 'year' | 'all'

const PERIOD_OPTIONS: { value: Period; label: string }[] = [
  { value: 'month', label: 'This Month' },
  { value: '3months', label: 'Last 3 Months' },
  { value: 'year', label: 'This Year' },
  { value: 'all', label: 'All Time' },
]

function getPeriodDates(period: Period): { start?: string; end?: string } {
  const today = new Date()
  if (period === 'month') {
    return {
      start: new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0],
      end: today.toISOString().split('T')[0],
    }
  }
  if (period === '3months') {
    const d = new Date(today)
    d.setMonth(d.getMonth() - 3)
    return { start: d.toISOString().split('T')[0], end: today.toISOString().split('T')[0] }
  }
  if (period === 'year') {
    return {
      start: new Date(today.getFullYear(), 0, 1).toISOString().split('T')[0],
      end: today.toISOString().split('T')[0],
    }
  }
  return {} // all time — no filter
}

// ─── IncomeForm helper ────────────────────────────────────────────────────────

const emptyIncomeForm = () => ({
  gross_sales: '', salary: '', expenses_total: '', bills: '', income_date: '', description: '',
})

function incomeCalc(form: ReturnType<typeof emptyIncomeForm>) {
  const gs = parseFloat(form.gross_sales) || 0
  const net = gs - (parseFloat(form.salary) || 0) - (parseFloat(form.expenses_total) || 0) - (parseFloat(form.bills) || 0)
  const roi = gs > 0 ? (net / gs) * 100 : null
  return { gs, net, roi }
}

function IncomeFormFields({
  form,
  onChange,
}: {
  form: ReturnType<typeof emptyIncomeForm>
  onChange: (f: ReturnType<typeof emptyIncomeForm>) => void
}) {
  const { net, roi } = incomeCalc(form)
  const today = new Date().toISOString().split('T')[0]
  const inp = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'
  return (
    <div className="space-y-3">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Date <span className="text-red-500">*</span></label>
        <input type="date" value={form.income_date} max={today} onChange={e => onChange({ ...form, income_date: e.target.value })} className={inp} />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Gross Sales <span className="text-red-500">*</span></label>
        <input type="number" min="0" step="0.01" value={form.gross_sales} onChange={e => onChange({ ...form, gross_sales: e.target.value })} placeholder="0.00" className={inp} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Salary</label>
          <input type="number" min="0" step="0.01" value={form.salary} onChange={e => onChange({ ...form, salary: e.target.value })} placeholder="0.00" className={inp} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Other Expenses</label>
          <input type="number" min="0" step="0.01" value={form.expenses_total} onChange={e => onChange({ ...form, expenses_total: e.target.value })} placeholder="0.00" className={inp} />
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Vault</label>
        <input type="number" min="0" step="0.01" value={form.bills} onChange={e => onChange({ ...form, bills: e.target.value })} placeholder="0.00" className={inp} />
      </div>
      {form.gross_sales && (
        <div className="bg-gray-50 rounded-lg px-4 py-3 text-sm space-y-1">
          <div className="flex justify-between">
            <span className="text-gray-500">Net Profit (distributable)</span>
            <span className="font-semibold text-gray-900">₱{net.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">ROI</span>
            <span className={`font-semibold ${roi === null ? 'text-gray-400' : roi >= 0 ? 'text-green-700' : 'text-red-600'}`}>
              {roi === null ? '—' : `${roi.toFixed(2)}%`}
            </span>
          </div>
        </div>
      )}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Notes (optional)</label>
        <input type="text" value={form.description} onChange={e => onChange({ ...form, description: e.target.value })} placeholder="e.g. holiday sales" className={inp} />
      </div>
    </div>
  )
}

// ─── BranchCard ───────────────────────────────────────────────────────────────

function BranchCard({
  branch,
  onEdit,
}: {
  branch: Branch
  onEdit: (b: Branch) => void
}) {
  const { format: currency } = useCurrency()

  const [expanded, setExpanded] = useState(false)
  const [period, setPeriod] = useState<Period>('month')

  // Modals
  const [showRecordIncome, setShowRecordIncome] = useState(false)
  const [editIncomeTarget, setEditIncomeTarget] = useState<BranchIncome | null>(null)
  const [editIncomeConfirm, setEditIncomeConfirm] = useState(false)
  const [showDistributePeriod, setShowDistributePeriod] = useState(false)
  const [showRecipients, setShowRecipients] = useState(false)

  // Forms
  const [incomeForm, setIncomeForm] = useState(emptyIncomeForm())
  const [editIncomeForm, setEditIncomeForm] = useState(emptyIncomeForm())

  const today = new Date().toISOString().slice(0, 10)
  const { start, end } = getPeriodDates(period)
  const { data: income = [], isLoading: loadingIncome } = useBranchIncome(branch.id, start, end, expanded)
  const { data: todayIncome = [] } = useBranchIncome(branch.id, today, today, !expanded)

  const recordIncome = useRecordBranchIncome()
  const updateIncome = useUpdateBranchIncome()
  const distributePeriod = useDistributeBranchIncomeForPeriod()
  const { data: shareholders = [] } = useShareholders()

  // KPI totals
  const totalGrossSales = income.reduce((s, i) => s + (i.gross_sales ?? i.amount), 0)
  const totalSalary = income.reduce((s, i) => s + (i.salary ?? 0), 0)
  const totalExpenses = income.reduce((s, i) => s + (i.expenses_total ?? 0), 0)
  const totalNetProfit = income.reduce((s, i) => s + i.amount, 0)


  // Chart: up to 30 most recent days in period, ascending
  const chartData = [...income]
    .sort((a, b) => a.period_start.localeCompare(b.period_start))
    .slice(-30)
    .map(inc => ({
      date: new Date(inc.period_start + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      'Gross': inc.gross_sales ?? inc.amount,
      'Net': inc.amount,
    }))

  const handleRecordIncome = () => {
    if (!incomeForm.gross_sales || !incomeForm.income_date) return
    const { gs, net, roi } = incomeCalc(incomeForm)
    recordIncome.mutate(
      {
        branchId: branch.id,
        amount: net,
        periodStart: incomeForm.income_date,
        periodEnd: incomeForm.income_date,
        grossSales: gs,
        salary: parseFloat(incomeForm.salary) || 0,
        expensesTotal: parseFloat(incomeForm.expenses_total) || 0,
        bills: parseFloat(incomeForm.bills) || 0,
        roi,
        description: incomeForm.description.trim() || undefined,
      },
      {
        onSuccess: () => { setShowRecordIncome(false); setIncomeForm(emptyIncomeForm()) },
        onError: (err: any) => alert(err.message ?? 'Failed to record income'),
      }
    )
  }

  const openEditIncome = (inc: BranchIncome) => {
    setEditIncomeForm({
      gross_sales: String(inc.gross_sales ?? inc.amount),
      salary: String(inc.salary ?? ''),
      expenses_total: String(inc.expenses_total ?? ''),
      bills: String(inc.bills ?? ''),
      income_date: inc.period_start,
      description: inc.description ?? '',
    })
    setEditIncomeTarget(inc)
    setEditIncomeConfirm(false)
  }

  const handleUpdateIncome = () => {
    if (!editIncomeTarget) return
    const { gs, roi } = incomeCalc(editIncomeForm)
    updateIncome.mutate(
      {
        id: editIncomeTarget.id,
        grossSales: gs,
        salary: parseFloat(editIncomeForm.salary) || 0,
        expensesTotal: parseFloat(editIncomeForm.expenses_total) || 0,
        bills: parseFloat(editIncomeForm.bills) || 0,
        roi,
        incomeDate: editIncomeForm.income_date,
        description: editIncomeForm.description.trim() || undefined,
      },
      {
        onSuccess: () => { setEditIncomeTarget(null); setEditIncomeConfirm(false) },
        onError: (err: any) => alert(err.message ?? 'Failed to update income'),
      }
    )
  }

  return (
    <>
      <Card>
        {/* Header — click to expand/collapse */}
        <div
          className="px-4 py-3 flex items-center justify-between gap-4 cursor-pointer select-none"
          onClick={() => setExpanded(e => !e)}
        >
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-gray-900">{branch.name}</h3>
              <span className={`text-xs px-1.5 py-0.5 rounded ${branch.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                {branch.is_active ? 'Active' : 'Inactive'}
              </span>
            </div>
            {branch.location && <p className="text-xs text-gray-500 mt-0.5">{branch.location}</p>}
            {!expanded && (
              <p className="text-xs text-gray-400 mt-0.5">
                {new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
              </p>
            )}
            {expanded && income.length > 0 && (() => {
              const sorted = [...income].sort((a, b) => a.period_start.localeCompare(b.period_start))
              const first = sorted[0].period_start
              const last = sorted[sorted.length - 1].period_start
              return (
                <p className="text-xs text-gray-400 mt-0.5">
                  {first === last ? formatDate(first) : `${formatDate(first)} – ${formatDate(last)}`}
                  {' '}· {income.length} entry{income.length !== 1 ? 's' : ''}
                </p>
              )
            })()}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              size="sm"
              className="bg-green-600 hover:bg-green-700 text-white"
              onClick={e => {
                e.stopPropagation()
                setIncomeForm({ ...emptyIncomeForm(), income_date: new Date().toISOString().split('T')[0] })
                setShowRecordIncome(true)
              }}
            >
              + Record Income
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={e => { e.stopPropagation(); onEdit(branch) }}
            >
              Edit
            </Button>
          </div>
        </div>

        {/* KPI row — always visible, scoped to selected period when expanded */}
        {!expanded ? (
          <div
            className="px-4 py-3 bg-gray-50 text-xs border-t border-gray-100 cursor-pointer hover:bg-gray-100 transition-colors"
            onClick={() => setExpanded(e => !e)}
          >
            {todayIncome.length === 0 ? (
              <span className="text-gray-400 italic">No recorded sales today yet — click to expand</span>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <p className="text-gray-400">Today's Sales</p>
                  <p className="font-semibold text-gray-900">{currency(todayIncome.reduce((s, i) => s + (i.gross_sales ?? 0), 0))}</p>
                </div>
                <div>
                  <p className="text-gray-400">Salary</p>
                  <p className="font-semibold text-orange-600">{currency(todayIncome.reduce((s, i) => s + (i.salary ?? 0), 0))}</p>
                </div>
                <div>
                  <p className="text-gray-400">Expenses</p>
                  <p className="font-semibold text-red-600">{currency(todayIncome.reduce((s, i) => s + (i.expenses_total ?? 0), 0))}</p>
                </div>
                <div>
                  <p className="text-gray-400">Net Profit</p>
                  <p className="font-semibold text-green-700">{currency(todayIncome.reduce((s, i) => s + i.amount, 0))}</p>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="px-4 py-3 grid grid-cols-2 sm:grid-cols-4 gap-3 bg-gray-50 text-xs border-t border-gray-100">
            <div>
              <p className="text-gray-500">Gross Sales</p>
              <p className="font-semibold text-gray-900">{currency(totalGrossSales)}</p>
            </div>
            <div>
              <p className="text-gray-500">Salary</p>
              <p className="font-semibold text-orange-600">{currency(totalSalary)}</p>
            </div>
            <div>
              <p className="text-gray-500">Other Expenses</p>
              <p className="font-semibold text-red-600">{currency(totalExpenses)}</p>
            </div>
            <div>
              <p className="text-gray-500">Net Profit</p>
              <p className={`font-semibold ${totalNetProfit >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                {currency(totalNetProfit)}
              </p>
            </div>
          </div>
        )}

        {/* Expanded content */}
        {expanded && (
          <>
            {/* Period selector */}
            <div className="px-4 py-2 border-t border-gray-100 flex items-center gap-2">
              <span className="text-xs text-gray-400">Period:</span>
              {PERIOD_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setPeriod(opt.value)}
                  className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors ${
                    period === opt.value
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {/* Chart */}
            {loadingIncome ? (
              <div className="px-4 py-6 text-xs text-gray-400 text-center border-t border-gray-100">Loading…</div>
            ) : chartData.length > 0 ? (
              <div className="px-4 pt-4 pb-2 border-t border-gray-100">
                <p className="text-xs font-medium text-gray-500 mb-2">
                  Gross vs Net — {PERIOD_OPTIONS.find(o => o.value === period)?.label} ({chartData.length} entries)
                </p>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={chartData} barCategoryGap="30%">
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                    <YAxis
                      tick={{ fontSize: 10 }}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(v: number) => `₱${(v / 1000).toFixed(0)}k`}
                      width={42}
                    />
                    <Tooltip
                      formatter={(value: number) => [`₱${value.toLocaleString()}`, undefined]}
                      contentStyle={{ fontSize: 11, borderRadius: 6, border: '1px solid #e5e7eb' }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="Gross" fill="#93c5fd" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="Net" fill="#34d399" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="px-4 py-4 border-t border-gray-100 text-xs text-gray-400 italic">
                No income data for this period.
              </div>
            )}

            {/* Income header bar */}
            {(() => {
              const undistributed = income.filter(i => !i.distributed)
              const undistributedTotal = undistributed.reduce((s, i) => s + i.amount, 0)
              return (
                <div className="flex items-center border-t border-gray-100 bg-white px-4 py-2">
                  <span className="text-xs font-medium text-gray-500">
                    Income ({income.length})
                  </span>
                  <div className="ml-auto flex items-center gap-2">
                    {undistributed.length > 0 ? (
                      <button
                        className="text-xs font-medium bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap"
                        onClick={() => setShowDistributePeriod(true)}
                      >
                        Distribute ({undistributed.length}) · {currency(undistributedTotal * 0.5)}
                      </button>
                    ) : income.length > 0 ? (
                      <span className="text-xs text-green-600 font-medium">✓ All distributed</span>
                    ) : null}
                  </div>
                </div>
              )
            })()}

            {/* Income table */}
            {income.length === 0 ? (
              <p className="px-4 py-3 text-xs text-gray-400 italic">No income recorded for this period.</p>
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
                      <th className="px-4 py-2 text-right font-medium"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {[...income].sort((a, b) => b.period_start.localeCompare(a.period_start)).map(inc => {
                      const d = new Date(inc.period_start + 'T00:00:00')
                      const dayName = d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase()
                      const dateFmt = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase()
                      return (
                        <tr key={inc.id} className="hover:bg-blue-50 transition-colors cursor-pointer" onClick={() => openEditIncome(inc)}>
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
                          <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                            {inc.distributed && (
                              <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
                                Distributed
                              </span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </Card>

      {/* Record income modal */}
      <Modal isOpen={showRecordIncome} onClose={() => setShowRecordIncome(false)} title={`Record Income — ${branch.name}`} size="sm">
        <div className="space-y-3">
          <IncomeFormFields form={incomeForm} onChange={setIncomeForm} />
          <div className="flex gap-3 pt-1">
            <Button variant="outline" className="flex-1" onClick={() => setShowRecordIncome(false)}>Cancel</Button>
            <Button className="flex-1" loading={recordIncome.isPending} disabled={!incomeForm.gross_sales || !incomeForm.income_date} onClick={handleRecordIncome}>
              Record
            </Button>
          </div>
        </div>
      </Modal>

      {/* Edit income modal */}
      <Modal
        isOpen={!!editIncomeTarget}
        onClose={() => { setEditIncomeTarget(null); setEditIncomeConfirm(false) }}
        title="Edit Income Record"
        size="sm"
      >
        {editIncomeTarget && !editIncomeConfirm && (
          <div className="space-y-3">
            <IncomeFormFields form={editIncomeForm} onChange={setEditIncomeForm} />
            <div className="flex gap-3 pt-1">
              <Button variant="outline" className="flex-1" onClick={() => setEditIncomeTarget(null)}>Cancel</Button>
              <Button className="flex-1" disabled={!editIncomeForm.gross_sales || !editIncomeForm.income_date} onClick={() => setEditIncomeConfirm(true)}>
                Review Changes
              </Button>
            </div>
          </div>
        )}
        {editIncomeTarget && editIncomeConfirm && (() => {
          const { gs, net } = incomeCalc(editIncomeForm)
          return (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">Confirm the following changes:</p>
              <div className="bg-gray-50 rounded-lg divide-y divide-gray-100 text-sm">
                {[
                  ['Date', editIncomeForm.income_date],
                  ['Gross Sales', currency(gs)],
                  ['Salary', currency(parseFloat(editIncomeForm.salary) || 0)],
                  ['Expenses', currency(parseFloat(editIncomeForm.expenses_total) || 0)],
                  ['Vault', currency(parseFloat(editIncomeForm.bills) || 0)],
                  ['Net Profit', currency(net)],
                ].map(([label, val]) => (
                  <div key={label} className="flex justify-between px-3 py-2">
                    <span className="text-gray-500">{label}</span>
                    <span className="font-medium text-gray-900">{val}</span>
                  </div>
                ))}
              </div>
              {editIncomeTarget.distributed && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-700">
                  This income has already been distributed. Editing will not adjust past distributions.
                </div>
              )}
              <div className="flex gap-3">
                <Button variant="outline" className="flex-1" onClick={() => setEditIncomeConfirm(false)}>Back</Button>
                <Button className="flex-1" loading={updateIncome.isPending} onClick={handleUpdateIncome}>Confirm Update</Button>
              </div>
            </div>
          )
        })()}
      </Modal>

      {/* Distribute period modal */}
      {(() => {
        const undistributed = income.filter(i => !i.distributed)
        const totalNet = undistributed.reduce((s, i) => s + i.amount, 0)
        const forShareholders = totalNet * 0.5
        const periodLabel = PERIOD_OPTIONS.find(o => o.value === period)?.label ?? period
        const totalShares = shareholders.reduce((s, m) => s + m.completed_shares, 0)
        const perShare = totalShares > 0 ? forShareholders / totalShares : 0
        return (
          <Modal isOpen={showDistributePeriod} onClose={() => { setShowDistributePeriod(false); setShowRecipients(false) }} title="Distribute Period Income" size="sm">
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                Distribute <strong>{undistributed.length} undistributed record{undistributed.length !== 1 ? 's' : ''}</strong> for <strong>{periodLabel}</strong>.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-center">
                  <p className="text-xs text-green-600 font-medium mb-1">Shareholders (50%)</p>
                  <p className="text-lg font-bold text-green-700">{currency(forShareholders)}</p>
                  <p className="text-xs text-green-500 mt-1">{totalShares} total shares · {currency(perShare)}/share</p>
                </div>
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-center">
                  <p className="text-xs text-gray-500 font-medium mb-1">Branch Owner (50%)</p>
                  <p className="text-lg font-bold text-gray-700">{currency(totalNet * 0.5)}</p>
                  <p className="text-xs text-gray-400 mt-1">Retained by owner</p>
                </div>
              </div>

              {/* Per-member breakdown */}
              {shareholders.length > 0 && (
                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  <button
                    className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                    onClick={() => setShowRecipients(v => !v)}
                  >
                    <span>Recipients ({shareholders.length})</span>
                    <span className="text-gray-400">{showRecipients ? '▲' : '▼'}</span>
                  </button>
                  {showRecipients && (
                    <div className="divide-y divide-gray-100 max-h-48 overflow-y-auto border-t border-gray-200">
                      {shareholders.map(m => (
                        <div key={m.user_id} className="flex items-center justify-between px-3 py-2 text-xs">
                          <div>
                            <p className="font-medium text-gray-900">{m.full_name}</p>
                            <p className="text-gray-400">{m.completed_shares} share{m.completed_shares !== 1 ? 's' : ''}</p>
                          </div>
                          <p className="font-semibold text-green-700">{currency(perShare * m.completed_shares)}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <p className="text-xs text-gray-400">Credited to each member's savings account. Cannot be undone.</p>
              <div className="flex gap-3">
                <Button variant="outline" className="flex-1" onClick={() => setShowDistributePeriod(false)}>Cancel</Button>
                <Button
                  className="flex-1 bg-green-600 hover:bg-green-700"
                  loading={distributePeriod.isPending}
                  onClick={() => distributePeriod.mutate(
                    { branchId: branch.id, start: start ?? '2000-01-01', end: end ?? new Date().toISOString().split('T')[0] },
                    {
                      onSuccess: () => setShowDistributePeriod(false),
                      onError: (err: any) => alert(err.message ?? 'Failed to distribute'),
                    }
                  )}
                >
                  Distribute All
                </Button>
              </div>
            </div>
          </Modal>
        )
      })()}
    </>
  )
}

// ─── BranchesPage ─────────────────────────────────────────────────────────────

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export function BranchesPage() {
  const { format: currency } = useCurrency()
  const { data: branches = [], isLoading } = useBranches()
  const { data: summary } = useBranchIncomeSummary()
  const syncBranches = useSyncBranches()
  const updateBranch = useUpdateBranch()

  const [editTarget, setEditTarget] = useState<Branch | null>(null)
  const [editForm, setEditForm] = useState({ name: '', location: '', is_active: true, report_cutoff_day: 0 })

  const inp = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'

  const handleEdit = () => {
    if (!editTarget || !editForm.name.trim()) return
    updateBranch.mutate(
      { id: editTarget.id, name: editForm.name.trim(), location: editForm.location.trim() || null, is_active: editForm.is_active, report_cutoff_day: editForm.report_cutoff_day },
      {
        onSuccess: () => setEditTarget(null),
        onError: (err: any) => alert(err.message ?? 'Failed to update branch'),
      }
    )
  }

  return (
    <div>
      <Header title="Branches" subtitle="Cooperative-owned business ventures — income is shared among all shareholders" />

      <div className="p-4 sm:p-6 space-y-4">
        <PageGuide
          storageKey="branches"
          steps={[
            'Branches are businesses owned and operated by the cooperative (e.g., a sari-sari store, a farm, a transport service).',
            'Create a branch, then record its gross income and expenses each day.',
            'Net Profit = Gross Sales minus Salary, Expenses, and Vault. ROI is auto-computed.',
            "Click 'Distribute' on an income record to split 50% of net profit among all shareholders.",
            'Example: ₱10,000 net × 50% = ₱5,000 for shareholders. 100 total shares = ₱50 per share. A member with 3 shares receives ₱150.',
            'The other 50% is retained by the branch owner.',
          ]}
          note="Only fully completed shares are counted. Use the period selector (This Month / Last 3 Months / This Year / All Time) to control how much data is loaded at once."
        />

        {/* KPI banner */}
        {summary && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-white border border-gray-200 rounded-xl px-4 py-3">
              <p className="text-xs text-gray-400 mb-1">Total Net Profit</p>
              <p className="text-lg font-bold text-gray-900">{currency(summary.totalNetProfit)}</p>
              <p className="text-xs text-gray-400 mt-0.5">{summary.recordCount} record{summary.recordCount !== 1 ? 's' : ''} all time</p>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl px-4 py-3">
              <p className="text-xs text-gray-400 mb-1">Distributable to Shareholders</p>
              <p className="text-lg font-bold text-green-600">{currency(summary.distributableAmount)}</p>
              <p className="text-xs text-gray-400 mt-0.5">50% of {currency(summary.pendingNetProfit)} pending</p>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl px-4 py-3">
              <p className="text-xs text-gray-400 mb-1">Already Distributed</p>
              <p className="text-lg font-bold text-blue-600">{currency(summary.distributedNetProfit * 0.5)}</p>
              <p className="text-xs text-gray-400 mt-0.5">50% of {currency(summary.distributedNetProfit)} paid out</p>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl px-4 py-3">
              <p className="text-xs text-gray-400 mb-1">Pending Distribution</p>
              <p className={`text-lg font-bold ${summary.pendingCount > 0 ? 'text-amber-600' : 'text-gray-400'}`}>
                {summary.pendingCount}
              </p>
              <p className="text-xs text-gray-400 mt-0.5">record{summary.pendingCount !== 1 ? 's' : ''} not yet distributed</p>
            </div>
          </div>
        )}

        <div className="flex justify-end">
          <Button
            variant="outline"
            loading={syncBranches.isPending}
            onClick={() => syncBranches.mutate(undefined, {
              onError: (err: any) => alert(err.message ?? 'Sync failed'),
            })}
          >
            ↻ Sync Branches
          </Button>
        </div>

        {isLoading ? (
          <p className="text-sm text-gray-400 text-center py-8">Loading…</p>
        ) : branches.length === 0 ? (
          <Card>
            <p className="px-6 py-8 text-sm text-gray-400 text-center">No branches yet. Add one to start recording income.</p>
          </Card>
        ) : (
          <div className="space-y-4">
            {branches.map(branch => (
              <BranchCard
                key={branch.id}
                branch={branch}
                onEdit={b => {
                  setEditTarget(b)
                  setEditForm({ name: b.name, location: b.location ?? '', is_active: b.is_active, report_cutoff_day: b.report_cutoff_day ?? 0 })
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Edit branch modal */}
      <Modal isOpen={!!editTarget} onClose={() => setEditTarget(null)} title="Edit Branch" size="sm">
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Branch Name <span className="text-red-500">*</span></label>
            <input type="text" value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} className={inp} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Location</label>
            <input type="text" value={editForm.location} onChange={e => setEditForm(f => ({ ...f, location: e.target.value }))} className={inp} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Weekly Report Cutoff Day</label>
            <select value={editForm.report_cutoff_day} onChange={e => setEditForm(f => ({ ...f, report_cutoff_day: parseInt(e.target.value) }))} className={`${inp} bg-white`}>
              {DAY_NAMES.map((day, i) => <option key={i} value={i}>{day}</option>)}
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
            <input type="checkbox" checked={editForm.is_active} onChange={e => setEditForm(f => ({ ...f, is_active: e.target.checked }))} className="accent-blue-600" />
            Active (visible for income recording)
          </label>
          <div className="flex gap-3 pt-1">
            <Button variant="outline" className="flex-1" onClick={() => setEditTarget(null)}>Cancel</Button>
            <Button className="flex-1" loading={updateBranch.isPending} disabled={!editForm.name.trim()} onClick={handleEdit}>Save</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
