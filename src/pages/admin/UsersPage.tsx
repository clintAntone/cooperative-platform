import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { Header } from '../../components/layout/Header'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { SkeletonPage } from '../../components/shared/Skeleton'
import { exportToExcel } from '../../lib/exportExcel'
import type { UserRole, AccountStatus } from '../../types'

interface UserRow {
  id: string
  full_name: string
  email: string | null
  phone: string | null
  role: UserRole
  account_status: AccountStatus
  membership_status: string | null
  completed_shares: number | null
  created_at: string
  deleted_at?: string | null
}

function useDeleteUser() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await supabase.rpc('admin_soft_delete_user', { p_user_id: userId })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
    },
  })
}

interface EditState {
  user: UserRow
  field: 'role' | 'account_status'
  newValue: string
}

const roleColors: Record<UserRole, string> = {
  admin: 'bg-purple-100 text-purple-800',
  staff: 'bg-blue-100 text-blue-800',
  member: 'bg-gray-100 text-gray-700',
  collector: 'bg-indigo-100 text-indigo-800',
}

const statusColors: Record<AccountStatus, string> = {
  active: 'bg-green-100 text-green-800',
  suspended: 'bg-red-100 text-red-800',
  inactive: 'bg-gray-100 text-gray-500',
}


export function UsersPage() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<string>('all')
  const [editState, setEditState] = useState<EditState | null>(null)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [pressingId, setPressingId] = useState<string | null>(null)
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const deleteUser = useDeleteUser()

  const startLongPress = (userId: string) => {
    setPressingId(userId)
    longPressTimer.current = setTimeout(() => {
      setDeleteConfirmId(userId)
      setPressingId(null)
    }, 700)
  }

  const cancelLongPress = () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current)
    setPressingId(null)
  }

  const handleRowClick = (user: UserRow) => {
    if (user.role === 'member') {
      navigate(`/admin/members/${user.id}`)
    } else {
      navigate(`/admin/users/${user.id}`)
    }
  }

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['admin-users'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_all_users_for_admin')
      if (error) throw error
      return (data ?? []) as UserRow[]
    },
  })

  const updateRole = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: string }) => {
      const { error } = await supabase.rpc('admin_update_user_role', {
        p_target_user_id: userId,
        p_new_role: role,
      })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      setEditState(null)
    },
  })

  const updateStatus = useMutation({
    mutationFn: async ({ userId, status }: { userId: string; status: string }) => {
      const { error } = await supabase.rpc('admin_update_user_status', {
        p_target_user_id: userId,
        p_new_status: status,
      })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      setEditState(null)
    },
  })

  const handleConfirm = () => {
    if (!editState) return
    if (editState.field === 'role') {
      updateRole.mutate({ userId: editState.user.id, role: editState.newValue })
    } else {
      updateStatus.mutate({ userId: editState.user.id, status: editState.newValue })
    }
  }

  const filtered = users.filter(u => {
    const matchesSearch =
      u.full_name.toLowerCase().includes(search.toLowerCase()) ||
      (u.email?.toLowerCase().includes(search.toLowerCase()) ?? false)
    const matchesRole = roleFilter === 'all' || u.role === roleFilter
    return matchesSearch && matchesRole
  })

  const counts = {
    total: users.length,
    admin: users.filter(u => u.role === 'admin').length,
    staff: users.filter(u => u.role === 'staff').length,
    member: users.filter(u => u.role === 'member' || u.role === 'collector').length,
    active: users.filter(u => u.account_status === 'active').length,
    suspended: users.filter(u => u.account_status === 'suspended').length,
  }

  const handleExport = () => {
    const rows = filtered.map(u => ({
      Name: u.full_name,
      Role: u.role,
      'Account Status': u.account_status,
      'Membership Status': u.membership_status ?? '',
      'Completed Shares': u.completed_shares ?? 0,
      Joined: new Date(u.created_at).toLocaleDateString(),
    }))
    exportToExcel(rows, 'users')
  }

  if (isLoading) return <SkeletonPage cards={2} rows={6} />

  return (
    <div>
      <Header
        title="User Management"
        subtitle="Manage roles and account status for all users"
        actions={
          <button
            onClick={handleExport}
            title="Export to Excel"
            className="inline-flex items-center gap-1.5 border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
          >
            {/* Download icon */}
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" />
            </svg>
            <span className="hidden sm:inline">Export</span>
          </button>
        }
      />

    <div className="p-4 sm:p-6 space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-2">
        {[
          { label: 'Total', value: counts.total, color: 'text-gray-900' },
          { label: 'Admins', value: counts.admin, color: 'text-purple-700' },
          { label: 'Staff', value: counts.staff, color: 'text-blue-700' },
          { label: 'Members', value: counts.member, color: 'text-gray-700' },
        ].map(c => (
          <Card key={c.label} className="p-3 text-center">
            <p className={`text-xl font-bold ${c.color}`}>{c.value}</p>
            <p className="text-xs text-gray-500 mt-0.5">{c.label}</p>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            type="text"
            placeholder="Search by name or email…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full border border-gray-300 rounded-lg pl-3 pr-8 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              aria-label="Clear search"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
        <select
          value={roleFilter}
          onChange={e => setRoleFilter(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
        >
          <option value="all">All Roles</option>
          <option value="admin">Admin</option>
          <option value="staff">Staff</option>
          <option value="member">Member</option>
        </select>
      </div>

      {/* Users table */}
        {/* Mobile card list */}
        <div className="sm:hidden space-y-3">
          {filtered.length === 0 && (
            <p className="text-center py-10 text-sm text-gray-400">No users found</p>
          )}
          {filtered.map(user => (
            <div
              key={user.id}
              className={`bg-white rounded-xl border px-4 py-3.5 space-y-2.5 select-none transition-colors cursor-pointer ${
                pressingId === user.id
                  ? 'border-red-300 bg-red-50'
                  : 'border-gray-200 hover:border-blue-200 hover:bg-blue-50/30'
              }`}
              onClick={() => handleRowClick(user)}
              onTouchStart={() => startLongPress(user.id)}
              onTouchEnd={cancelLongPress}
              onTouchCancel={cancelLongPress}
              onContextMenu={e => e.preventDefault()}
            >
              {/* Name + role */}
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-sm text-gray-900 leading-snug">{user.full_name}</p>
                  {user.phone && <p className="text-xs text-gray-400 mt-0.5">{user.phone}</p>}
                </div>
                <span className={`flex-shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize ${roleColors[user.role]}`}>
                  {user.role}
                </span>
              </div>

              {/* Status badges */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${statusColors[user.account_status]}`}>
                  {user.account_status}
                </span>
              </div>

              {/* Meta row */}
              <p className="text-xs text-gray-400">
                {user.completed_shares ?? 0} {(user.completed_shares ?? 0) === 1 ? 'share' : 'shares'}
                {' · '}
                Joined {new Date(user.created_at).toLocaleDateString()}
              </p>

              {/* Actions */}
              <div
                className="flex items-center gap-2 pt-0.5 border-t border-gray-100"
                onTouchStart={e => e.stopPropagation()}
                onClick={e => e.stopPropagation()}
              >
                <button
                  onClick={() => setEditState({ user, field: 'role', newValue: user.role })}
                  className="flex-1 text-xs text-center py-1.5 rounded-lg text-blue-600 hover:bg-blue-50 font-medium transition-colors"
                >
                  Change Role
                </button>
                <div className="w-px h-4 bg-gray-200" />
                <button
                  onClick={() => setEditState({ user, field: 'account_status', newValue: user.account_status })}
                  className="flex-1 text-xs text-center py-1.5 rounded-lg text-orange-600 hover:bg-orange-50 font-medium transition-colors"
                >
                  Change Status
                </button>
              </div>
            </div>
          ))}
        </div>
        {/* Desktop table */}
        <Card className="hidden sm:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Name</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Role</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Account Status</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Shares</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Joined</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center py-10 text-gray-400">
                    No users found
                  </td>
                </tr>
              )}
              {filtered.map(user => (
                <tr
                  key={user.id}
                  className="hover:bg-gray-50 cursor-pointer"
                  onClick={() => handleRowClick(user)}
                >
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{user.full_name}</p>
                    {user.phone && <p className="text-xs text-gray-400">{user.phone}</p>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${roleColors[user.role]}`}>
                      {user.role}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${statusColors[user.account_status]}`}>
                      {user.account_status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    {user.completed_shares ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    {new Date(user.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setEditState({ user, field: 'role', newValue: user.role })}
                        className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                      >
                        Change Role
                      </button>
                      <span className="text-gray-300">|</span>
                      <button
                        onClick={() => setEditState({ user, field: 'account_status', newValue: user.account_status })}
                        className="text-xs text-orange-600 hover:text-orange-800 font-medium"
                      >
                        Change Status
                      </button>
                      <span className="text-gray-300">|</span>
                      <button
                        onClick={() => setDeleteConfirmId(user.id)}
                        className="text-xs text-red-600 hover:text-red-800 font-medium"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
    </div>

      {/* Confirm delete modal */}
      <Modal
        isOpen={!!deleteConfirmId}
        onClose={() => setDeleteConfirmId(null)}
        title="Delete User"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            This will soft-delete the user. They won't be able to log in and will be hidden from all lists. This can be undone.
          </p>
          <div className="flex gap-3">
            <Button variant="outline" className="flex-1" onClick={() => setDeleteConfirmId(null)}>Cancel</Button>
            <Button
              variant="danger"
              className="flex-1"
              loading={deleteUser.isPending}
              onClick={() => {
                deleteUser.mutate(deleteConfirmId!, {
                  onSuccess: () => setDeleteConfirmId(null)
                })
              }}
            >
              Delete
            </Button>
          </div>
        </div>
      </Modal>

      {/* Confirm edit modal */}
      {editState && (
        <Modal
          isOpen={!!editState}
          title={editState.field === 'role' ? 'Change User Role' : 'Change Account Status'}
          onClose={() => setEditState(null)}
        >
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Updating <span className="font-semibold">{editState.user.full_name}</span>
            </p>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {editState.field === 'role' ? 'New Role' : 'New Status'}
              </label>
              <select
                value={editState.newValue}
                onChange={e => setEditState({ ...editState, newValue: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {editState.field === 'role' ? (
                  <>
                    <option value="member">Member</option>
                    <option value="staff">Staff</option>
                    <option value="admin">Admin</option>
                  </>
                ) : (
                  <>
                    <option value="active">Active</option>
                    <option value="suspended">Suspended</option>
                    <option value="inactive">Inactive</option>
                  </>
                )}
              </select>
            </div>

            {editState.field === 'role' && editState.newValue === 'admin' && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-xs text-yellow-800">
                Warning: Admins have full access including system config and user management.
              </div>
            )}

            {editState.field === 'account_status' && editState.newValue === 'suspended' && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-800">
                Suspending this account will prevent the user from logging in.
              </div>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <Button variant="secondary" onClick={() => setEditState(null)}>
                Cancel
              </Button>
              <Button
                onClick={handleConfirm}
                disabled={updateRole.isPending || updateStatus.isPending}
              >
                {updateRole.isPending || updateStatus.isPending ? 'Saving...' : 'Confirm'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

