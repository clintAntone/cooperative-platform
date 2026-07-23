import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query'
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
import { useMemberNotes, useAddMemberNote, useDeleteMemberNote } from '../../hooks/useMemberNotes'

type Tab = 'members' | 'employees'

interface CreateMemberForm {
  first_name: string
  middle_name: string
  last_name: string
  email: string
  phone: string
  password: string
}

const PAGE_SIZE = 20

function generatePassword() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  return Array.from({ length: 10 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

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
  const [previewMemberId, setPreviewMemberId] = useState<string | null>(null)
  const [newNote, setNewNote] = useState('')
  const [notesOpen, setNotesOpen] = useState(false)
  const { data: previewNotes = [] } = useMemberNotes(previewMemberId ?? '')
  const addNote = useAddMemberNote(previewMemberId ?? '')
  const deleteNote = useDeleteMemberNote(previewMemberId ?? '')
  const { data: previewProfile } = useQuery({
    queryKey: ['profile_names', previewMemberId],
    queryFn: async () => {
      const { data } = await supabase
        .from('profiles')
        .select('first_name, middle_name, last_name')
        .eq('id', previewMemberId!)
        .single()
      return data as { first_name: string | null; middle_name: string | null; last_name: string | null } | null
    },
    enabled: !!previewMemberId,
    staleTime: 30_000,
  })
  const { data: previewActiveLoans = 0 } = useQuery({
    queryKey: ['preview_loans', previewMemberId],
    queryFn: async () => {
      const { count } = await supabase
        .from('loans')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', previewMemberId!)
        .eq('status', 'active')
      return count ?? 0
    },
    enabled: !!previewMemberId,
    staleTime: 30_000,
  })
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [createForm, setCreateForm] = useState<CreateMemberForm>({ first_name: '', middle_name: '', last_name: '', email: '', phone: '', password: '' })
  const [createResult, setCreateResult] = useState<{ member_id: string; password: string } | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const [emailStatus, setEmailStatus] = useState<'idle' | 'checking' | 'available' | 'taken'>('idle')
  const [nameWarning, setNameWarning] = useState<string | null>(null)
  const emailCheckTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  const EMPLOYEE_API_URL = import.meta.env.DEV
    ? `/api/pos/employees`
    : `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/pos-employees`

  const { data: posEmployees = [] } = useQuery<{ employee_id: string; first_name: string; middle_name: string | null; last_name: string }[]>({
    queryKey: ['pos-employees'],
    queryFn: async () => {
      const headers: Record<string, string> = {}
      if (!import.meta.env.DEV) {
        headers['apikey'] = import.meta.env.VITE_SUPABASE_ANON_KEY
        headers['Authorization'] = `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`
      }
      const res = await fetch(EMPLOYEE_API_URL, { headers })
      if (!res.ok) throw new Error('Failed to fetch employee list')
      return res.json()
    },
    staleTime: 5 * 60_000,
    enabled: showCreateModal,
  })

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

  const checkEmail = (email: string) => {
    if (emailCheckTimeout.current) clearTimeout(emailCheckTimeout.current)
    if (!email || !email.includes('@')) { setEmailStatus('idle'); return }
    setEmailStatus('checking')
    emailCheckTimeout.current = setTimeout(async () => {
      const { data } = await supabase.rpc('is_email_available', { p_email: email })
      setEmailStatus(data === true ? 'available' : 'taken')
    }, 500)
  }

  const checkName = (firstName: string, lastName: string) => {
    if (!firstName.trim() && !lastName.trim()) { setNameWarning(null); return }
    if (posEmployees.length === 0) return
    const fn = firstName.trim().toLowerCase()
    const ln = lastName.trim().toLowerCase()
    const match = posEmployees.find(emp =>
      emp.first_name.toLowerCase() === fn && emp.last_name.toLowerCase() === ln
    )
    if (match) {
      const empFull = [match.first_name, match.middle_name, match.last_name].filter((s): s is string => !!s).map(s => s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase())).join(' ')
      setNameWarning(`"${empFull}" exists in the POS employee list (${match.employee_id}). If this is the same person, use the Employees tab to link their account instead.`)
    } else {
      setNameWarning(null)
    }
  }

  const createMember = useMutation({
    mutationFn: async (form: CreateMemberForm) => {
      const { data: { session } } = await supabase.auth.getSession()
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-member`
      const full_name = [form.first_name, form.middle_name, form.last_name].filter(Boolean).join(' ').trim()
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ full_name, first_name: form.first_name, middle_name: form.middle_name || null, last_name: form.last_name, email: form.email, phone: form.phone, password: form.password }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to create member')
      return json as { id: string; member_id: string }
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['members_list'] })
      setCreateResult({ member_id: data.member_id, password: createForm.password })
      setCreateForm({ first_name: '', middle_name: '', last_name: '', email: '', phone: '', password: '' })
    },
    onError: (err: any) => {
      toast({ title: err.message ?? 'Failed to create member', variant: 'error' })
    },
  })

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
                onClick={() => { setShowCreateModal(true); setCreateResult(null); setCreateForm(f => ({ ...f, password: generatePassword() })) }}
                className="inline-flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-3 py-1.5 text-sm font-medium transition-colors"
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
                          onClick={() => isMember ? setPreviewMemberId(member.id) : undefined}
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
                    <table className="w-full min-w-[780px] text-sm">
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
                          <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap cursor-pointer select-none hover:text-gray-900"
                              onClick={() => handleSort('full_name')}>
                            Name <SortIcon active={sortKey === 'full_name'} dir={sortDir} />
                          </th>
                          <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">Employee ID</th>
                          <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">Role</th>
                          <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">Membership</th>
                          <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap cursor-pointer select-none hover:text-gray-900"
                              onClick={() => handleSort('completed_shares')}>
                            Shares <SortIcon active={sortKey === 'completed_shares'} dir={sortDir} />
                          </th>
                          <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap cursor-pointer select-none hover:text-gray-900"
                              onClick={() => handleSort('total_invested')}>
                            Total Invested <SortIcon active={sortKey === 'total_invested'} dir={sortDir} />
                          </th>
                          <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">Savings</th>
                          <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap cursor-pointer select-none hover:text-gray-900"
                              onClick={() => handleSort('created_at')}>
                            Joined <SortIcon active={sortKey === 'created_at'} dir={sortDir} />
                          </th>
                          <th className="px-4 py-3" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {paged.length === 0 && (
                          <tr>
                            <td colSpan={9} className="text-center py-10 text-gray-400">
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
                            onClick={() => isMember ? setPreviewMemberId(member.id) : undefined}
                          >
                            <td className="px-4 py-3 w-10" onClick={e => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                checked={selectedMemberIds.has(member.id)}
                                onChange={() => setSelectedMemberIds(prev => { const s = new Set(prev); s.has(member.id) ? s.delete(member.id) : s.add(member.id); return s })}
                                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                              />
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap">
                              <p className="font-medium text-gray-900">{member.full_name}</p>
                            </td>
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

      {/* Create Member modal */}
      <Modal
        isOpen={showCreateModal}
        onClose={() => { setShowCreateModal(false); setCreateResult(null); setCreateForm({ first_name: '', middle_name: '', last_name: '', email: '', phone: '', password: '' }); setEmailStatus('idle'); setNameWarning(null) }}
        title="Create Member Account"
        size="sm"
      >
        {createResult ? (
          <div className="space-y-4">
            <div className="flex flex-col items-center gap-3 py-2">
              <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center">
                <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="text-sm font-medium text-gray-900">Member account created</p>
            </div>
            <div className="bg-gray-50 rounded-lg px-4 py-3 space-y-2.5 text-sm">
              <div className="flex justify-between items-center">
                <span className="text-gray-500">Member ID</span>
                <span className="font-mono font-semibold text-gray-900">{createResult.member_id}</span>
              </div>
              <div className="border-t border-gray-200" />
              <div className="flex justify-between items-center">
                <span className="text-gray-500">Temporary Password</span>
                <span className="font-mono font-semibold text-gray-900 tracking-wider">{createResult.password}</span>
              </div>
            </div>
            <p className="text-xs text-gray-500">Share these credentials with the member. They should change the password after their first login.</p>
            <div className="flex justify-end pt-1">
              <Button onClick={() => { setShowCreateModal(false); setCreateResult(null) }}>Done</Button>
            </div>
          </div>
        ) : (
          <form
            onSubmit={e => { e.preventDefault(); createMember.mutate(createForm) }}
            className="space-y-4"
          >
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="block text-sm font-medium text-gray-700">First Name <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  required
                  value={createForm.first_name}
                  onChange={e => { setCreateForm(f => ({ ...f, first_name: e.target.value })); checkName(e.target.value, createForm.last_name) }}
                  placeholder="Juan"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="space-y-1">
                <label className="block text-sm font-medium text-gray-700">Last Name <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  required
                  value={createForm.last_name}
                  onChange={e => { setCreateForm(f => ({ ...f, last_name: e.target.value })); checkName(createForm.first_name, e.target.value) }}
                  placeholder="dela Cruz"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-700">Middle Name <span className="text-gray-400 font-normal">(optional)</span></label>
              <input
                type="text"
                value={createForm.middle_name}
                onChange={e => setCreateForm(f => ({ ...f, middle_name: e.target.value }))}
                placeholder="Santos"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            {nameWarning && (
              <div className="flex items-start gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                <svg className="w-3.5 h-3.5 flex-shrink-0 mt-px" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                </svg>
                <span>{nameWarning}</span>
              </div>
            )}
            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-700">Email <span className="text-red-500">*</span></label>
              <div className="relative">
                <input
                  type="email"
                  required
                  value={createForm.email}
                  onChange={e => { setCreateForm(f => ({ ...f, email: e.target.value })); checkEmail(e.target.value) }}
                  placeholder="member@example.com"
                  className={`w-full border rounded-lg px-3 py-2 pr-8 text-sm focus:outline-none focus:ring-2 ${
                    emailStatus === 'taken' ? 'border-red-400 focus:ring-red-500' :
                    emailStatus === 'available' ? 'border-green-400 focus:ring-green-500' :
                    'border-gray-300 focus:ring-blue-500'
                  }`}
                />
                <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
                  {emailStatus === 'checking' && (
                    <svg className="w-4 h-4 text-gray-400 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                    </svg>
                  )}
                  {emailStatus === 'available' && (
                    <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                  {emailStatus === 'taken' && (
                    <svg className="w-4 h-4 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  )}
                </div>
              </div>
              {emailStatus === 'taken' && (
                <p className="text-xs text-red-600">This email is already registered.</p>
              )}
            </div>
            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-700">Phone <span className="text-gray-400 font-normal">(optional)</span></label>
              <input
                type="tel"
                value={createForm.phone}
                onChange={e => setCreateForm(f => ({ ...f, phone: e.target.value }))}
                placeholder="09XXXXXXXXX"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="block text-sm font-medium text-gray-700">Temporary Password <span className="text-red-500">*</span></label>
                <button
                  type="button"
                  onClick={() => setCreateForm(f => ({ ...f, password: generatePassword() }))}
                  className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                >
                  Regenerate
                </button>
              </div>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  minLength={8}
                  value={createForm.password}
                  onChange={e => setCreateForm(f => ({ ...f, password: e.target.value }))}
                  placeholder="Min. 8 characters"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(v => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showPassword ? (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  )}
                </button>
              </div>
              <p className="text-xs text-gray-400">The member should change this after their first login.</p>
            </div>
            <div className="bg-blue-50 border border-blue-100 rounded-lg px-3 py-2.5 text-xs text-blue-700">
              A member ID (MBR-XXXX) will be automatically assigned. No employee ID required.
            </div>
            <div className="flex justify-end gap-3 pt-1">
              <Button
                type="button"
                variant="secondary"
                onClick={() => { setShowCreateModal(false); setCreateForm({ first_name: '', middle_name: '', last_name: '', email: '', phone: '', password: '' }); setEmailStatus('idle'); setNameWarning(null) }}
              >
                Cancel
              </Button>
              <Button type="submit" loading={createMember.isPending} disabled={emailStatus === 'taken' || emailStatus === 'checking'}>
                Create Member
              </Button>
            </div>
          </form>
        )}
      </Modal>

      {/* Member preview modal */}
      {(() => {
        const member = previewMemberId ? paged.find(m => m.id === previewMemberId) : null
        if (!member) return null
        const msStatus = (member.membership_status as any)?.status ?? null
        const initials = member.full_name?.split(' ').map((n: string) => n[0]).slice(0, 2).join('').toUpperCase()
        return (
          <Modal isOpen={!!previewMemberId} onClose={() => { setPreviewMemberId(null); setNewNote(''); setNotesOpen(false) }} size="sm">
            {/* Avatar + name + badges */}
            <div className="flex items-center gap-3 mb-4">
              <div className="w-11 h-11 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0 text-blue-700 font-bold text-sm">
                {initials}
              </div>
              <div className="min-w-0">
                <p className="font-semibold text-gray-900 leading-snug">{member.full_name}</p>
                {member.employee_id && <p className="text-xs font-mono text-gray-400">{member.employee_id}</p>}
                <div className="flex items-center gap-1.5 mt-1">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize ${ROLE_COLORS[member.role] ?? 'bg-gray-100 text-gray-600'}`}>{member.role}</span>
                  {msStatus && <StatusBadge status={msStatus} />}
                </div>
              </div>
            </div>

            {/* Name breakdown — inline row, only for admin-created members */}
            {(previewProfile?.first_name || previewProfile?.last_name) && (
              <div className="flex gap-x-6 text-sm mb-4 pb-4 border-b border-gray-100">
                <div>
                  <p className="text-xs text-gray-400 leading-none mb-1">First</p>
                  <p className="text-gray-700">{previewProfile.first_name ?? '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 leading-none mb-1">Middle</p>
                  <p className="text-gray-700">{previewProfile.middle_name ?? '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 leading-none mb-1">Last</p>
                  <p className="text-gray-700">{previewProfile.last_name ?? '—'}</p>
                </div>
              </div>
            )}

            {/* Stats — 2×2 grid */}
            <div className="grid grid-cols-2 gap-2 mb-4">
              {[
                { label: 'Shares', value: String(member.completed_shares), color: 'text-gray-900' },
                { label: 'Invested', value: currency(member.total_invested), color: 'text-gray-900' },
                { label: 'Savings', value: member.savings_balance > 0 ? currency(member.savings_balance) : '—', color: 'text-gray-900' },
                {
                  label: 'Loan',
                  value: previewActiveLoans > 0 ? 'Open' : 'None',
                  color: previewActiveLoans > 0 ? 'text-amber-600' : 'text-gray-400',
                },
              ].map(({ label, value, color }) => (
                <div key={label} className="bg-gray-50 rounded-xl px-4 py-3">
                  <p className="text-xs text-gray-400 mb-1">{label}</p>
                  <p className={`text-sm font-semibold ${color}`}>{value}</p>
                </div>
              ))}
            </div>

            {/* View Full Profile */}
            <button
              onClick={() => { setPreviewMemberId(null); setNewNote(''); setNotesOpen(false); navigate(`/admin/members/${member.id}`) }}
              className="w-full text-center text-sm font-medium text-blue-600 hover:text-blue-800 underline underline-offset-2 transition-colors mb-3"
            >
              View Full Profile →
            </button>

            {/* Notes — collapsible */}
            <div className="border-t border-gray-100 pt-3">
              <button
                onClick={() => setNotesOpen(o => !o)}
                className="w-full flex items-center justify-between text-left py-0.5"
              >
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Notes{previewNotes.length > 0 && <span className="ml-1 text-blue-500">({previewNotes.length})</span>}
                </span>
                <svg className={`w-3.5 h-3.5 text-gray-400 transition-transform duration-200 ${notesOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {notesOpen && (
                <div className="mt-2.5 space-y-2">
                  {previewNotes.length === 0 ? (
                    <p className="text-xs text-gray-400 italic">No notes yet.</p>
                  ) : (
                    <div className="space-y-1.5 max-h-36 overflow-y-auto">
                      {previewNotes.map(n => (
                        <div key={n.id} className="flex items-start gap-2 rounded-lg bg-gray-50 px-3 py-2">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-gray-800">{n.note}</p>
                            <p className="text-xs text-gray-400 mt-0.5">{n.author_name} · {formatDate(n.created_at)}</p>
                          </div>
                          <button onClick={() => deleteNote.mutate(n.id)} className="flex-shrink-0 p-0.5 text-gray-300 hover:text-red-500 transition-colors mt-0.5">
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newNote}
                      onChange={e => setNewNote(e.target.value)}
                      placeholder="Add a note…"
                      className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      onKeyDown={e => { if (e.key === 'Enter' && newNote.trim()) addNote.mutate(newNote.trim(), { onSuccess: () => setNewNote('') }) }}
                    />
                    <button
                      disabled={!newNote.trim() || addNote.isPending}
                      onClick={() => addNote.mutate(newNote.trim(), { onSuccess: () => setNewNote('') })}
                      className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-40 transition-colors"
                    >
                      Save
                    </button>
                  </div>
                </div>
              )}
            </div>
          </Modal>
        )
      })()}

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
