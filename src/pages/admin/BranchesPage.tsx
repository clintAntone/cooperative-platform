import { useState } from 'react'
import { Header } from '../../components/layout/Header'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import {
  useBranches,
  useCreateBranch,
  useUpdateBranch,
  useAllBranchIncome,
  useRecordBranchIncome,
  useDistributeBranchIncome,
  useAllBranchExpenses,
  useRecordBranchExpense,
} from '../../hooks/useBranches'
import { useCurrency } from '../../hooks/useCurrency'
import { formatDate } from '../../lib/utils'
import { PageGuide } from '../../components/shared/PageGuide'
import type { Branch, BranchIncome, ExpenseCategory } from '../../types'

const EXPENSE_CATEGORIES: { value: ExpenseCategory; label: string }[] = [
  { value: 'salary', label: 'Salary' },
  { value: 'utilities', label: 'Utilities' },
  { value: 'rent', label: 'Rent' },
  { value: 'supplies', label: 'Supplies' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'other', label: 'Other' },
]

const categoryBadgeColors: Record<ExpenseCategory, string> = {
  salary: 'bg-purple-100 text-purple-700',
  utilities: 'bg-blue-100 text-blue-700',
  rent: 'bg-orange-100 text-orange-700',
  supplies: 'bg-yellow-100 text-yellow-700',
  maintenance: 'bg-red-100 text-red-700',
  other: 'bg-gray-100 text-gray-600',
}

export function BranchesPage() {
  const { format: currency } = useCurrency()
  const { data: branches = [], isLoading } = useBranches()
  const { data: allIncome = [] } = useAllBranchIncome()
  const { data: allExpenses = [] } = useAllBranchExpenses()
  const createBranch = useCreateBranch()
  const updateBranch = useUpdateBranch()
  const recordIncome = useRecordBranchIncome()
  const distribute = useDistributeBranchIncome()
  const recordExpense = useRecordBranchExpense()

  const [showCreate, setShowCreate] = useState(false)
  const [editTarget, setEditTarget] = useState<Branch | null>(null)
  const [showRecordIncome, setShowRecordIncome] = useState<Branch | null>(null)
  const [showRecordExpense, setShowRecordExpense] = useState<Branch | null>(null)
  const [distributeTarget, setDistributeTarget] = useState<BranchIncome | null>(null)
  // Per-branch tab state: 'income' | 'expenses'
  const [branchTab, setBranchTab] = useState<Record<string, 'income' | 'expenses'>>({})

  const [form, setForm] = useState({ name: '', location: '' })
  const [editForm, setEditForm] = useState({ name: '', location: '', is_active: true })
  const [incomeForm, setIncomeForm] = useState({
    gross_sales: '',
    salary: '',
    expenses_total: '',
    roi: '',
    period_start: '',
    period_end: '',
    description: '',
  })
  const [expenseForm, setExpenseForm] = useState({
    category: 'other' as ExpenseCategory,
    amount: '',
    period_start: '',
    period_end: '',
    description: '',
  })

  const handleCreate = () => {
    if (!form.name.trim()) return
    createBranch.mutate(
      { name: form.name.trim(), location: form.location.trim() || null },
      {
        onSuccess: () => { setShowCreate(false); setForm({ name: '', location: '' }) },
        onError: (err: any) => alert(err.message ?? 'Failed to create branch'),
      }
    )
  }

  const handleEdit = () => {
    if (!editTarget || !editForm.name.trim()) return
    updateBranch.mutate(
      { id: editTarget.id, name: editForm.name.trim(), location: editForm.location.trim() || null, is_active: editForm.is_active },
      {
        onSuccess: () => setEditTarget(null),
        onError: (err: any) => alert(err.message ?? 'Failed to update branch'),
      }
    )
  }

  const handleRecordIncome = () => {
    if (!showRecordIncome || !incomeForm.gross_sales || !incomeForm.period_start || !incomeForm.period_end) return
    const grossSales = parseFloat(incomeForm.gross_sales) || 0
    const salary = parseFloat(incomeForm.salary) || 0
    const expensesTotal = parseFloat(incomeForm.expenses_total) || 0
    const netProfit = grossSales - salary - expensesTotal
    recordIncome.mutate(
      {
        branchId: showRecordIncome.id,
        amount: netProfit,
        periodStart: incomeForm.period_start,
        periodEnd: incomeForm.period_end,
        grossSales,
        salary,
        expensesTotal,
        roi: incomeForm.roi ? parseFloat(incomeForm.roi) : null,
        description: incomeForm.description.trim() || undefined,
      },
      {
        onSuccess: () => {
          setShowRecordIncome(null)
          setIncomeForm({ gross_sales: '', salary: '', expenses_total: '', roi: '', period_start: '', period_end: '', description: '' })
        },
        onError: (err: any) => alert(err.message ?? 'Failed to record income'),
      }
    )
  }

  const handleRecordExpense = () => {
    if (!showRecordExpense || !expenseForm.amount || !expenseForm.period_start || !expenseForm.period_end) return
    recordExpense.mutate(
      {
        branchId: showRecordExpense.id,
        category: expenseForm.category,
        amount: parseFloat(expenseForm.amount),
        periodStart: expenseForm.period_start,
        periodEnd: expenseForm.period_end,
        description: expenseForm.description.trim() || undefined,
      },
      {
        onSuccess: () => {
          setShowRecordExpense(null)
          setExpenseForm({ category: 'other', amount: '', period_start: '', period_end: '', description: '' })
        },
        onError: (err: any) => alert(err.message ?? 'Failed to record expense'),
      }
    )
  }

  const incomeByBranch = (branchId: string) =>
    allIncome.filter(i => i.branch_id === branchId)

  const expensesByBranch = (branchId: string) =>
    allExpenses.filter(e => e.branch_id === branchId)

  const getTab = (branchId: string) => branchTab[branchId] ?? 'income'
  const setTab = (branchId: string, tab: 'income' | 'expenses') =>
    setBranchTab(prev => ({ ...prev, [branchId]: tab }))

  return (
    <div>
      <Header
        title="Branches"
        subtitle="Cooperative-owned business ventures — income is shared among all shareholders"
      />

      <div className="p-4 sm:p-6 space-y-4">
        <PageGuide
          storageKey="branches"
          steps={[
            'Branches are businesses owned and operated by the cooperative (e.g., a sari-sari store, a farm, a transport service).',
            'Create a branch, then record its gross income and expenses each period (monthly, quarterly, etc.).',
            'Net Profit = Gross Revenue minus Total Expenses. Profit Margin shows what percentage of revenue is kept as profit.',
            "Click 'Distribute' on an income record to divide it among all shareholders. The system counts total completed shares across all active members, then gives each member their proportional cut.",
            'Example: ₱100,000 income ÷ 100 total completed shares = ₱1,000 per share. A member with 3 completed shares receives ₱3,000.',
            'Distributions are credited to each member\'s savings account and recorded in the ledger.',
          ]}
          note="Only fully completed shares are counted. A member with 1 completed share and 1 in-progress share only receives 1 share's worth. Members with no completed shares receive nothing."
        />

        <div className="flex justify-end">
          <Button onClick={() => setShowCreate(true)}>Add Branch</Button>
        </div>

        {isLoading ? (
          <p className="text-sm text-gray-400 text-center py-8">Loading…</p>
        ) : branches.length === 0 ? (
          <Card>
            <p className="px-6 py-8 text-sm text-gray-400 text-center">
              No branches yet. Add one to start recording income.
            </p>
          </Card>
        ) : (
          <div className="space-y-4">
            {branches.map(branch => {
              const income = incomeByBranch(branch.id)
              const expenses = expensesByBranch(branch.id)
              const totalGrossSales = income.reduce((s, i) => s + (i.gross_sales ?? i.amount), 0)
              const totalSalary = income.reduce((s, i) => s + (i.salary ?? 0), 0)
              const totalOtherExpenses = expenses.reduce((s, e) => s + e.amount, 0)
              const totalIncome = income.reduce((s, i) => s + i.amount, 0)
              const netProfit = totalIncome - totalOtherExpenses
              const profitMargin = totalGrossSales > 0 ? (netProfit / totalGrossSales) * 100 : null
              const activeTab = getTab(branch.id)

              return (
                <Card key={branch.id}>
                  {/* Branch header */}
                  <div className="px-4 py-3 flex items-center justify-between gap-4 border-b border-gray-100">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold text-gray-900">{branch.name}</h3>
                        <span className={`text-xs px-1.5 py-0.5 rounded ${branch.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                          {branch.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                      {branch.location && <p className="text-xs text-gray-500 mt-0.5">{branch.location}</p>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        size="sm"
                        onClick={() => setShowRecordIncome(branch)}
                      >
                        Record Income
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setShowRecordExpense(branch)}
                      >
                        Add Expense
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setEditTarget(branch)
                          setEditForm({ name: branch.name, location: branch.location ?? '', is_active: branch.is_active })
                        }}
                      >
                        Edit
                      </Button>
                    </div>
                  </div>

                  {/* KPI summary row */}
                  <div className="px-4 py-3 grid grid-cols-2 sm:grid-cols-5 gap-3 border-b border-gray-100 bg-gray-50 text-xs">
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
                      <p className="font-semibold text-red-600">{currency(totalOtherExpenses)}</p>
                    </div>
                    <div>
                      <p className="text-gray-500">Net Profit</p>
                      <p className={`font-semibold ${netProfit >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                        {currency(netProfit)}
                      </p>
                    </div>
                    <div>
                      <p className="text-gray-500">Profit Margin</p>
                      <p className={`font-semibold ${profitMargin === null ? 'text-gray-400' : profitMargin >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                        {profitMargin === null ? '—' : `${profitMargin.toFixed(1)}%`}
                      </p>
                    </div>
                  </div>

                  {/* Tabs */}
                  <div className="flex border-b border-gray-100 bg-white">
                    <button
                      className={`px-4 py-2 text-xs font-medium transition-colors ${activeTab === 'income' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
                      onClick={() => setTab(branch.id, 'income')}
                    >
                      Income ({income.length})
                    </button>
                    <button
                      className={`px-4 py-2 text-xs font-medium transition-colors ${activeTab === 'expenses' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
                      onClick={() => setTab(branch.id, 'expenses')}
                    >
                      Expenses ({expenses.length})
                    </button>
                  </div>

                  {/* Income records */}
                  {activeTab === 'income' && (
                    income.length === 0 ? (
                      <p className="px-4 py-3 text-xs text-gray-400 italic">No income recorded yet.</p>
                    ) : (
                      <div className="divide-y divide-gray-50">
                        {income.map(inc => (
                          <div key={inc.id} className="px-4 py-3 flex items-center gap-3">
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-gray-900">{currency(inc.amount)}</p>
                              <p className="text-xs text-gray-500">
                                {formatDate(inc.period_start)} – {formatDate(inc.period_end)}
                                {inc.description && ` · ${inc.description}`}
                              </p>
                            </div>
                            {inc.distributed ? (
                              <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium shrink-0">
                                Distributed
                              </span>
                            ) : (
                              <Button
                                size="sm"
                                className="shrink-0 bg-green-600 hover:bg-green-700 text-white"
                                onClick={() => setDistributeTarget(inc)}
                              >
                                Distribute
                              </Button>
                            )}
                          </div>
                        ))}
                      </div>
                    )
                  )}

                  {/* Expense records */}
                  {activeTab === 'expenses' && (
                    expenses.length === 0 ? (
                      <p className="px-4 py-3 text-xs text-gray-400 italic">No expenses recorded yet.</p>
                    ) : (
                      <div className="divide-y divide-gray-50">
                        {expenses.map(exp => (
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
                      </div>
                    )
                  )}
                </Card>
              )
            })}
          </div>
        )}
      </div>

      {/* Create branch modal */}
      <Modal isOpen={showCreate} onClose={() => setShowCreate(false)} title="Add Branch" size="sm">
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Branch Name <span className="text-red-500">*</span></label>
            <input
              type="text"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Sari-sari Store — Bulacan"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Location</label>
            <input
              type="text"
              value={form.location}
              onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
              placeholder="e.g. Bulacan"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="flex gap-3 pt-1">
            <Button variant="outline" className="flex-1" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button className="flex-1" loading={createBranch.isPending} disabled={!form.name.trim()} onClick={handleCreate}>
              Create
            </Button>
          </div>
        </div>
      </Modal>

      {/* Edit branch modal */}
      <Modal isOpen={!!editTarget} onClose={() => setEditTarget(null)} title="Edit Branch" size="sm">
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Branch Name <span className="text-red-500">*</span></label>
            <input
              type="text"
              value={editForm.name}
              onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Location</label>
            <input
              type="text"
              value={editForm.location}
              onChange={e => setEditForm(f => ({ ...f, location: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
            <input
              type="checkbox"
              checked={editForm.is_active}
              onChange={e => setEditForm(f => ({ ...f, is_active: e.target.checked }))}
              className="accent-blue-600"
            />
            Active (visible for income recording)
          </label>
          <div className="flex gap-3 pt-1">
            <Button variant="outline" className="flex-1" onClick={() => setEditTarget(null)}>Cancel</Button>
            <Button className="flex-1" loading={updateBranch.isPending} disabled={!editForm.name.trim()} onClick={handleEdit}>
              Save
            </Button>
          </div>
        </div>
      </Modal>

      {/* Record income modal */}
      <Modal
        isOpen={!!showRecordIncome}
        onClose={() => setShowRecordIncome(null)}
        title={`Record Income — ${showRecordIncome?.name ?? ''}`}
        size="sm"
      >
        <div className="space-y-3">
          {/* Period */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Period Start <span className="text-red-500">*</span></label>
              <input
                type="date"
                value={incomeForm.period_start}
                onChange={e => setIncomeForm(f => ({ ...f, period_start: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Period End <span className="text-red-500">*</span></label>
              <input
                type="date"
                value={incomeForm.period_end}
                onChange={e => setIncomeForm(f => ({ ...f, period_end: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Financials */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Gross Sales <span className="text-red-500">*</span></label>
            <input
              type="number" min="0" step="0.01"
              value={incomeForm.gross_sales}
              onChange={e => setIncomeForm(f => ({ ...f, gross_sales: e.target.value }))}
              placeholder="0.00"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Salary</label>
              <input
                type="number" min="0" step="0.01"
                value={incomeForm.salary}
                onChange={e => setIncomeForm(f => ({ ...f, salary: e.target.value }))}
                placeholder="0.00"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Other Expenses</label>
              <input
                type="number" min="0" step="0.01"
                value={incomeForm.expenses_total}
                onChange={e => setIncomeForm(f => ({ ...f, expenses_total: e.target.value }))}
                placeholder="0.00"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">ROI (%)</label>
            <input
              type="number" min="0" step="0.01"
              value={incomeForm.roi}
              onChange={e => setIncomeForm(f => ({ ...f, roi: e.target.value }))}
              placeholder="e.g. 12.5"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Net profit preview */}
          {incomeForm.gross_sales && (
            <div className="bg-gray-50 rounded-lg px-4 py-3 text-sm">
              <span className="text-gray-500">Net Profit (distributable): </span>
              <span className="font-semibold text-gray-900">
                ₱{(
                  (parseFloat(incomeForm.gross_sales) || 0) -
                  (parseFloat(incomeForm.salary) || 0) -
                  (parseFloat(incomeForm.expenses_total) || 0)
                ).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes (optional)</label>
            <input
              type="text"
              value={incomeForm.description}
              onChange={e => setIncomeForm(f => ({ ...f, description: e.target.value }))}
              placeholder="e.g. Q1 2026 summary"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="flex gap-3 pt-1">
            <Button variant="outline" className="flex-1" onClick={() => setShowRecordIncome(null)}>Cancel</Button>
            <Button
              className="flex-1"
              loading={recordIncome.isPending}
              disabled={!incomeForm.gross_sales || !incomeForm.period_start || !incomeForm.period_end}
              onClick={handleRecordIncome}
            >
              Record
            </Button>
          </div>
        </div>
      </Modal>

      {/* Record expense modal */}
      <Modal
        isOpen={!!showRecordExpense}
        onClose={() => setShowRecordExpense(null)}
        title={`Add Expense — ${showRecordExpense?.name ?? ''}`}
        size="sm"
      >
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Category <span className="text-red-500">*</span></label>
            <select
              value={expenseForm.category}
              onChange={e => setExpenseForm(f => ({ ...f, category: e.target.value as ExpenseCategory }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {EXPENSE_CATEGORIES.map(cat => (
                <option key={cat.value} value={cat.value}>{cat.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Amount <span className="text-red-500">*</span></label>
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={expenseForm.amount}
              onChange={e => setExpenseForm(f => ({ ...f, amount: e.target.value }))}
              placeholder="0.00"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Period Start <span className="text-red-500">*</span></label>
              <input
                type="date"
                value={expenseForm.period_start}
                onChange={e => setExpenseForm(f => ({ ...f, period_start: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Period End <span className="text-red-500">*</span></label>
              <input
                type="date"
                value={expenseForm.period_end}
                onChange={e => setExpenseForm(f => ({ ...f, period_end: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description (optional)</label>
            <input
              type="text"
              value={expenseForm.description}
              onChange={e => setExpenseForm(f => ({ ...f, description: e.target.value }))}
              placeholder="e.g. March salaries"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="flex gap-3 pt-1">
            <Button variant="outline" className="flex-1" onClick={() => setShowRecordExpense(null)}>Cancel</Button>
            <Button
              className="flex-1"
              loading={recordExpense.isPending}
              disabled={!expenseForm.amount || !expenseForm.period_start || !expenseForm.period_end}
              onClick={handleRecordExpense}
            >
              Record
            </Button>
          </div>
        </div>
      </Modal>

      {/* Distribute confirmation modal */}
      <Modal
        isOpen={!!distributeTarget}
        onClose={() => setDistributeTarget(null)}
        title="Distribute Income to Shareholders"
        size="sm"
      >
        {distributeTarget && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Distribute <strong>{currency(distributeTarget.amount)}</strong> proportionally among all
              active members with completed equity shares.
            </p>
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-800 space-y-1">
              <p>Formula: <strong>income ÷ total completed shares = amount per share</strong></p>
              <p>Each member receives: <em>amount per share × their completed share count</em></p>
              <p className="text-blue-600">Partially completed shares are not counted.</p>
            </div>
            <p className="text-xs text-gray-500">Credited to each member's savings account. Cannot be undone.</p>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setDistributeTarget(null)}>Cancel</Button>
              <Button
                className="flex-1 bg-green-600 hover:bg-green-700"
                loading={distribute.isPending}
                onClick={() =>
                  distribute.mutate(distributeTarget.id, {
                    onSuccess: () => setDistributeTarget(null),
                    onError: (err: any) => alert(err.message ?? 'Failed to distribute'),
                  })
                }
              >
                Distribute
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
