import { useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { useCurrency } from '../../hooks/useCurrency'
import { Header } from '../../components/layout/Header'
import { toast } from '../../lib/toast'

// ─── Types ────────────────────────────────────────────────────────────────────

interface MemberEntry {
  user_id: string
  full_name: string
  employee_id: string | null
  has_completed_share: boolean
  // form fields
  amount: string
  destination: 'shares' | 'savings'
  date: string
  reference: string
  include: boolean
}

// ─── Fetch members with share info ────────────────────────────────────────────

function useMembersForPosting() {
  return useQuery({
    queryKey: ['members_for_posting'],
    staleTime: 30_000,
    queryFn: async () => {
      const { data: profiles, error } = await supabase
        .from('profiles')
        .select('id, full_name, employee_id')
        .eq('role', 'member')
        .eq('account_status', 'active')
        .order('full_name', { ascending: true })

      if (error) throw error

      const ids = (profiles ?? []).map(p => p.id)
      if (ids.length === 0) return []

      const { data: shares } = await supabase
        .from('equity_shares')
        .select('user_id, status')
        .in('user_id', ids)
        .eq('status', 'completed')

      const completedSet = new Set((shares ?? []).map(s => s.user_id))

      return (profiles ?? []).map(p => ({
        user_id: p.id,
        full_name: p.full_name,
        employee_id: p.employee_id,
        has_completed_share: completedSet.has(p.id),
      }))
    },
  })
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function WeeklyPostingPage() {
  const { user } = useAuth()
  const { format: currency } = useCurrency()
  const queryClient = useQueryClient()
  const { data: members = [], isLoading } = useMembersForPosting()

  const today = new Date().toISOString().split('T')[0]

  // Build initial entry rows from members
  const [entries, setEntries] = useState<MemberEntry[]>([])
  const [initialized, setInitialized] = useState(false)
  const [posting, setPosting] = useState(false)
  const [result, setResult] = useState<{ ok: number; failed: number; names: string[] } | null>(null)
  const [search, setSearch] = useState('')

  // Initialize entries once members load
  if (!initialized && members.length > 0) {
    setEntries(members.map(m => ({
      ...m,
      amount: '',
      destination: 'shares',
      date: today,
      reference: '',
      include: false,
    })))
    setInitialized(true)
  }

  const updateEntry = (userId: string, patch: Partial<MemberEntry>) => {
    setEntries(prev => prev.map(e => e.user_id === userId ? { ...e, ...patch } : e))
  }

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return entries.filter(e =>
      e.full_name.toLowerCase().includes(q) ||
      (e.employee_id ?? '').toLowerCase().includes(q)
    )
  }, [entries, search])

  const selected = entries.filter(e => e.include && e.amount && parseFloat(e.amount) > 0)

  const handlePost = async () => {
    if (selected.length === 0) return
    setPosting(true)
    setResult(null)

    let ok = 0
    let failed = 0
    const failedNames: string[] = []

    for (const entry of selected) {
      const { error } = await supabase.rpc('staff_post_deposit' as any, {
        p_user_id: entry.user_id,
        p_amount: parseFloat(entry.amount),
        p_destination: entry.destination,
        p_date: new Date(entry.date).toISOString(),
        p_reference: entry.reference || null,
        p_recorded_by: user!.id,
      })

      if (error) {
        failed++
        failedNames.push(entry.full_name)
        console.error(`Failed for ${entry.full_name}:`, error)
      } else {
        ok++
      }
    }

    setPosting(false)
    setResult({ ok, failed, names: failedNames })

    if (ok > 0) {
      toast({ title: `${ok} deposit${ok > 1 ? 's' : ''} posted successfully`, variant: 'success' })
      queryClient.invalidateQueries({ queryKey: ['equity_shares'] })
      queryClient.invalidateQueries({ queryKey: ['savings_account'] })
      // Clear posted entries
      setEntries(prev => prev.map(e =>
        selected.find(s => s.user_id === e.user_id)
          ? { ...e, amount: '', reference: '', include: false, date: today }
          : e
      ))
    }
    if (failed > 0) {
      toast({ title: `${failed} deposit${failed > 1 ? 's' : ''} failed`, variant: 'error' })
    }
  }

  const totalAmount = selected.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0)

  return (
    <div>
      <Header
        title="Post Deposits"
        subtitle="Record deposits from member deposit slips"
      />

      <div className="p-4 sm:p-6 space-y-4">
        {/* Info banner */}
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex gap-3">
          <svg className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div className="text-sm text-blue-800">
            <p className="font-medium">How to use</p>
            <p className="text-blue-700 mt-0.5">Check the box next to each member who submitted a slip this week. Enter the amount and slip reference, then click Post.</p>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Search member…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Summary bar */}
        {selected.length > 0 && (
          <div className="bg-gray-900 rounded-xl px-4 py-3 flex items-center justify-between">
            <div className="text-white">
              <span className="text-sm font-medium">{selected.length} member{selected.length > 1 ? 's' : ''} selected</span>
              <span className="text-gray-400 text-sm ml-2">· Total: {currency(totalAmount)}</span>
            </div>
            <button
              onClick={handlePost}
              disabled={posting}
              className="px-4 py-1.5 bg-blue-500 hover:bg-blue-400 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
            >
              {posting ? 'Posting…' : 'Post All'}
            </button>
          </div>
        )}

        {/* Result */}
        {result && (
          <div className={`rounded-xl px-4 py-3 text-sm ${result.failed > 0 ? 'bg-red-50 text-red-700 border border-red-100' : 'bg-green-50 text-green-700 border border-green-100'}`}>
            {result.ok > 0 && <p>{result.ok} deposit{result.ok > 1 ? 's' : ''} posted successfully.</p>}
            {result.failed > 0 && <p>{result.failed} failed: {result.names.join(', ')}</p>}
          </div>
        )}

        {/* Member list */}
        {isLoading ? (
          <div className="py-12 text-center text-sm text-gray-400">Loading members…</div>
        ) : (
          <div className="bg-white rounded-2xl border border-gray-100 divide-y divide-gray-50 overflow-hidden">
            {filtered.length === 0 && (
              <div className="py-10 text-center text-sm text-gray-400">No members found</div>
            )}
            {filtered.map(entry => (
              <div
                key={entry.user_id}
                className={`px-4 py-3 transition-colors ${entry.include ? 'bg-blue-50/60' : 'hover:bg-gray-50'}`}
              >
                {/* Top row: checkbox + name + destination toggle */}
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={entry.include}
                    onChange={e => updateEntry(entry.user_id, { include: e.target.checked })}
                    className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 flex-shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{entry.full_name}</p>
                    {entry.employee_id && (
                      <p className="text-xs text-gray-400">{entry.employee_id}</p>
                    )}
                  </div>
                  {/* Destination toggle — savings only available if completed share */}
                  <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
                    <button
                      onClick={() => updateEntry(entry.user_id, { destination: 'shares' })}
                      className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                        entry.destination === 'shares' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
                      }`}
                    >
                      Shares
                    </button>
                    <button
                      onClick={() => {
                        if (!entry.has_completed_share) return
                        updateEntry(entry.user_id, { destination: 'savings' })
                      }}
                      title={!entry.has_completed_share ? 'No completed share — cannot post to savings' : ''}
                      className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                        entry.destination === 'savings' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
                      } ${!entry.has_completed_share ? 'opacity-40 cursor-not-allowed' : ''}`}
                    >
                      Savings
                    </button>
                  </div>
                </div>

                {/* Expanded fields when checked */}
                {entry.include && (
                  <div className="mt-3 ml-7 grid grid-cols-3 gap-2">
                    <div>
                      <label className="text-xs text-gray-500 mb-1 block">Amount</label>
                      <input
                        type="number"
                        min="1"
                        placeholder="0.00"
                        value={entry.amount}
                        onChange={e => updateEntry(entry.user_id, { amount: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 mb-1 block">Slip date</label>
                      <input
                        type="date"
                        value={entry.date}
                        onChange={e => updateEntry(entry.user_id, { date: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 mb-1 block">Reference #</label>
                      <input
                        type="text"
                        placeholder="Slip no."
                        value={entry.reference}
                        onChange={e => updateEntry(entry.user_id, { reference: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
