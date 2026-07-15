import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { Header } from '../../components/layout/Header'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { SkeletonPage } from '../../components/shared/Skeleton'
import { exportToExcel } from '../../lib/exportExcel'
import { formatDate } from '../../lib/utils'
import type { UserRole, AccountStatus } from '../../types'
import { PageGuide } from '../../components/shared/PageGuide'

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
}

interface UserDetail {
  id: string
  full_name: string
  email: string | null
  phone: string | null
  role: UserRole
  account_status: AccountStatus
  employee_id: string | null
  date_of_birth: string | null
  address: string | null
  civil_status: string | null
  emergency_contact_name: string | null
  emergency_contact_phone: string | null
  avatar_url: string | null
  profile_completed_at: string | null
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
  board: 'bg-amber-100 text-amber-800',
}

const statusColors: Record<AccountStatus, string> = {
  active: 'bg-green-100 text-green-800',
  suspended: 'bg-red-100 text-red-800',
  inactive: 'bg-gray-100 text-gray-500',
}

function DetailRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="py-2.5 border-b border-gray-50 last:border-0">
      <p className="text-xs text-gray-400 mb-0.5">{label}</p>
      <p className="text-sm text-gray-900">{value || <span className="text-gray-300 italic">Not provided</span>}</p>
    </div>
  )
}

function UserDrawer({
  userId,
  email,
  onClose,
  onChangeRole,
  onChangeStatus,
}: {
  userId: string
  email: string | null
  onClose: () => void
  onChangeRole: (user: UserRow) => void
  onChangeStatus: (user: UserRow) => void
}) {
  const { data: detail, isLoading } = useQuery<UserDetail>({
    queryKey: ['user_detail_drawer', userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, phone, role, account_status, employee_id, avatar_url, date_of_birth, address, civil_status, emergency_contact_name, emergency_contact_phone, profile_completed_at, created_at')
        .eq('id', userId)
        .single()
      if (error) throw error
      // Email comes from auth — fetch via admin RPC user list and match
      return data as UserDetail
    },
    enabled: !!userId,
  })

  // Also fetch membership + share summary
  const { data: summary } = useQuery({
    queryKey: ['user_drawer_summary', userId],
    queryFn: async () => {
      const [sharesRes, msRes] = await Promise.all([
        supabase
          .from('equity_shares')
          .select('status, paid_amount, target_amount')
          .eq('user_id', userId),
        supabase
          .from('membership_status')
          .select('status, completed_shares, last_evaluated_at')
          .eq('user_id', userId)
          .maybeSingle(),
      ])
      const shares = sharesRes.data ?? []
      const totalInvested = shares.reduce((s: number, r: any) => s + (r.paid_amount ?? 0), 0)
      const completed = shares.filter((r: any) => r.status === 'completed').length
      return { totalInvested, completed, total: shares.length, ms: msRes.data }
    },
    enabled: !!userId,
  })

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/30 z-40"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed top-0 right-0 h-full w-full max-w-sm bg-white z-50 shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">User Details</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {isLoading ? (
            <div className="space-y-3 animate-pulse">
              <div className="h-12 w-12 bg-gray-200 rounded-full mx-auto" />
              <div className="h-4 bg-gray-200 rounded w-2/3 mx-auto" />
              <div className="h-3 bg-gray-100 rounded w-1/2 mx-auto" />
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-10 bg-gray-100 rounded" />
              ))}
            </div>
          ) : detail ? (
            <>
              {/* Avatar + name */}
              <div className="flex flex-col items-center text-center gap-2 pb-2">
                <div className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center overflow-hidden border border-gray-200">
                  {detail.avatar_url ? (
                    <img src={detail.avatar_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-xl font-bold text-gray-400">
                      {detail.full_name?.charAt(0)?.toUpperCase() ?? '?'}
                    </span>
                  )}
                </div>
                <div>
                  <p className="text-base font-semibold text-gray-900">{detail.full_name}</p>
                  <div className="flex items-center justify-center gap-1.5 mt-1 flex-wrap">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize ${roleColors[detail.role]}`}>
                      {detail.role}
                    </span>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize ${statusColors[detail.account_status]}`}>
                      {detail.account_status}
                    </span>
                  </div>
                </div>
              </div>

              {/* Share summary */}
              {summary && (
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: 'Total Shares', value: summary.total },
                    { label: 'Completed', value: summary.completed },
                    { label: 'Total Invested', value: `₱${summary.totalInvested.toLocaleString()}` },
                  ].map(s => (
                    <div key={s.label} className="bg-gray-50 rounded-lg px-2 py-2 text-center">
                      <p className="text-sm font-bold text-gray-900">{s.value}</p>
                      <p className="text-[10px] text-gray-400 mt-0.5 leading-tight">{s.label}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Personal info */}
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Personal Info</p>
                <div className="bg-gray-50 rounded-xl px-4 py-1">
                  <DetailRow label="Email" value={email} />
                  <DetailRow label="Phone" value={detail.phone} />
                  <DetailRow label="Employee ID" value={detail.employee_id} />
                  <DetailRow label="Date of Birth" value={detail.date_of_birth ? formatDate(detail.date_of_birth) : null} />
                  <DetailRow label="Civil Status" value={detail.civil_status} />
                  <DetailRow label="Address" value={detail.address} />
                </div>
              </div>

              {/* Emergency contact */}
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Emergency Contact</p>
                <div className="bg-gray-50 rounded-xl px-4 py-1">
                  <DetailRow label="Name" value={detail.emergency_contact_name} />
                  <DetailRow label="Phone" value={detail.emergency_contact_phone} />
                </div>
              </div>

              {/* Account info */}
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Account</p>
                <div className="bg-gray-50 rounded-xl px-4 py-1">
                  <DetailRow label="Joined" value={formatDate(detail.created_at)} />
                  <DetailRow label="Profile Completed" value={detail.profile_completed_at ? formatDate(detail.profile_completed_at) : null} />
                  {summary?.ms && (
                    <DetailRow label="Membership Status" value={summary.ms.status} />
                  )}
                </div>
              </div>
            </>
          ) : (
            <p className="text-sm text-gray-400 text-center py-10">Could not load user details.</p>
          )}
        </div>

        {/* Footer actions */}
        {detail && (
          <div className="px-5 py-4 border-t border-gray-100 flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={() => {
                const row: UserRow = {
                  id: detail.id,
                  full_name: detail.full_name,
                  email: detail.email,
                  phone: detail.phone,
                  role: detail.role,
                  account_status: detail.account_status,
                  membership_status: summary?.ms?.status ?? null,
                  completed_shares: summary?.completed ?? null,
                  created_at: detail.created_at,
                }
                onChangeRole(row)
              }}
            >
              Change Role
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={() => {
                const row: UserRow = {
                  id: detail.id,
                  full_name: detail.full_name,
                  email: detail.email,
                  phone: detail.phone,
                  role: detail.role,
                  account_status: detail.account_status,
                  membership_status: summary?.ms?.status ?? null,
                  completed_shares: summary?.completed ?? null,
                  created_at: detail.created_at,
                }
                onChangeStatus(row)
              }}
            >
              Change Status
            </Button>
          </div>
        )}
      </div>
    </>
  )
}

export function UsersPage() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<string>('all')
  const [editState, setEditState] = useState<EditState | null>(null)
  const [disableReason, setDisableReason] = useState('')
  const [reasonError, setReasonError] = useState('')
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)

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
      queryClient.invalidateQueries({ queryKey: ['user_detail_drawer'] })
      setEditState(null)
    },
  })

  const updateStatus = useMutation({
    mutationFn: async ({ userId, status, reason }: { userId: string; status: string; reason?: string }) => {
      const { error } = await supabase.rpc('admin_update_user_status', {
        p_target_user_id: userId,
        p_new_status: status,
      })
      if (error) throw error
      if (reason) {
        await supabase.rpc('log_admin_action', {
          p_action: `account_status_changed_to_${status}`,
          p_target_user_id: userId,
          p_metadata: { reason },
        })
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      queryClient.invalidateQueries({ queryKey: ['user_detail_drawer'] })
      setEditState(null)
      setDisableReason('')
      setReasonError('')
    },
  })

  const requiresReason =
    editState?.field === 'account_status' &&
    (editState.newValue === 'suspended' || editState.newValue === 'inactive') &&
    editState.user.role === 'member' &&
    (editState.user.completed_shares ?? 0) > 0

  const handleConfirm = () => {
    if (!editState) return
    if (requiresReason && !disableReason.trim()) {
      setReasonError('Please provide a reason before proceeding.')
      return
    }
    setReasonError('')
    if (editState.field === 'role') {
      updateRole.mutate({ userId: editState.user.id, role: editState.newValue })
    } else {
      updateStatus.mutate({
        userId: editState.user.id,
        status: editState.newValue,
        reason: disableReason.trim() || undefined,
      })
    }
  }

  const openEditState = (state: EditState) => {
    setEditState(state)
    setDisableReason('')
    setReasonError('')
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
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" />
            </svg>
            <span className="hidden sm:inline">Export</span>
          </button>
        }
      />

      <div className="p-4 sm:p-6 space-y-6">
        <PageGuide
          storageKey="manage-users"
          steps={[
            'This page manages system user accounts — roles, status, and employee ID assignment.',
            "Click any row to view the user's personal details in a side panel.",
            "Use Change Role or Change Status buttons to update a user's access.",
          ]}
          note="Changing a user's role takes effect immediately. Be careful assigning 'admin' — admins have full access to all data."
        />

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

        {/* Mobile card list */}
        <div className="sm:hidden space-y-3">
          {filtered.length === 0 && (
            <p className="text-center py-10 text-sm text-gray-400">No users found</p>
          )}
          {filtered.map(user => (
            <div
              key={user.id}
              className={`bg-white rounded-xl border px-4 py-3.5 space-y-2.5 cursor-pointer transition-colors ${
                selectedUserId === user.id ? 'border-blue-300 bg-blue-50/40' : 'border-gray-200 hover:border-blue-200 hover:bg-blue-50/30'
              }`}
              onClick={() => setSelectedUserId(user.id)}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-sm text-gray-900 leading-snug">{user.full_name}</p>
                  {user.phone && <p className="text-xs text-gray-400 mt-0.5">{user.phone}</p>}
                </div>
                <span className={`flex-shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize ${roleColors[user.role]}`}>
                  {user.role}
                </span>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${statusColors[user.account_status]}`}>
                  {user.account_status}
                </span>
              </div>
              <p className="text-xs text-gray-400">
                {user.completed_shares ?? 0} {(user.completed_shares ?? 0) === 1 ? 'share' : 'shares'}
                {' · '}
                Joined {new Date(user.created_at).toLocaleDateString()}
              </p>
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
                  className={`cursor-pointer transition-colors ${
                    selectedUserId === user.id ? 'bg-blue-50' : 'hover:bg-gray-50'
                  }`}
                  onClick={() => setSelectedUserId(user.id)}
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
                        onClick={() => openEditState({ user, field: 'role', newValue: user.role })}
                        className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                      >
                        Change Role
                      </button>
                      <span className="text-gray-300">|</span>
                      <button
                        onClick={() => openEditState({ user, field: 'account_status', newValue: user.account_status })}
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
        </Card>
      </div>

      {/* User detail drawer */}
      {selectedUserId && (
        <UserDrawer
          userId={selectedUserId}
          email={users.find(u => u.id === selectedUserId)?.email ?? null}
          onClose={() => setSelectedUserId(null)}
          onChangeRole={user => openEditState({ user, field: 'role', newValue: user.role })}
          onChangeStatus={user => openEditState({ user, field: 'account_status', newValue: user.account_status })}
        />
      )}

      {/* Edit modal */}
      {editState && (
        <Modal
          isOpen={!!editState}
          title={editState.field === 'role' ? 'Change User Role' : 'Change Account Status'}
          onClose={() => { setEditState(null); setDisableReason(''); setReasonError('') }}
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
                onChange={e => { setEditState({ ...editState, newValue: e.target.value }); setReasonError('') }}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {editState.field === 'role' ? (
                  <>
                    <option value="member">Member</option>
                    <option value="staff">Staff</option>
                    <option value="board">Board of Directors</option>
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

            {editState.field === 'account_status' &&
              (editState.newValue === 'suspended' || editState.newValue === 'inactive') &&
              editState.user.role === 'member' && (
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-gray-700">
                  Reason{(editState.user.completed_shares ?? 0) > 0 ? ' *' : ''}
                </label>
                {(editState.user.completed_shares ?? 0) > 0 && (
                  <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    This member has {editState.user.completed_shares} completed share{(editState.user.completed_shares ?? 0) > 1 ? 's' : ''}. A reason is required to proceed.
                  </p>
                )}
                <textarea
                  rows={3}
                  value={disableReason}
                  onChange={e => { setDisableReason(e.target.value); setReasonError('') }}
                  placeholder="e.g. Resigned, extended leave, non-payment..."
                  className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none ${reasonError ? 'border-red-300 bg-red-50' : 'border-gray-300'}`}
                />
                {reasonError && <p className="text-xs text-red-600">{reasonError}</p>}
              </div>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <Button variant="secondary" onClick={() => { setEditState(null); setDisableReason(''); setReasonError('') }}>
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
