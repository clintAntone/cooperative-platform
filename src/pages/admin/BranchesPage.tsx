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
} from '../../hooks/useBranches'
import { useCurrency } from '../../hooks/useCurrency'
import { formatDate } from '../../lib/utils'
import { PageGuide } from '../../components/shared/PageGuide'
import type { Branch, BranchIncome } from '../../types'

export function BranchesPage() {
  const { format: currency } = useCurrency()
  const { data: branches = [], isLoading } = useBranches()
  const { data: allIncome = [] } = useAllBranchIncome()
  const createBranch = useCreateBranch()
  const updateBranch = useUpdateBranch()
  const recordIncome = useRecordBranchIncome()
  const distribute = useDistributeBranchIncome()

  const [showCreate, setShowCreate] = useState(false)
  const [editTarget, setEditTarget] = useState<Branch | null>(null)
  const [showRecordIncome, setShowRecordIncome] = useState<Branch | null>(null)
  const [distributeTarget, setDistributeTarget] = useState<BranchIncome | null>(null)

  const [form, setForm] = useState({ name: '', location: '' })
  const [editForm, setEditForm] = useState({ name: '', location: '', is_active: true })
  const [incomeForm, setIncomeForm] = useState({
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
    if (!showRecordIncome || !incomeForm.amount || !incomeForm.period_start || !incomeForm.period_end) return
    recordIncome.mutate(
      {
        branchId: showRecordIncome.id,
        amount: parseFloat(incomeForm.amount),
        periodStart: incomeForm.period_start,
        periodEnd: incomeForm.period_end,
        description: incomeForm.description.trim() || undefined,
      },
      {
        onSuccess: () => {
          setShowRecordIncome(null)
          setIncomeForm({ amount: '', period_start: '', period_end: '', description: '' })
        },
        onError: (err: any) => alert(err.message ?? 'Failed to record income'),
      }
    )
  }

  const incomeByBranch = (branchId: string) =>
    allIncome.filter(i => i.branch_id === branchId)

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
            'Create a branch, then record its net income each period (monthly, quarterly, etc.).',
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
              const totalIncome = income.reduce((s, i) => s + i.amount, 0)
              const totalDistributed = income.filter(i => i.distributed).reduce((s, i) => s + i.amount, 0)

              return (
                <Card key={branch.id}>
                  {/* Branch header */}
                  <div className="px-4 py-3 flex items-center justify-between gap-4 border-b border-gray-100">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold text-gray-900">{branch.name}</h3>
                        {!branch.is_active && (
                          <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">Inactive</span>
                        )}
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
                        onClick={() => {
                          setEditTarget(branch)
                          setEditForm({ name: branch.name, location: branch.location ?? '', is_active: branch.is_active })
                        }}
                      >
                        Edit
                      </Button>
                    </div>
                  </div>

                  {/* Income summary */}
                  <div className="px-4 py-2 grid grid-cols-2 sm:grid-cols-3 gap-3 border-b border-gray-100 bg-gray-50 text-xs">
                    <div>
                      <p className="text-gray-500">Total Income Recorded</p>
                      <p className="font-semibold text-gray-900">{currency(totalIncome)}</p>
                    </div>
                    <div>
                      <p className="text-gray-500">Total Distributed</p>
                      <p className="font-semibold text-green-700">{currency(totalDistributed)}</p>
                    </div>
                    <div>
                      <p className="text-gray-500">Pending Distribution</p>
                      <p className="font-semibold text-orange-600">{currency(totalIncome - totalDistributed)}</p>
                    </div>
                  </div>

                  {/* Income records */}
                  {income.length === 0 ? (
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
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Amount <span className="text-red-500">*</span></label>
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={incomeForm.amount}
              onChange={e => setIncomeForm(f => ({ ...f, amount: e.target.value }))}
              placeholder="0.00"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
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
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description (optional)</label>
            <input
              type="text"
              value={incomeForm.description}
              onChange={e => setIncomeForm(f => ({ ...f, description: e.target.value }))}
              placeholder="e.g. Q1 2026 net profit"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="flex gap-3 pt-1">
            <Button variant="outline" className="flex-1" onClick={() => setShowRecordIncome(null)}>Cancel</Button>
            <Button
              className="flex-1"
              loading={recordIncome.isPending}
              disabled={!incomeForm.amount || !incomeForm.period_start || !incomeForm.period_end}
              onClick={handleRecordIncome}
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
