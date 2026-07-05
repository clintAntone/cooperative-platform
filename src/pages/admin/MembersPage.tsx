import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
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

function useApproveMember() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await supabase.rpc('admin_set_membership_status', {
        p_user_id: userId,
        p_status: 'active',
        p_reason: 'Approved by staff',
      })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['members_list'] })
      queryClient.invalidateQueries({ queryKey: ['member_list_report'] })
    },
  })
}

type Tab = 'members' | 'employees'

const PAGE_SIZE = 20

function SortIcon({ active, dir }: { active: boolean; dir: 'asc' | 'desc' }) {
  return (
    <span className={`ml-1 inline-block ${active ? 'text-blue-600' : 'text-gray-300'}`}>
      {dir === 'asc' && active ? '↑' : '↓'}
    </span>
  )
}

interface NonMemberUser {
  id: string
  full_name: string
  email: string | null
  role: string
}

function useNonMemberUsers() {
  return useQuery({
    queryKey: ['non-member-users'],
    queryFn: async (): Promise<NonMemberUser[]> => {
      const { data, error } = await supabase.rpc('get_all_users_for_admin')
      if (error) throw error
      return (data ?? []).filter((u: any) => u.role !== 'member' && u.account_status === 'active')
    },
  })
}

export function MembersPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [activeTab, setActiveTab] = useState<Tab>('members')
  const [sortKey, setSortKey] = useState<'full_name' | 'completed_shares' | 'total_invested' | 'created_at'>('created_at')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [showAddModal, setShowAddModal] = useState(false)
  const [selectedUserId, setSelectedUserId] = useState('')
  const [addError, setAddError] = useState<string | null>(null)
  const [page, setPage] = useState(0)

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
  }, [debouncedSearch, statusFilter, sortKey, sortDir])

  // Server-sortable keys; computed fields (completed_shares, total_invested) sorted client-side
  const serverSortKey = (sortKey === 'full_name' || sortKey === 'created_at') ? sortKey : 'created_at'
  const { data: membersPage, isLoading } = useMembers({
    page,
    pageSize: PAGE_SIZE,
    search: debouncedSearch,
    sortKey: serverSortKey,
    sortDir,
  })
  const members = membersPage?.rows ?? []
  const totalMembers = membersPage?.total ?? 0
  const { format: currency } = useCurrency()

  const { data: nonMembers = [], isLoading: loadingNonMembers } = useNonMemberUsers()
  const approveMember = useApproveMember()
  const bulkUpdateStatus = useBulkUpdateMembershipStatus()
  const [approveError, setApproveError] = useState<string | null>(null)

  const addMember = useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await supabase.rpc('admin_update_user_role', {
        p_target_user_id: userId,
        p_new_role: 'member',
      })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['members'] })
      queryClient.invalidateQueries({ queryKey: ['non-member-users'] })
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      setShowAddModal(false)
      setSelectedUserId('')
      setAddError(null)
    },
    onError: (err: any) => {
      setAddError(err.message ?? 'Failed to add member')
    },
  })

  const handleSort = (key: typeof sortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  // Status filter applied client-side on the server-returned page
  const filtered = members.filter(m => {
    const memberStatus = (m.membership_status as any)?.status ?? 'pending'
    return statusFilter === 'all' || memberStatus === statusFilter
  })

  // Client-side sort only for computed fields; DB fields already sorted by server
  const paged = (sortKey === 'completed_shares' || sortKey === 'total_invested')
    ? [...filtered].sort((a, b) => {
        const dir = sortDir === 'asc' ? 1 : -1
        if (sortKey === 'completed_shares') return (a.completed_shares - b.completed_shares) * dir
        return (a.total_invested - b.total_invested) * dir
      })
    : filtered
  const selectedUser = nonMembers.find(u => u.id === selectedUserId)

  return (
    <div>
      <Header
        title="Members"
        subtitle="View and manage cooperative members"
        actions={
          activeTab === 'members' ? (
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
          ) : undefined
        }
      />

      <div className="p-4 sm:p-6 space-y-6">
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
                {approveError && (
                  <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
                    {approveError}
                  </div>
                )}


                {/* Search + filters + actions */}
                <div className="flex flex-col gap-2">
                  {/* Row 1: search + add member */}
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
                    <Button size="sm" onClick={() => { setShowAddModal(true); setSelectedUserId(''); setAddError(null) }}>
                      <svg className="w-4 h-4 sm:hidden" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                      </svg>
                      <span className="hidden sm:inline">+ Add Member</span>
                    </Button>
                  </div>
                  {/* Row 2: status filter */}
                  <div className="flex gap-2">
                    <select
                      value={statusFilter}
                      onChange={e => setStatusFilter(e.target.value)}
                      className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                    >
                      <option value="all">All Statuses</option>
                      <option value="active">Active</option>
                      <option value="pending">Pending</option>
                      <option value="inactive">Inactive</option>
                      <option value="suspended">Suspended</option>
                    </select>
                  </div>
                </div>

                {/* Members table */}
                  {/* Mobile card list */}
                  <div className="sm:hidden space-y-3">
                    {paged.map(member => {
                      const msStatus = (member.membership_status as any)?.status ?? null
                      const isPending = !msStatus || msStatus === 'pending'
                      return (
                        <div
                          key={member.id}
                          className="bg-white rounded-xl border border-gray-200 px-4 py-3 cursor-pointer active:bg-gray-50"
                          onClick={() => navigate(`/admin/members/${member.id}`)}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="font-medium text-sm text-gray-900 truncate">{member.full_name}</span>
                              {member.role === 'collector' && (
                                <svg className="flex-shrink-0 w-3.5 h-3.5 text-indigo-500" fill="currentColor" viewBox="0 0 24 24">
                                  <title>Collector</title>
                                  <path d="M5 3a2 2 0 00-2 2v16l7-3 7 3V5a2 2 0 00-2-2H5z" />
                                </svg>
                              )}
                            </div>
                            {msStatus ? <StatusBadge status={msStatus} /> : <StatusBadge status="pending" />}
                          </div>
                          {member.employee_id && <p className="font-mono text-xs text-gray-400 mt-0.5">{member.employee_id}</p>}
                          <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-2">
                            <div>
                              <p className="text-xs text-gray-400">Shares</p>
                              <p className="text-xs text-gray-700">{Number(member.completed_shares.toFixed(2))}</p>
                            </div>
                            <div>
                              <p className="text-xs text-gray-400">Invested</p>
                              <p className="text-xs text-gray-700">{currency(member.total_invested)}</p>
                            </div>
                          </div>
                          {isPending && member.completed_shares > 0 && (
                            <button
                              disabled={approveMember.isPending}
                              onClick={e => {
                                e.stopPropagation()
                                setApproveError(null)
                                approveMember.mutate(member.id, {
                                  onError: (err: any) => setApproveError(err.message ?? 'Failed to approve'),
                                })
                              }}
                              className="mt-2 text-xs text-blue-600 hover:text-blue-800 disabled:opacity-50"
                            >
                              Approve Membership
                            </button>
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
                            Name <SortIcon active={sortKey === 'full_name'} dir={sortDir} />
                          </th>
                          <th className="text-left px-4 py-3 font-medium text-gray-600">Employee ID</th>
                          <th className="text-left px-4 py-3 font-medium text-gray-600">Membership Status</th>
                          <th className="text-left px-4 py-3 font-medium text-gray-600 cursor-pointer select-none hover:text-gray-900"
                              onClick={() => handleSort('completed_shares')}>
                            Completed Shares <SortIcon active={sortKey === 'completed_shares'} dir={sortDir} />
                          </th>
                          <th className="text-left px-4 py-3 font-medium text-gray-600 cursor-pointer select-none hover:text-gray-900"
                              onClick={() => handleSort('total_invested')}>
                            Total Invested <SortIcon active={sortKey === 'total_invested'} dir={sortDir} />
                          </th>
                          <th className="text-left px-4 py-3 font-medium text-gray-600 cursor-pointer select-none hover:text-gray-900"
                              onClick={() => handleSort('created_at')}>
                            Joined <SortIcon active={sortKey === 'created_at'} dir={sortDir} />
                          </th>
                          <th className="px-4 py-3" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {totalMembers === 0 && (
                          <tr>
                            <td colSpan={8} className="text-center py-10 text-gray-400">
                              No members found
                            </td>
                          </tr>
                        )}
                        {paged.map(member => {
                          const msStatus = (member.membership_status as any)?.status ?? null
                          const isPending = !msStatus || msStatus === 'pending'
                          return (
                          <tr
                            key={member.id}
                            className="hover:bg-gray-50 cursor-pointer"
                            onClick={() => navigate(`/admin/members/${member.id}`)}
                          >
                            <td className="px-4 py-3 w-10" onClick={e => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                checked={selectedMemberIds.has(member.id)}
                                onChange={() => setSelectedMemberIds(prev => { const s = new Set(prev); s.has(member.id) ? s.delete(member.id) : s.add(member.id); return s })}
                                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                              />
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <p className="font-medium text-gray-900">{member.full_name}</p>
                                {member.role === 'collector' && (
                                  <svg className="flex-shrink-0 w-3.5 h-3.5 text-indigo-500" fill="currentColor" viewBox="0 0 24 24">
                                    <path d="M5 3a2 2 0 00-2 2v16l7-3 7 3V5a2 2 0 00-2-2H5z" />
                                  </svg>
                                )}
                              </div>
                              {member.phone && <p className="text-xs text-gray-400">{member.phone}</p>}
                            </td>
                            <td className="px-4 py-3 text-gray-600">
                              {member.employee_id ?? <span className="text-gray-400">—</span>}
                            </td>
                            <td className="px-4 py-3">
                              {msStatus ? (
                                <StatusBadge status={msStatus} />
                              ) : (
                                <StatusBadge status="pending" />
                              )}
                            </td>
                            <td className="px-4 py-3 text-gray-700">{member.completed_shares}</td>
                            <td className="px-4 py-3 text-gray-700">{currency(member.total_invested)}</td>
                            <td className="px-4 py-3 text-gray-500 text-xs">{formatDate(member.created_at)}</td>
                            <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                              {isPending && (
                                member.completed_shares > 0 ? (
                                  <button
                                    title="Approve membership"
                                    disabled={approveMember.isPending}
                                    onClick={() => {
                                      setApproveError(null)
                                      approveMember.mutate(member.id, {
                                        onError: (err: any) => setApproveError(err.message ?? 'Failed to approve'),
                                      })
                                    }}
                                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-green-700 bg-green-50 hover:bg-green-100 disabled:opacity-50 transition-colors"
                                  >
                                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                                    </svg>
                                    Approve
                                  </button>
                                ) : (
                                  <span className="text-xs text-gray-400" title="Member must complete at least 1 share first">
                                    No completed shares
                                  </span>
                                )
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

      {/* Add Member Modal */}
      <Modal
        isOpen={showAddModal}
        title="Add Member"
        onClose={() => setShowAddModal(false)}
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-500">
            Select a user to assign the member role. They will gain access to the member portal.
          </p>

          {loadingNonMembers ? (
            <p className="text-sm text-gray-400">Loading users...</p>
          ) : nonMembers.length === 0 ? (
            <p className="text-sm text-gray-500 italic">No approved users available. Approve users in Manage Users first.</p>
          ) : (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Select User</label>
              <select
                value={selectedUserId}
                onChange={e => setSelectedUserId(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">— Choose a user —</option>
                {nonMembers.map(u => (
                  <option key={u.id} value={u.id}>
                    {u.full_name}{u.email ? ` (${u.email})` : ''} · {u.role}
                  </option>
                ))}
              </select>
            </div>
          )}

          {selectedUser && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-sm text-blue-800">
              <span className="font-medium">{selectedUser.full_name}</span>'s role will be changed from{' '}
              <span className="font-medium">{selectedUser.role}</span> to <span className="font-medium">member</span>.
            </div>
          )}

          {addError && <p className="text-xs text-red-600">{addError}</p>}

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={() => setShowAddModal(false)}>Cancel</Button>
            <Button
              disabled={!selectedUserId || addMember.isPending}
              loading={addMember.isPending}
              onClick={() => addMember.mutate(selectedUserId)}
            >
              Add as Member
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
