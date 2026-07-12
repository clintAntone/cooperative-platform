import { useState } from 'react'
import { Header } from '../../components/layout/Header'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { useBranches, useCreateBranch, useUpdateBranch } from '../../hooks/useBranches'
import type { Branch } from '../../types'
import { formatDate } from '../../lib/utils'
import { PageGuide } from '../../components/shared/PageGuide'

export function BranchesPage() {
  const { data: branches = [], isLoading } = useBranches()
  const createBranch = useCreateBranch()
  const updateBranch = useUpdateBranch()

  const [showCreate, setShowCreate] = useState(false)
  const [editTarget, setEditTarget] = useState<Branch | null>(null)

  const [form, setForm] = useState({ name: '', location: '' })
  const [editForm, setEditForm] = useState({ name: '', location: '', is_active: true })

  const handleCreate = () => {
    if (!form.name.trim()) return
    createBranch.mutate(
      { name: form.name.trim(), location: form.location.trim() || null },
      {
        onSuccess: () => {
          setShowCreate(false)
          setForm({ name: '', location: '' })
        },
        onError: (err: any) => alert(err.message ?? 'Failed to create branch'),
      }
    )
  }

  const openEdit = (branch: Branch) => {
    setEditTarget(branch)
    setEditForm({ name: branch.name, location: branch.location ?? '', is_active: branch.is_active })
  }

  const handleUpdate = () => {
    if (!editTarget || !editForm.name.trim()) return
    updateBranch.mutate(
      { id: editTarget.id, name: editForm.name.trim(), location: editForm.location.trim() || null, is_active: editForm.is_active },
      {
        onSuccess: () => setEditTarget(null),
        onError: (err: any) => alert(err.message ?? 'Failed to update branch'),
      }
    )
  }

  return (
    <div>
      <Header
        title="Branches"
        subtitle="Manage cooperative branch locations"
        actions={
          <Button size="sm" onClick={() => setShowCreate(true)}>+ New Branch</Button>
        }
      />

      <div className="p-4 sm:p-6 space-y-4">
        <PageGuide
          storageKey="branches"
          steps={[
            'Branches represent physical locations or chapters of the cooperative.',
            'Create branches here, then assign members to their branch from the Member Detail page.',
            'Deactivating a branch hides it from new assignments but does not unassign existing members.',
          ]}
          note="Branch assignment is optional — members without a branch are simply shown as unassigned."
        />
        {/* Mobile cards */}
        <div className="sm:hidden space-y-3">
          {isLoading ? (
            <p className="text-sm text-gray-400 text-center py-8">Loading…</p>
          ) : branches.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">No branches yet. Create one to get started.</p>
          ) : branches.map(branch => (
            <div key={branch.id} className="bg-white rounded-xl border border-gray-200 px-4 py-3.5 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-gray-900">{branch.name}</p>
                  {branch.location && <p className="text-xs text-gray-500 mt-0.5">{branch.location}</p>}
                </div>
                <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${branch.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                  {branch.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>
              <p className="text-xs text-gray-400">Created {formatDate(branch.created_at)}</p>
              <Button size="sm" variant="outline" onClick={() => openEdit(branch)}>Edit</Button>
            </div>
          ))}
        </div>

        {/* Desktop table */}
        <Card className="hidden sm:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Branch Name</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Location</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Created</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {isLoading ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-gray-400">Loading…</td></tr>
              ) : branches.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-gray-400">No branches yet. Create one to get started.</td></tr>
              ) : branches.map(branch => (
                <tr key={branch.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{branch.name}</td>
                  <td className="px-4 py-3 text-gray-500">{branch.location ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${branch.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {branch.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{formatDate(branch.created_at)}</td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => openEdit(branch)}
                      className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      {/* Create branch modal */}
      <Modal isOpen={showCreate} onClose={() => setShowCreate(false)} title="Create Branch" size="sm">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Branch Name <span className="text-red-500">*</span></label>
            <input
              type="text"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Main Branch"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Location</label>
            <input
              type="text"
              value={form.location}
              onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
              placeholder="e.g. 123 Main St, City"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="flex gap-3 pt-1">
            <Button variant="outline" className="flex-1" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button
              className="flex-1"
              loading={createBranch.isPending}
              disabled={!form.name.trim()}
              onClick={handleCreate}
            >
              Create
            </Button>
          </div>
        </div>
      </Modal>

      {/* Edit branch modal */}
      <Modal isOpen={!!editTarget} onClose={() => setEditTarget(null)} title="Edit Branch" size="sm">
        {editTarget && (
          <div className="space-y-4">
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
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="is_active"
                checked={editForm.is_active}
                onChange={e => setEditForm(f => ({ ...f, is_active: e.target.checked }))}
                className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <label htmlFor="is_active" className="text-sm text-gray-700">Active</label>
            </div>
            <div className="flex gap-3 pt-1">
              <Button variant="outline" className="flex-1" onClick={() => setEditTarget(null)}>Cancel</Button>
              <Button
                className="flex-1"
                loading={updateBranch.isPending}
                disabled={!editForm.name.trim()}
                onClick={handleUpdate}
              >
                Save Changes
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
