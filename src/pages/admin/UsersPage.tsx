import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { exportToExcel } from '../../lib/exportExcel'
import type { UserRole, AccountStatus, MembershipStatusValue } from '../../types'

interface UserRow {
  id: string
  full_name: string
  email: string | null
  phone: string | null
  role: UserRole
  account_status: AccountStatus
  membership_status: MembershipStatusValue | null
  completed_shares: number | null
  created_at: string
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
}

const statusColors: Record<AccountStatus, string> = {
  active: 'bg-green-100 text-green-800',
  suspended: 'bg-red-100 text-red-800',
  inactive: 'bg-gray-100 text-gray-500',
}

const membershipColors: Record<MembershipStatusValue, string> = {
  active: 'bg-green-100 text-green-800',
  pending: 'bg-yellow-100 text-yellow-800',
  suspended: 'bg-red-100 text-red-800',
  inactive: 'bg-gray-100 text-gray-500',
}

export function UsersPage() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<string>('all')
  const [editState, setEditState] = useState<EditState | null>(null)

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
    member: users.filter(u => u.role === 'member').length,
    active: users.filter(u => u.account_status === 'active').length,
    suspended: users.filter(u => u.account_status === 'suspended').length,
  }

  if (isLoading) return <LoadingSpinner />

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">User Management</h1>
          <p className="text-sm text-gray-500 mt-1">Manage roles and account status for all users</p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            const rows = filtered.map(u => ({
              Name: u.full_name,
              Role: u.role,
              'Account Status': u.account_status,
              'Membership Status': u.membership_status ?? '',
              'Completed Shares': u.completed_shares ?? 0,
              Joined: new Date(u.created_at).toLocaleDateString(),
            }))
            exportToExcel(rows, 'users')
          }}
        >
          Export
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Users', value: counts.total, color: 'text-gray-900' },
          { label: 'Admins', value: counts.admin, color: 'text-purple-700' },
          { label: 'Staff', value: counts.staff, color: 'text-blue-700' },
          { label: 'Members', value: counts.member, color: 'text-gray-700' },
        ].map(c => (
          <Card key={c.label} className="p-4 text-center">
            <p className={`text-2xl font-bold ${c.color}`}>{c.value}</p>
            <p className="text-xs text-gray-500 mt-1">{c.label}</p>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <Card className="p-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            placeholder="Search by name..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <select
            value={roleFilter}
            onChange={e => setRoleFilter(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All Roles</option>
            <option value="admin">Admin</option>
            <option value="staff">Staff</option>
            <option value="member">Member</option>
          </select>
        </div>
      </Card>

      {/* Users table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Name</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Role</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Account Status</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Membership</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Shares</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Joined</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center py-10 text-gray-400">
                    No users found
                  </td>
                </tr>
              )}
              {filtered.map(user => (
                <tr key={user.id} className="hover:bg-gray-50">
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
                  <td className="px-4 py-3">
                    {user.membership_status ? (
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${membershipColors[user.membership_status]}`}>
                        {user.membership_status}
                      </span>
                    ) : (
                      <span className="text-gray-400 text-xs">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    {user.completed_shares ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    {new Date(user.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">
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
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

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
