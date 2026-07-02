import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { PageLoader } from '../../components/shared/LoadingSpinner'

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

const EMPLOYEE_API_URL = import.meta.env.DEV
  ? `/api/pos/employees`
  : `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/pos-employees`

function fullName(emp: PosEmployee) {
  return [emp.first_name, emp.middle_name, emp.last_name].filter(Boolean).join(' ')
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

  const linkedMap = new Map<string, CoopProfile>()
  for (const profile of coopProfiles) {
    if (profile.employee_id) linkedMap.set(profile.employee_id, profile)
  }

  const unlinkedProfiles = coopProfiles.filter(p => !p.employee_id)

  const filtered = posEmployees.filter(emp => {
    const name = fullName(emp).toLowerCase()
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

  if (loadingPos || loadingProfiles) return <PageLoader />

  if (posError) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm">
        Failed to load employee list from POS system. Check your API key configuration.
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">
          Employees from the POS system. Employees can join the cooperative by purchasing at least 1 share.
        </p>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
        >
          <svg className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          {isFetching ? 'Refreshing...' : 'Refresh'}
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
                <th className="text-left px-4 py-3 font-medium text-gray-600">Name</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Coop Status</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Membership</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Shares</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center py-10 text-gray-400">No employees found</td>
                </tr>
              )}
              {filtered.map(emp => {
                const profile = linkedMap.get(emp.employee_id)
                const isJoined = !!profile
                return (
                  <tr key={emp.employee_id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-500 font-mono text-xs">{emp.employee_id}</td>
                    <td className="px-4 py-3 font-medium text-gray-900">{fullName(emp)}</td>
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
                      {!isJoined && unlinkedProfiles.length > 0 && (
                        <button
                          onClick={() => { setLinkModal({ employee: emp }); setSelectedProfileId(''); setLinkError(null) }}
                          className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                        >
                          Link Account
                        </button>
                      )}
                      {isJoined && <span className="text-xs text-gray-400">{profile?.full_name}</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {linkModal && (
        <Modal
          isOpen
          title="Link Employee to Cooperative Account"
          onClose={() => { setLinkModal(null); setLinkError(null) }}
        >
          <div className="space-y-4">
            <div className="bg-gray-50 rounded-lg p-3 text-sm">
              <p className="font-medium text-gray-900">{fullName(linkModal.employee)}</p>
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
