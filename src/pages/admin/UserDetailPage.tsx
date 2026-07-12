import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { Header } from '../../components/layout/Header'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { SkeletonPage } from '../../components/shared/Skeleton'
import type { UserRole, AccountStatus } from '../../types'

interface UserDetail {
  id: string
  full_name: string
  phone: string | null
  role: UserRole
  account_status: AccountStatus
  email: string | null
  employee_id: string | null
  avatar_url: string | null
  date_of_birth: string | null
  address: string | null
  civil_status: string | null
  emergency_contact_name: string | null
  emergency_contact_phone: string | null
  profile_completed_at: string | null
  membership_status: string | null
  completed_shares: number | null
  created_at: string
}

const roleColors: Record<UserRole, string> = {
  admin: 'bg-purple-100 text-purple-800',
  staff: 'bg-blue-100 text-blue-800',
  member: 'bg-gray-100 text-gray-700',
  collector: 'bg-indigo-100 text-indigo-800',
  board: 'bg-amber-100 text-amber-800',
}

const statusColors: Record<AccountStatus, string> = {
  active: 'bg-green-100 text-green-800',
  suspended: 'bg-red-100 text-red-800',
  inactive: 'bg-gray-100 text-gray-500',
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-3 border-b border-gray-100 last:border-0">
      <span className="text-sm text-gray-500 min-w-[160px] flex-shrink-0">{label}</span>
      <span className="text-sm text-gray-900 font-medium break-words">{value ?? <span className="text-gray-400 font-normal">—</span>}</span>
    </div>
  )
}

export function UserDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [editState, setEditState] = useState<{ field: 'role' | 'account_status'; value: string } | null>(null)

  const { data: user, isLoading } = useQuery({
    queryKey: ['user_detail', id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_user_for_admin', { p_user_id: id })
      if (error) throw error
      return (data?.[0] ?? null) as UserDetail | null
    },
    enabled: !!id,
  })

  const updateRole = useMutation({
    mutationFn: async (role: string) => {
      const { error } = await supabase.rpc('admin_update_user_role', {
        p_target_user_id: id,
        p_new_role: role,
      })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user_detail', id] })
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      setEditState(null)
    },
  })

  const updateStatus = useMutation({
    mutationFn: async (status: string) => {
      const { error } = await supabase.rpc('admin_update_user_status', {
        p_target_user_id: id,
        p_new_status: status,
      })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user_detail', id] })
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      setEditState(null)
    },
  })

  const handleConfirm = () => {
    if (!editState) return
    if (editState.field === 'role') {
      updateRole.mutate(editState.value)
    } else {
      updateStatus.mutate(editState.value)
    }
  }

  if (isLoading) return <SkeletonPage cards={1} rows={8} />

  if (!user) {
    return (
      <div className="p-8 text-center text-gray-400">
        User not found.
        <button onClick={() => navigate('/admin/users')} className="ml-2 text-blue-600 hover:underline text-sm">
          Back to User Management
        </button>
      </div>
    )
  }

  const formatDate = (iso: string | null) => {
    if (!iso) return null
    return new Date(iso).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' })
  }

  const capitalize = (s: string | null) => s ? s.charAt(0).toUpperCase() + s.slice(1) : null

  return (
    <div>
      <Header
        title={user.full_name}
        subtitle={user.email ?? ''}
        actions={
          <button
            onClick={() => navigate('/admin/users')}
            className="inline-flex items-center gap-1.5 border border-gray-300 rounded-lg px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </button>
        }
      />

      <div className="p-4 sm:p-6 space-y-6">
        {/* Profile card */}
        <Card className="p-6">
          <div className="flex items-start gap-5">
            {/* Avatar */}
            <div className="flex-shrink-0">
              {user.avatar_url ? (
                <img
                  src={user.avatar_url}
                  alt={user.full_name}
                  className="w-20 h-20 rounded-full object-cover border-2 border-gray-200"
                />
              ) : (
                <div className="w-20 h-20 rounded-full bg-gray-100 border-2 border-gray-200 flex items-center justify-center">
                  <svg className="w-10 h-10 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                </div>
              )}
            </div>

            {/* Name + badges */}
            <div className="flex-1 min-w-0">
              <h2 className="text-lg font-bold text-gray-900 leading-tight">{user.full_name}</h2>
              {user.email && <p className="text-sm text-gray-500 mt-0.5">{user.email}</p>}
              <div className="flex flex-wrap items-center gap-2 mt-2">
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${roleColors[user.role]}`}>
                  {user.role}
                </span>
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${statusColors[user.account_status]}`}>
                  {user.account_status}
                </span>
                {!user.profile_completed_at && (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                    Profile Incomplete
                  </span>
                )}
              </div>
            </div>

            {/* Quick actions */}
            <div className="hidden sm:flex flex-col gap-2 flex-shrink-0">
              <button
                onClick={() => setEditState({ field: 'role', value: user.role })}
                className="text-xs text-blue-600 hover:text-blue-800 font-medium border border-blue-200 rounded-lg px-3 py-1.5 hover:bg-blue-50 transition-colors"
              >
                Change Role
              </button>
              <button
                onClick={() => setEditState({ field: 'account_status', value: user.account_status })}
                className="text-xs text-orange-600 hover:text-orange-800 font-medium border border-orange-200 rounded-lg px-3 py-1.5 hover:bg-orange-50 transition-colors"
              >
                Change Status
              </button>
            </div>
          </div>

          {/* Mobile actions */}
          <div className="sm:hidden flex gap-2 mt-4 pt-4 border-t border-gray-100">
            <button
              onClick={() => setEditState({ field: 'role', value: user.role })}
              className="flex-1 text-xs text-center py-2 rounded-lg text-blue-600 hover:bg-blue-50 font-medium border border-blue-200 transition-colors"
            >
              Change Role
            </button>
            <button
              onClick={() => setEditState({ field: 'account_status', value: user.account_status })}
              className="flex-1 text-xs text-center py-2 rounded-lg text-orange-600 hover:bg-orange-50 font-medium border border-orange-200 transition-colors"
            >
              Change Status
            </button>
          </div>
        </Card>

        {/* Personal information */}
        <Card className="p-6">
          <h3 className="text-sm font-semibold text-gray-900 mb-1">Personal Information</h3>
          <p className="text-xs text-gray-400 mb-4">Submitted by the member during profile completion</p>
          <div>
            <InfoRow label="Date of Birth" value={formatDate(user.date_of_birth)} />
            <InfoRow label="Civil Status" value={capitalize(user.civil_status)} />
            <InfoRow label="Home Address" value={user.address} />
          </div>
        </Card>

        {/* Emergency contact */}
        <Card className="p-6">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Emergency Contact</h3>
          <div>
            <InfoRow label="Name" value={user.emergency_contact_name} />
            <InfoRow label="Phone" value={user.emergency_contact_phone} />
          </div>
        </Card>

        {/* Account information */}
        <Card className="p-6">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Account Information</h3>
          <div>
            <InfoRow label="Phone" value={user.phone} />
            {user.employee_id && <InfoRow label="Employee ID" value={user.employee_id} />}
            <InfoRow label="Joined" value={formatDate(user.created_at)} />
            <InfoRow label="Profile Completed" value={user.profile_completed_at ? formatDate(user.profile_completed_at) : <span className="text-yellow-600 font-medium text-xs">Not yet completed</span>} />
          </div>
        </Card>
      </div>

      {/* Edit modal */}
      {editState && (
        <Modal
          isOpen
          title={editState.field === 'role' ? 'Change User Role' : 'Change Account Status'}
          onClose={() => setEditState(null)}
        >
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Updating <span className="font-semibold">{user.full_name}</span>
            </p>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {editState.field === 'role' ? 'New Role' : 'New Status'}
              </label>
              <select
                value={editState.value}
                onChange={e => setEditState({ ...editState, value: e.target.value })}
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
            {editState.field === 'role' && editState.value === 'admin' && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-xs text-yellow-800">
                Warning: Admins have full access including system config and user management.
              </div>
            )}
            {editState.field === 'account_status' && editState.value === 'suspended' && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-800">
                Suspending this account will prevent the user from logging in.
              </div>
            )}
            <div className="flex justify-end gap-3 pt-2">
              <Button variant="secondary" onClick={() => setEditState(null)}>Cancel</Button>
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
