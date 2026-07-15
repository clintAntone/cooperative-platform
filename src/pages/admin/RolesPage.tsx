import { useState } from 'react'
import { Header } from '../../components/layout/Header'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { useCustomRoles, useCreateCustomRole, useDeleteCustomRole } from '../../hooks/useCustomRoles'

const colorOptions = [
  { value: 'gray',   label: 'Gray' },
  { value: 'blue',   label: 'Blue' },
  { value: 'green',  label: 'Green' },
  { value: 'purple', label: 'Purple' },
  { value: 'red',    label: 'Red' },
  { value: 'yellow', label: 'Yellow' },
  { value: 'orange', label: 'Orange' },
  { value: 'pink',   label: 'Pink' },
]

const colorMap: Record<string, string> = {
  gray:   'bg-gray-100 text-gray-700',
  blue:   'bg-blue-100 text-blue-700',
  green:  'bg-green-100 text-green-700',
  purple: 'bg-purple-100 text-purple-700',
  red:    'bg-red-100 text-red-700',
  yellow: 'bg-yellow-100 text-yellow-700',
  orange: 'bg-orange-100 text-orange-700',
  pink:   'bg-pink-100 text-pink-700',
}

const colorDotMap: Record<string, string> = {
  gray:   'bg-gray-400',
  blue:   'bg-blue-500',
  green:  'bg-green-500',
  purple: 'bg-purple-500',
  red:    'bg-red-500',
  yellow: 'bg-yellow-400',
  orange: 'bg-orange-500',
  pink:   'bg-pink-500',
}

export function RolesPage() {
  const { data: roles = [], isLoading } = useCustomRoles()
  const createRole = useCreateCustomRole()
  const deleteRole = useDeleteCustomRole()

  const [name, setName] = useState('')
  const [color, setColor] = useState('blue')
  const [description, setDescription] = useState('')
  const [nameError, setNameError] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  const handleCreate = async () => {
    if (!name.trim()) {
      setNameError('Name is required')
      return
    }
    setNameError('')
    await createRole.mutateAsync({ name, color, description })
    setName('')
    setColor('blue')
    setDescription('')
  }

  return (
    <div>
      <Header
        title="Custom Roles"
        subtitle="Define organizational labels for members (not access control)"
      />

      <div className="p-4 sm:p-6 space-y-6">
        {/* Create form */}
        <Card className="p-5">
          <h2 className="text-sm font-semibold text-gray-900 mb-4">Create New Role</h2>
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {/* Name */}
              <div className="sm:col-span-1">
                <label className="block text-xs font-medium text-gray-600 mb-1">Role Name *</label>
                <input
                  type="text"
                  value={name}
                  onChange={e => { setName(e.target.value); setNameError('') }}
                  placeholder="e.g. Collector, Treasurer"
                  className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${nameError ? 'border-red-300 bg-red-50' : 'border-gray-300'}`}
                />
                {nameError && <p className="text-xs text-red-600 mt-1">{nameError}</p>}
              </div>

              {/* Color */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Color</label>
                <div className="flex flex-wrap gap-2 pt-1">
                  {colorOptions.map(opt => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setColor(opt.value)}
                      title={opt.label}
                      className={`w-7 h-7 rounded-full border-2 transition-all ${colorDotMap[opt.value]} ${color === opt.value ? 'border-gray-900 scale-110' : 'border-transparent hover:border-gray-400'}`}
                    />
                  ))}
                </div>
                <p className="text-xs text-gray-400 mt-1">Selected: <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium ${colorMap[color]}`}>{color}</span></p>
              </div>

              {/* Description */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Description (optional)</label>
                <input
                  type="text"
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="Brief description of this role"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div className="flex justify-end">
              <Button
                onClick={handleCreate}
                loading={createRole.isPending}
                disabled={createRole.isPending}
              >
                Create Role
              </Button>
            </div>
          </div>
        </Card>

        {/* Roles list */}
        <Card>
          {isLoading ? (
            <div className="p-8 text-center text-sm text-gray-400">Loading roles...</div>
          ) : roles.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-400">
              No custom roles yet. Create one above.
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {roles.map(role => (
                <div key={role.id} className="flex items-center gap-4 px-5 py-4">
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${colorMap[role.color] ?? 'bg-gray-100 text-gray-700'}`}>
                    {role.name}
                  </span>
                  {role.description && (
                    <p className="text-sm text-gray-500 flex-1 truncate">{role.description}</p>
                  )}
                  {!role.description && <span className="flex-1" />}
                  <button
                    onClick={() => setDeleteConfirm(role.id)}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                    title="Delete role"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Delete confirmation */}
      {deleteConfirm && (() => {
        const role = roles.find(r => r.id === deleteConfirm)
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
            <div className="bg-white rounded-xl shadow-xl p-6 w-80 mx-4">
              <h3 className="text-base font-semibold text-gray-900 mb-1">Delete Role</h3>
              <p className="text-sm text-gray-500 mb-5">
                Delete the <span className="font-semibold">{role?.name}</span> role? Members assigned this role will have it cleared.
              </p>
              <div className="flex gap-3">
                <Button variant="secondary" className="flex-1" onClick={() => setDeleteConfirm(null)}>
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  className="flex-1"
                  loading={deleteRole.isPending}
                  onClick={async () => {
                    await deleteRole.mutateAsync(deleteConfirm)
                    setDeleteConfirm(null)
                  }}
                >
                  Delete
                </Button>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
