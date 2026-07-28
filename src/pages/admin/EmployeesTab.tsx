import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { SkeletonPage } from '../../components/shared/Skeleton'
import { toast } from '../../lib/toast'

interface PosEmployee {
  employee_id: string
  first_name: string
  middle_name: string | null
  last_name: string
}

interface CoopProfile {
  id: string
  full_name: string
  employee_id: string | null
  membership_status: string | null
  completed_shares: number | null
}

interface LinkModalState {
  employee: PosEmployee
}

interface CreateAccountResult {
  employee: PosEmployee
  member_id: string
  password: string
}

const EMPLOYEE_API_URL = import.meta.env.DEV
  ? `/api/pos/employees`
  : `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/pos-employees`

function toTitleCase(str: string) {
  return str.toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
}

function membershipColor(status: string | null) {
  switch (status) {
    case 'active':    return 'bg-green-100 text-green-800'
    case 'pending':   return 'bg-yellow-100 text-yellow-800'
    case 'suspended': return 'bg-red-100 text-red-800'
    case 'inactive':  return 'bg-gray-100 text-gray-500'
    default:          return 'bg-gray-100 text-gray-400'
  }
}

export function EmployeesTab() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'joined' | 'not_joined'>('all')
  const [linkModal, setLinkModal] = useState<LinkModalState | null>(null)
  const [selectedProfileId, setSelectedProfileId] = useState('')
  const [linkError, setLinkError] = useState<string | null>(null)
  const [createAccountEmployee, setCreateAccountEmployee] = useState<PosEmployee | null>(null)
  const [createdAccount, setCreatedAccount] = useState<CreateAccountResult | null>(null)
  const [createAccountError, setCreateAccountError] = useState<string | null>(null)
  const [copied, setCopied] = useState<'id' | 'password' | null>(null)

  const { data: posEmployees = [], isLoading: loadingPos, error: posError, refetch, isFetching } = useQuery({
    queryKey: ['pos-employees'],
    queryFn: async (): Promise<PosEmployee[]> => {
      const headers: Record<string, string> = {}
      if (!import.meta.env.DEV) {
        headers['apikey'] = import.meta.env.VITE_SUPABASE_ANON_KEY
        headers['Authorization'] = `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`
      }
      const res = await fetch(EMPLOYEE_API_URL, { headers })
      if (!res.ok) throw new Error('Failed to fetch employee list')
      return res.json()
    },
    staleTime: 0,
    refetchOnWindowFocus: true,
  })

  const { data: coopProfiles = [], isLoading: loadingProfiles } = useQuery({
    queryKey: ['coop-profiles-for-employees'],
    queryFn: async (): Promise<CoopProfile[]> => {
      const { data, error } = await supabase
        .from('profiles')
        .select(`id, full_name, employee_id, membership_status ( status, completed_shares )`)
      if (error) throw error
      return (data ?? []).map((p: any) => ({
        id: p.id,
        full_name: p.full_name,
        employee_id: p.employee_id,
        membership_status: p.membership_status?.status ?? null,
        completed_shares: p.membership_status?.completed_shares ?? null,
      }))
    },
  })

  const linkEmployee = useMutation({
    mutationFn: async ({ profileId, employeeId }: { profileId: string; employeeId: string }) => {
      const { error } = await supabase.rpc('admin_link_employee', {
        p_profile_id: profileId,
        p_employee_id: employeeId,
      })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['coop-profiles-for-employees'] })
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      setLinkModal(null)
      setSelectedProfileId('')
      setLinkError(null)
    },
    onError: (err: any) => {
      setLinkError(err.message ?? 'Failed to link employee')
    },
  })

  function generatePassword() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$'
    return Array.from({ length: 10 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
  }

  const createAccount = useMutation({
    mutationFn: async ({ employee, password }: { employee: PosEmployee; password: string }) => {
      const { data, error } = await supabase.functions.invoke('create-member', {
        body: {
          first_name: employee.first_name,
          middle_name: employee.middle_name ?? undefined,
          last_name: employee.last_name,
          password,
          provided_employee_id: employee.employee_id,
        },
      })
      if (error) throw error
      if (data?.error) throw new Error(data.error)
      return data as { id: string; member_id: string; full_name: string }
    },
    onSuccess: (_data, { employee, password }) => {
      queryClient.invalidateQueries({ queryKey: ['coop-profiles-for-employees'] })
      setCreatedAccount({ employee, member_id: employee.employee_id, password })
      setCreateAccountEmployee(null)
      setCreateAccountError(null)
    },
    onError: (err: any) => {
      setCreateAccountError(err.message ?? 'Failed to create account')
    },
  })

  function copyToClipboard(text: string, field: 'id' | 'password') {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(field)
      setTimeout(() => setCopied(null), 2000)
    })
  }

  const linkedMap = new Map<string, CoopProfile>()
  for (const profile of coopProfiles) {
    if (profile.employee_id) linkedMap.set(profile.employee_id, profile)
  }

  const unlinkedProfiles = coopProfiles.filter(p => !p.employee_id)

  const filtered = posEmployees.filter(emp => {
    const name = [emp.first_name, emp.middle_name, emp.last_name].filter(Boolean).join(' ').toLowerCase()
    const id = emp.employee_id.toLowerCase()
    const matchesSearch = name.includes(search.toLowerCase()) || id.includes(search.toLowerCase())
    const isJoined = linkedMap.has(emp.employee_id)
    const matchesFilter =
      filter === 'all' ||
      (filter === 'joined' && isJoined) ||
      (filter === 'not_joined' && !isJoined)
    return matchesSearch && matchesFilter
  })

  const joinedCount = posEmployees.filter(e => linkedMap.has(e.employee_id)).length
  const notJoinedCount = posEmployees.length - joinedCount

  if (loadingPos || loadingProfiles) return <SkeletonPage cards={2} rows={6} />

  if (posError) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm">
        Failed to load employee list from POS system. Check your API key configuration.
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-gray-500">
          Employees from the POS system. Employees can join the cooperative by purchasing at least 1 share.
        </p>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex-shrink-0 flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
        >
          <svg className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          <span className="hidden sm:inline">{isFetching ? 'Refreshing...' : 'Refresh'}</span>
        </button>
      </div>

      {/* Summary — bento grid */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="p-3 sm:p-5">
          <p className="text-xs sm:text-sm text-gray-500 truncate">Total Employees</p>
          <p className="text-base sm:text-2xl font-bold text-gray-900 mt-1">{posEmployees.length}</p>
        </Card>
        <Card className="p-3 sm:p-5">
          <p className="text-xs sm:text-sm text-gray-500 truncate">Joined</p>
          <p className="text-base sm:text-2xl font-bold text-green-700 mt-1">{joinedCount}</p>
        </Card>
        <Card className="p-3 sm:p-5">
          <p className="text-xs sm:text-sm text-gray-500 truncate">Not Yet Joined</p>
          <p className="text-base sm:text-2xl font-bold text-yellow-600 mt-1">{notJoinedCount}</p>
        </Card>
      </div>

      {/* Filters */}
      <Card className="p-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            placeholder="Search by name or employee ID..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <div className="flex gap-2">
            {(['all', 'joined', 'not_joined'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  filter === f ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {f === 'all' ? 'All' : f === 'joined' ? 'Joined' : 'Not Joined'}
              </button>
            ))}
          </div>
        </div>
      </Card>

      {/* Table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Employee ID</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">First Name</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Middle Name</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Last Name</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Coop Status</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Membership</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Shares</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center py-10 text-gray-400">No employees found</td>
                </tr>
              )}
              {filtered.map(emp => {
                const profile = linkedMap.get(emp.employee_id)
                const isJoined = !!profile
                return (
                  <tr key={emp.employee_id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-500 font-mono text-xs">{emp.employee_id}</td>
                    <td className="px-4 py-3 font-medium text-gray-900">{toTitleCase(emp.first_name)}</td>
                    <td className="px-4 py-3 text-gray-600">{emp.middle_name ? toTitleCase(emp.middle_name) : <span className="text-gray-300">—</span>}</td>
                    <td className="px-4 py-3 font-medium text-gray-900">{toTitleCase(emp.last_name)}</td>
                    <td className="px-4 py-3">
                      {isJoined ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                          Joined
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">
                          Not Joined
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {profile ? (
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${membershipColor(profile.membership_status)}`}>
                          {profile.membership_status ?? 'pending'}
                        </span>
                      ) : (
                        <span className="text-gray-300 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      {profile ? (profile.completed_shares ?? 0) : <span className="text-gray-300 text-xs">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      {isJoined && <span className="text-xs text-gray-400">{profile?.full_name}</span>}
                      {!isJoined && (
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => {
                              setCreateAccountEmployee(emp)
                              setCreatedAccount(null)
                              setCreateAccountError(null)
                            }}
                            className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                          >
                            Create Account
                          </button>
                          {unlinkedProfiles.length > 0 && (
                            <>
                              <span className="text-gray-300">·</span>
                              <button
                                onClick={() => { setLinkModal({ employee: emp }); setSelectedProfileId(''); setLinkError(null) }}
                                className="text-xs text-gray-500 hover:text-gray-700 font-medium"
                              >
                                Link
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Create Account modal */}
      {createAccountEmployee && !createdAccount && (
        <Modal
          isOpen
          title="Create Account for Employee"
          onClose={() => { setCreateAccountEmployee(null); setCreateAccountError(null) }}
        >
          <div className="space-y-4">
            <div className="bg-gray-50 rounded-lg p-3 text-sm">
              <p className="font-medium text-gray-900">
                {[createAccountEmployee.first_name, createAccountEmployee.middle_name, createAccountEmployee.last_name]
                  .filter(Boolean).map(s => toTitleCase(s as string)).join(' ')}
              </p>
              <p className="text-gray-500 text-xs font-mono mt-0.5">{createAccountEmployee.employee_id}</p>
            </div>
            <p className="text-sm text-gray-600">
              A temporary account will be created. The employee will log in using their <strong>Employee ID</strong> and the password below, then set their own email and a new password.
            </p>
            {createAccountError && (
              <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg p-2">{createAccountError}</p>
            )}
            <div className="flex justify-end gap-3 pt-2">
              <Button variant="secondary" onClick={() => { setCreateAccountEmployee(null); setCreateAccountError(null) }}>
                Cancel
              </Button>
              <Button
                disabled={createAccount.isPending}
                loading={createAccount.isPending}
                onClick={() => {
                  const password = generatePassword()
                  createAccount.mutate({ employee: createAccountEmployee, password })
                }}
              >
                Create Account
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Created Account credentials modal */}
      {createdAccount && (
        <Modal
          isOpen
          title="Account Created"
          onClose={() => { setCreatedAccount(null); setCopied(null) }}
        >
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-green-700 bg-green-50 border border-green-200 rounded-lg p-3">
              <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-sm font-medium">
                Account created for{' '}
                {[createdAccount.employee.first_name, createdAccount.employee.middle_name, createdAccount.employee.last_name]
                  .filter(Boolean).map(s => toTitleCase(s as string)).join(' ')}
              </p>
            </div>
            <p className="text-sm text-gray-600">
              Share these credentials with the employee. They will be asked to set their own email and password on first login.
            </p>
            <div className="space-y-3">
              <div>
                <p className="text-xs font-medium text-gray-500 mb-1">Employee ID (Username)</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 bg-gray-100 rounded-lg px-3 py-2 text-sm font-mono text-gray-900">
                    {createdAccount.member_id}
                  </code>
                  <button
                    onClick={() => copyToClipboard(createdAccount.member_id, 'id')}
                    className="flex-shrink-0 p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors"
                    title="Copy"
                  >
                    {copied === 'id'
                      ? <svg className="w-4 h-4 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                      : <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                    }
                  </button>
                </div>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-500 mb-1">Temporary Password</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 bg-gray-100 rounded-lg px-3 py-2 text-sm font-mono text-gray-900">
                    {createdAccount.password}
                  </code>
                  <button
                    onClick={() => copyToClipboard(createdAccount.password, 'password')}
                    className="flex-shrink-0 p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors"
                    title="Copy"
                  >
                    {copied === 'password'
                      ? <svg className="w-4 h-4 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                      : <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                    }
                  </button>
                </div>
              </div>
            </div>
            <p className="text-xs text-gray-400">These credentials are shown once. Make sure to share them with the employee now.</p>
            <div className="flex justify-end pt-2">
              <Button onClick={() => { setCreatedAccount(null); setCopied(null); toast({ title: 'Done', variant: 'success' }) }}>
                Done
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {linkModal && (
        <Modal
          isOpen
          title="Link Employee to Cooperative Account"
          onClose={() => { setLinkModal(null); setLinkError(null) }}
        >
          <div className="space-y-4">
            <div className="bg-gray-50 rounded-lg p-3 text-sm">
              <p className="font-medium text-gray-900">{[linkModal.employee.first_name, linkModal.employee.middle_name, linkModal.employee.last_name].filter(Boolean).map(s => toTitleCase(s as string)).join(' ')}</p>
              <p className="text-gray-500 text-xs font-mono mt-0.5">{linkModal.employee.employee_id}</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Select cooperative account to link
              </label>
              {unlinkedProfiles.length === 0 ? (
                <p className="text-sm text-gray-500 italic">
                  No unlinked accounts available. The employee must register first.
                </p>
              ) : (
                <select
                  value={selectedProfileId}
                  onChange={e => setSelectedProfileId(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">— Select an account —</option>
                  {unlinkedProfiles.map(p => (
                    <option key={p.id} value={p.id}>{p.full_name}</option>
                  ))}
                </select>
              )}
            </div>
            {linkError && <p className="text-xs text-red-600">{linkError}</p>}
            <div className="flex justify-end gap-3 pt-2">
              <Button variant="secondary" onClick={() => { setLinkModal(null); setLinkError(null) }}>Cancel</Button>
              <Button
                disabled={!selectedProfileId || linkEmployee.isPending}
                onClick={() => linkEmployee.mutate({ profileId: selectedProfileId, employeeId: linkModal.employee.employee_id })}
              >
                {linkEmployee.isPending ? 'Linking...' : 'Link Account'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
