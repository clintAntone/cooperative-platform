import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Header } from '../../components/layout/Header'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { StatusBadge } from '../../components/shared/StatusBadge'
import { SkeletonPage } from '../../components/shared/Skeleton'
import { Pagination } from '../../components/shared/Pagination'
import { useMembers, useBulkUpdateMembershipStatus } from '../../hooks/useMembers'
import { useCurrency } from '../../hooks/useCurrency'
import { formatDate } from '../../lib/utils'
import { supabase } from '../../lib/supabase'
import { EmployeesTab } from './EmployeesTab'
import { exportToExcel } from '../../lib/exportExcel'
import { PageGuide } from '../../components/shared/PageGuide'
import { toast } from '../../lib/toast'

type Tab = 'members' | 'employees'

const PAGE_SIZE = 20

const ROLE_COLORS: Record<string, string> = {
  admin:  'bg-purple-100 text-purple-700',
  staff:  'bg-blue-100 text-blue-700',
  member: 'bg-gray-100 text-gray-600',
  board:  'bg-amber-100 text-amber-700',
}

function SortIcon({ active, dir }: { active: boolean; dir: 'asc' | 'desc' }) {
  return (
    <span className={`ml-1 inline-block ${active ? 'text-blue-600' : 'text-gray-300'}`}>
      {dir === 'asc' && active ? '↑' : '↓'}
    </span>
  )
}

export function MembersPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('all')
  const [activeTab, setActiveTab] = useState<Tab>('members')
  const [sortKey, setSortKey] = useState<'full_name' | 'completed_shares' | 'total_invested' | 'created_at'>('created_at')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [page, setPage] = useState(0)
  const [acceptingId, setAcceptingId] = useState<string | null>(null)

  // Create member modal
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [createForm, setCreateForm] = useState({ first_name: '', middle_name: '', last_name: '', email: '' })
  const [createPassword, setCreatePassword] = useState('')
  const [emailAvailable, setEmailAvailable] = useState<boolean | null>(null)
  const [emailChecking, setEmailChecking] = useState(false)
  const [createdMember, setCreatedMember] = useState<{ full_name: string; member_id: string; email: string; password: string } | null>(null)

  // Bulk selection
  const [selectedMemberIds, setSelectedMemberIds] = useState<Set<string>>(new Set())
  const [showBulkModal, setShowBulkModal] = useState<'activate' | 'suspend' | null>(null)
  const [bulkReason, setBulkReason] = useState('')

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(timer)
  }, [search])

  useEffect(() => {
    setPage(0)
    setSelectedMemberIds(new Set())
  }, [debouncedSearch, roleFilter, sortKey, sortDir])

  const serverSortKey = (sortKey === 'full_name' || sortKey === 'created_at') ? sortKey : 'created_at'
  const { data: membersPage, isLoading } = useMembers({
    page,
    pageSize: PAGE_SIZE,
    search: debouncedSearch,
    sortKey: serverSortKey,
    sortDir,
    allRoles: true,
  })
  const members = membersPage?.rows ?? []
  const totalMembers = membersPage?.total ?? 0
  const { format: currency } = useCurrency()
  const bulkUpdateStatus = useBulkUpdateMembershipStatus()

  const acceptMember = useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await supabase.rpc('admin_update_user_role', {
        p_target_user_id: userId,
        p_new_role: 'member',
      })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['members_list'] })
      toast({ title: 'User accepted as member. An equity share has been opened for them.', variant: 'success' })
      setAcceptingId(null)
    },
    onError: (err: any) => {
      toast({ title: err.message ?? 'Failed to accept user', variant: 'error' })
      setAcceptingId(null)
    },
  })

  function generatePassword() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$'
    return Array.from({ length: 10 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
  }

  const createMember = useMutation({
    mutationFn: async (payload: { first_name: string; middle_name: string; last_name: string; email: string; password: string }) => {
      const { data, error } = await supabase.functions.invoke('create-member', { body: payload })
      if (error) throw error
      if (data?.error) throw new Error(data.error)
      return data as { id: string; member_id: string; full_name: string }
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['members_list'] })
      setCreatedMember({ full_name: data.full_name, member_id: data.member_id, email: createForm.email, password: createPassword })
      setCreateForm({ first_name: '', middle_name: '', last_name: '', email: '' })
      setEmailAvailable(null)
    },
    onError: (err: any) => {
      toast({ title: err.message ?? 'Failed to create member', variant: 'error' })
    },
  })

  async function checkEmail(email: string) {
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setEmailAvailable(null); return }
    setEmailChecking(true)
    try {
      const { data } = await supabase.rpc('is_email_available', { p_email: email })
      setEmailAvailable(data ?? null)
    } finally {
      setEmailChecking(false)
    }
  }

  const handleSort = (key: typeof sortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  // Client-side role filter
  const filtered = members.filter(m => roleFilter === 'all' || m.role === roleFilter)

  // Client-side sort for computed fields
  const paged = (sortKey === 'completed_shares' || sortKey === 'total_invested')
    ? [...filtered].sort((a, b) => {
        const dir = sortDir === 'asc' ? 1 : -1
        if (sortKey === 'completed_shares') return (a.completed_shares - b.completed_shares) * dir
        return (a.total_invested - b.total_invested) * dir
      })
    : filtered

  return (
    <div>
      <Header
        title="Members"
        subtitle="View and manage cooperative members"
        actions={
          activeTab === 'members' ? (
            <div className="flex items-center gap-2">
              <button
                onClick={() => { const pw = generatePassword(); setCreatePassword(pw); setShowCreateModal(true); setCreatedMember(null); setCreateForm({ first_name: '', middle_name: '', last_name: '', email: '' }); setEmailAvailable(null) }}
                className="inline-flex items-center gap-1.5 bg-blue-600 text-white rounded-lg px-3 py-1.5 text-sm font-medium hover:bg-blue-700 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                <span className="hidden sm:inline">Create Member</span>
              </button>
              <button
                onClick={() => {
                  const rows = filtered.map(m => ({
                  Name: m.full_name,
                  'Employee ID': m.employee_id ?? '',
                  'Membership Status': (m.membership_status as any)?.status ?? 'pending',
                  'Completed Shares': m.completed_shares,
                  'Total Invested': m.total_invested,
                  Joined: m.created_at,
                }))
                exportToExcel(rows, 'members')
              }}
              title="Export to Excel"
              className="inline-flex items-center gap-1.5 border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" />
              </svg>
              <span className="hidden sm:inline">Export</span>
              </button>
            </div>
          ) : undefined
        }
      />

      <div className="p-4 sm:p-6 space-y-6">
        <PageGuide
          storageKey="members"
          steps={[
            'Members are registered users who have been accepted via Manage Users and assigned the member role.',
            'A member is considered Pending until they complete paying their first equity share.',
            'Suspend a member to temporarily block access without deleting their data.',
            'Use the search box to find a member by name or Employee ID. Click a row to see full member details.',
          ]}
          note="Only admin and staff can approve or suspend members. Rejected registrations cannot re-apply without a new account."
        />
        {/* Tabs */}
        <div className="border-b border-gray-200">
          <nav className="-mb-px flex gap-6">
            {([
              { key: 'members', label: 'Members' },
              { key: 'employees', label: 'Employees' },
            ] as { key: Tab; label: string }[]).map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab.key
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {activeTab === 'members' && (
          <>
            {isLoading ? (
              <SkeletonPage cards={3} rows={6} />
            ) : (
              <>
                {/* Search + role filter */}
                <div className="flex gap-2">
                  <div className="relative flex-1 min-w-0">
                    <input
                      type="text"
                      placeholder="Search by name or employee ID..."
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg pl-3 pr-8 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    {search && (
                      <button
                        onClick={() => setSearch('')}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
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
                    <option value="member">Members</option>
                    <option value="staff">Staff</option>
                    <option value="board">Board</option>
                  </select>
                </div>

                {/* Members table */}
                  {/* Mobile card list */}
                  <div className="sm:hidden space-y-3">
                    {paged.map(member => {
                      const msStatus = (member.membership_status as any)?.status ?? null
                      const isMember = member.role === 'member'
                      return (
                        <div
                          key={member.id}
                          className="bg-white rounded-xl border border-gray-200 px-4 py-3 cursor-pointer active:bg-gray-50"
                          onClick={() => isMember ? navigate(`/admin/members/${member.id}`) : undefined}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium text-sm text-gray-900 truncate">{member.full_name}</span>
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize ${ROLE_COLORS[member.role] ?? 'bg-gray-100 text-gray-600'}`}>
                              {member.role}
                            </span>
                          </div>
                          {member.employee_id && <p className="font-mono text-xs text-gray-400 mt-0.5">{member.employee_id}</p>}
                          {isMember ? (
                            <div className="grid grid-cols-3 gap-x-4 gap-y-1 mt-2">
                              <div>
                                <p className="text-xs text-gray-400">Membership</p>
                                {msStatus ? <StatusBadge status={msStatus} /> : <StatusBadge status="pending" />}
                              </div>
                              <div>
                                <p className="text-xs text-gray-400">Invested</p>
                                <p className="text-xs text-gray-700">{currency(member.total_invested)}</p>
                              </div>
                              <div>
                                <p className="text-xs text-gray-400">Savings</p>
                                <p className="text-xs text-gray-700">{member.savings_balance > 0 ? currency(member.savings_balance) : '—'}</p>
                              </div>
                            </div>
                          ) : (
                            <div className="mt-2">
                              <button
                                onClick={e => { e.stopPropagation(); setAcceptingId(member.id) }}
                                className="text-xs font-medium text-green-700 bg-green-50 border border-green-200 px-2.5 py-1 rounded-lg hover:bg-green-100 transition-colors"
                              >
                                Accept as Member
                              </button>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                  {/* Desktop table */}
                  <Card className="hidden sm:block overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 border-b border-gray-200">
                        <tr>
                          <th className="px-4 py-3 w-10">
                            <input
                              type="checkbox"
                              checked={paged.length > 0 && paged.every(m => selectedMemberIds.has(m.id))}
                              onChange={() => {
                                if (paged.every(m => selectedMemberIds.has(m.id))) {
                                  setSelectedMemberIds(prev => { const s = new Set(prev); paged.forEach(m => s.delete(m.id)); return s })
                                } else {
                                  setSelectedMemberIds(prev => { const s = new Set(prev); paged.forEach(m => s.add(m.id)); return s })
                                }
                              }}
                              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                            />
                          </th>
                          <th className="text-left px-4 py-3 font-medium text-gray-600 cursor-pointer select-none hover:text-gray-900"
                              onClick={() => handleSort('full_name')}>
                            First Name <SortIcon active={sortKey === 'full_name'} dir={sortDir} />
                          </th>
                          <th className="text-left px-4 py-3 font-medium text-gray-600">Middle Name</th>
                          <th className="text-left px-4 py-3 font-medium text-gray-600">Last Name</th>
                          <th className="text-left px-4 py-3 font-medium text-gray-600">Employee ID</th>
                          <th className="text-left px-4 py-3 font-medium text-gray-600">Role</th>
                          <th className="text-left px-4 py-3 font-medium text-gray-600">Membership</th>
                          <th className="text-left px-4 py-3 font-medium text-gray-600 cursor-pointer select-none hover:text-gray-900"
                              onClick={() => handleSort('completed_shares')}>
                            Shares <SortIcon active={sortKey === 'completed_shares'} dir={sortDir} />
                          </th>
                          <th className="text-left px-4 py-3 font-medium text-gray-600 cursor-pointer select-none hover:text-gray-900"
                              onClick={() => handleSort('total_invested')}>
                            Total Invested <SortIcon active={sortKey === 'total_invested'} dir={sortDir} />
                          </th>
                          <th className="text-left px-4 py-3 font-medium text-gray-600">Savings</th>
                          <th className="text-left px-4 py-3 font-medium text-gray-600 cursor-pointer select-none hover:text-gray-900"
                              onClick={() => handleSort('created_at')}>
                            Joined <SortIcon active={sortKey === 'created_at'} dir={sortDir} />
                          </th>
                          <th className="px-4 py-3" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {paged.length === 0 && (
                          <tr>
                            <td colSpan={11} className="text-center py-10 text-gray-400">
                              No users found
                            </td>
                          </tr>
                        )}
                        {paged.map(member => {
                          const msStatus = (member.membership_status as any)?.status ?? null
                          const isMember = member.role === 'member'
                          return (
                          <tr
                            key={member.id}
                            className={`hover:bg-gray-50 ${isMember ? 'cursor-pointer' : ''}`}
                            onClick={() => isMember ? navigate(`/admin/members/${member.id}`) : undefined}
                          >
                            <td className="px-4 py-3 w-10" onClick={e => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                checked={selectedMemberIds.has(member.id)}
                                onChange={() => setSelectedMemberIds(prev => { const s = new Set(prev); s.has(member.id) ? s.delete(member.id) : s.add(member.id); return s })}
                                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                              />
                            </td>
                            <td className="px-4 py-3 font-medium text-gray-900">{member.first_name ?? member.full_name}</td>
                            <td className="px-4 py-3 text-gray-600">{member.middle_name ?? <span className="text-gray-300">—</span>}</td>
                            <td className="px-4 py-3 font-medium text-gray-900">{member.last_name ?? <span className="text-gray-300">—</span>}</td>
                            <td className="px-4 py-3 font-mono text-xs text-gray-600">
                              {member.employee_id ?? <span className="text-gray-400">—</span>}
                            </td>
                            <td className="px-4 py-3">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize ${ROLE_COLORS[member.role] ?? 'bg-gray-100 text-gray-600'}`}>
                                {member.role}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              {isMember
                                ? msStatus ? <StatusBadge status={msStatus} /> : <StatusBadge status="pending" />
                                : <span className="text-gray-400 text-xs">—</span>
                              }
                            </td>
                            <td className="px-4 py-3 text-gray-700">{isMember ? member.completed_shares : <span className="text-gray-400">—</span>}</td>
                            <td className="px-4 py-3 text-gray-700">{isMember ? currency(member.total_invested) : <span className="text-gray-400">—</span>}</td>
                            <td className="px-4 py-3 text-gray-700">
                              {isMember && member.savings_balance > 0 ? currency(member.savings_balance) : <span className="text-gray-400">—</span>}
                            </td>
                            <td className="px-4 py-3 text-gray-500 text-xs">{formatDate(member.created_at)}</td>
                            <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                              {!isMember && (
                                <button
                                  onClick={() => setAcceptingId(member.id)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-green-700 bg-green-50 hover:bg-green-100 border border-green-200 transition-colors whitespace-nowrap"
                                >
                                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                  </svg>
                                  Accept
                                </button>
                              )}
                            </td>
                          </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </Card>
                  <Pagination
                    page={page}
                    pageSize={PAGE_SIZE}
                    total={totalMembers}
                    onChange={setPage}
                  />
              </>
            )}
          </>
        )}

        {activeTab === 'employees' && <EmployeesTab />}
      </div>

      {/* Bulk action bar — fixed at bottom, only visible when items are selected */}
      {selectedMemberIds.size > 0 && (() => {
        const selected = members.filter(m => selectedMemberIds.has(m.id))
        const allActive = selected.every(m => m.membership_status?.status === 'active')
        const allSuspended = selected.every(m => m.membership_status?.status === 'suspended')
        return (
          <div className="fixed bottom-0 left-0 right-0 z-50 flex items-center gap-3 bg-white border-t border-gray-200 shadow-lg px-4 py-3 lg:left-64">
            <span className="text-sm font-medium text-gray-700">{selectedMemberIds.size} selected</span>
            <div className="flex gap-2 ml-auto">
              {!allActive && (
                <Button size="sm" variant="primary" onClick={() => { setShowBulkModal('activate'); setBulkReason('') }}>
                  Activate Selected
                </Button>
              )}
              {!allSuspended && (
                <Button size="sm" variant="danger" onClick={() => { setShowBulkModal('suspend'); setBulkReason('') }}>
                  Suspend Selected
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => setSelectedMemberIds(new Set())}>
                Clear
              </Button>
            </div>
          </div>
        )
      })()}

      {/* Bulk Activate/Suspend Modal */}
      <Modal
        isOpen={!!showBulkModal}
        onClose={() => setShowBulkModal(null)}
        title={showBulkModal === 'activate' ? `Activate ${selectedMemberIds.size} Member${selectedMemberIds.size > 1 ? 's' : ''}` : `Suspend ${selectedMemberIds.size} Member${selectedMemberIds.size > 1 ? 's' : ''}`}
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            {showBulkModal === 'activate'
              ? 'This will activate membership for all selected members.'
              : 'This will suspend membership for all selected members. They will lose access to member features.'}
          </p>
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-gray-700">Reason (optional)</label>
            <textarea
              value={bulkReason}
              onChange={e => setBulkReason(e.target.value)}
              placeholder={showBulkModal === 'activate' ? 'Approved by admin' : 'Reason for suspension...'}
              rows={2}
              className="block w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="flex gap-3 pt-1">
            <Button variant="outline" className="flex-1" onClick={() => setShowBulkModal(null)}>Cancel</Button>
            <Button
              variant={showBulkModal === 'activate' ? 'primary' : 'danger'}
              className="flex-1"
              loading={bulkUpdateStatus.isPending}
              onClick={() => {
                bulkUpdateStatus.mutate(
                  {
                    userIds: [...selectedMemberIds],
                    status: showBulkModal === 'activate' ? 'active' : 'suspended',
                    reason: bulkReason || (showBulkModal === 'activate' ? 'Approved by admin' : 'Suspended by admin'),
                  },
                  {
                    onSuccess: () => {
                      setSelectedMemberIds(new Set())
                      setShowBulkModal(null)
                    },
                  }
                )
              }}
            >
              Confirm
            </Button>
          </div>
        </div>
      </Modal>

      {/* Create Member Modal */}
      <Modal
        isOpen={showCreateModal}
        onClose={() => { setShowCreateModal(false); setCreatedMember(null) }}
        title="Create Member Account"
        size="sm"
      >
        {createdMember ? (
          <div className="space-y-4">
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-center">
              <svg className="w-8 h-8 text-green-600 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="font-semibold text-green-800">Member created successfully</p>
              <p className="text-sm text-green-700 mt-0.5">{createdMember.full_name}</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3 space-y-2 text-sm">
              <div className="flex justify-between gap-2">
                <span className="text-gray-500">Employee ID</span>
                <span className="font-mono font-medium text-gray-900">{createdMember.member_id}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-gray-500">Email</span>
                <span className="font-medium text-gray-900">{createdMember.email}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-gray-500">Password</span>
                <span className="font-mono font-medium text-gray-900 select-all">{createdMember.password}</span>
              </div>
            </div>
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              Share these credentials with the member. The password will not be shown again.
            </p>
            <div className="flex justify-end gap-3 pt-1">
              <Button onClick={() => { setShowCreateModal(false); setCreatedMember(null) }}>Done</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="block text-sm font-medium text-gray-700">First Name <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={createForm.first_name}
                  onChange={e => setCreateForm(f => ({ ...f, first_name: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Juan"
                />
              </div>
              <div className="space-y-1">
                <label className="block text-sm font-medium text-gray-700">Last Name <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={createForm.last_name}
                  onChange={e => setCreateForm(f => ({ ...f, last_name: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="dela Cruz"
                />
              </div>
            </div>
            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-700">Middle Name <span className="text-gray-400 text-xs">(optional)</span></label>
              <input
                type="text"
                value={createForm.middle_name}
                onChange={e => setCreateForm(f => ({ ...f, middle_name: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Santos"
              />
            </div>
            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-700">Email <span className="text-red-500">*</span></label>
              <input
                type="email"
                value={createForm.email}
                onChange={e => {
                  const val = e.target.value
                  setCreateForm(f => ({ ...f, email: val }))
                  setEmailAvailable(null)
                  clearTimeout((window as any).__emailCheckTimer)
                  ;(window as any).__emailCheckTimer = setTimeout(() => checkEmail(val), 500)
                }}
                className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                  emailAvailable === false ? 'border-red-400' : emailAvailable === true ? 'border-green-400' : 'border-gray-300'
                }`}
                placeholder="juan@example.com"
              />
              {emailChecking && <p className="text-xs text-gray-400">Checking availability...</p>}
              {emailAvailable === false && <p className="text-xs text-red-600">This email is already registered.</p>}
              {emailAvailable === true && <p className="text-xs text-green-600">Email is available.</p>}
            </div>
            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-700">Auto-generated Password</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  readOnly
                  value={createPassword}
                  className="flex-1 border border-gray-200 bg-gray-50 rounded-lg px-3 py-2 text-sm font-mono text-gray-700 select-all"
                />
                <button
                  type="button"
                  onClick={() => setCreatePassword(generatePassword())}
                  className="px-3 py-2 text-xs border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-600 transition-colors"
                >
                  Regenerate
                </button>
              </div>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <Button variant="secondary" onClick={() => setShowCreateModal(false)}>Cancel</Button>
              <Button
                loading={createMember.isPending}
                disabled={!createForm.first_name || !createForm.last_name || !createForm.email || emailAvailable === false || emailChecking}
                onClick={() => createMember.mutate({ ...createForm, password: createPassword })}
              >
                Create Member
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Accept as Member confirmation modal */}
      {acceptingId && (() => {
        const user = paged.find(m => m.id === acceptingId)
        return (
          <Modal isOpen={!!acceptingId} onClose={() => setAcceptingId(null)} title="Accept as Member" size="sm">
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                Accept <span className="font-semibold">{user?.full_name}</span> as a cooperative member?
              </p>
              <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2.5 text-sm text-blue-800 space-y-1">
                <p>Their role will be changed to <strong>Member</strong>.</p>
                <p>An empty equity share will be automatically opened for them.</p>
              </div>
              <div className="flex justify-end gap-3 pt-1">
                <Button variant="secondary" onClick={() => setAcceptingId(null)}>Cancel</Button>
                <Button
                  loading={acceptMember.isPending}
                  onClick={() => acceptMember.mutate(acceptingId)}
                >
                  Confirm
                </Button>
              </div>
            </div>
          </Modal>
        )
      })()}
    </div>
  )
}
