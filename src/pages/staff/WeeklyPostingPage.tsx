import { useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { useCurrency } from '../../hooks/useCurrency'
import { Header } from '../../components/layout/Header'
import { Modal } from '../../components/ui/Modal'
import { PageGuide } from '../../components/shared/PageGuide'
import { toast } from '../../lib/toast'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Member {
  user_id: string
  full_name: string
  employee_id: string | null
  has_completed_share: boolean
}

interface EntryRow {
  user_id: string
  full_name: string
  employee_id: string | null
  has_completed_share: boolean
  amount: string
  destination: 'shares' | 'savings'
  date: string
  reference: string
}

// ─── Fetch members ─────────────────────────────────────────────────────────────

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
      })) as Member[]
    },
  })
}

// ─── Batch deposit modal ───────────────────────────────────────────────────────

function BatchDepositModal({
  rows,
  onUpdate,
  onClose,
  onPosted,
}: {
  rows: EntryRow[]
  onUpdate: (userId: string, patch: Partial<EntryRow>) => void
  onClose: () => void
  onPosted: () => void
}) {
  const { user } = useAuth()
  const { format: currency, symbol } = useCurrency()
  const [posting, setPosting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const validate = (row: EntryRow) => {
    const errors: { amount?: string; date?: string } = {}
    if (!row.amount || parseFloat(row.amount) <= 0) errors.amount = 'Required'
    if (!row.date) errors.date = 'Required'
    return errors
  }

  const allValid = rows.every(r => Object.keys(validate(r)).length === 0)
  const totalAmount = rows.reduce((sum, r) => sum + (parseFloat(r.amount) || 0), 0)

  const handleReview = () => {
    setSubmitted(true)
    if (!allValid) return
    setConfirming(true)
  }

  const handlePostAll = async () => {
    setPosting(true)

    let ok = 0
    let failed = 0
    const failedNames: string[] = []

    for (const row of rows) {
      const { error } = await supabase.rpc('staff_post_deposit' as any, {
        p_user_id: row.user_id,
        p_amount: parseFloat(row.amount),
        p_destination: row.destination,
        p_date: new Date(row.date).toISOString(),
        p_reference: row.reference || null,
        p_recorded_by: user!.id,
      })

      if (error) {
        failed++
        failedNames.push(`${row.full_name} (${error.message})`)
        console.error(`Failed for ${row.full_name}:`, error)
      } else {
        ok++
      }
    }

    setPosting(false)

    if (ok > 0) {
      toast({ title: `${ok} deposit${ok > 1 ? 's' : ''} posted successfully`, variant: 'success' })
    }
    if (failed > 0) {
      toast({ title: `Failed: ${failedNames.join(' · ')}`, variant: 'error' })
    }
    if (ok > 0) onPosted()
  }

  if (confirming) return (
    <div className="flex flex-col max-h-[75vh]">
      <div className="overflow-y-auto -mx-6 px-6 divide-y divide-gray-100">
        {rows.map(row => (
          <div key={row.user_id} className="py-3 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-900 truncate">{row.full_name}</p>
              <div className="flex items-center gap-2 mt-0.5">
                <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                  row.destination === 'savings' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
                }`}>
                  {row.destination === 'savings' ? 'Savings' : 'Shares'}
                </span>
                {row.reference && <span className="text-xs text-gray-400">{row.reference}</span>}
                <span className="text-xs text-gray-400">
                  {new Date(row.date).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}
                </span>
              </div>
            </div>
            <span className="text-sm font-bold text-gray-900 shrink-0">{currency(parseFloat(row.amount))}</span>
          </div>
        ))}
      </div>
      <div className="pt-3 border-t border-gray-200 -mx-6 px-6 mt-2 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-gray-700">Total</span>
          <span className="text-lg font-bold text-gray-900">{currency(totalAmount)}</span>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <p className="text-xs text-amber-800 font-medium">Verify all amounts match the deposit slips before confirming.</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setConfirming(false)}
            className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
          >
            ← Back
          </button>
          <button
            onClick={handlePostAll}
            disabled={posting}
            className="flex-1 py-2.5 rounded-xl bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white text-sm font-medium transition-colors"
          >
            {posting ? 'Posting…' : 'Confirm & Post'}
          </button>
        </div>
      </div>
    </div>
  )

  return (
    <div className="flex flex-col max-h-[75vh]">
      {/* Scrollable rows */}
      <div className="overflow-y-auto -mx-6 px-6 divide-y divide-gray-100">
        {rows.map((row, idx) => {
          const errors = submitted ? validate(row) : {}
          return (
            <div key={row.user_id} className="py-3 space-y-2.5">
              {/* Member header */}
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-700 text-xs font-bold flex items-center justify-center shrink-0">
                    {idx + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">{row.full_name}</p>
                    {row.employee_id && <p className="text-xs text-gray-400">{row.employee_id}</p>}
                  </div>
                </div>
                {/* Destination toggle */}
                <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5 shrink-0">
                  <button
                    onClick={() => onUpdate(row.user_id, { destination: 'shares' })}
                    className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                      row.destination === 'shares' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    Shares
                  </button>
                  <button
                    onClick={() => { if (row.has_completed_share) onUpdate(row.user_id, { destination: 'savings' }) }}
                    title={!row.has_completed_share ? 'Complete a share first' : ''}
                    className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                      row.destination === 'savings' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                    } ${!row.has_completed_share ? 'opacity-40 cursor-not-allowed' : ''}`}
                  >
                    Savings
                  </button>
                </div>
              </div>

              {/* Inputs */}
              <div className="grid grid-cols-[140px_160px_1fr] gap-2">
                {/* Amount */}
                <div>
                  <div className={`flex items-center border rounded-lg overflow-hidden transition-colors ${
                    errors.amount ? 'border-red-400 ring-1 ring-red-400' : 'border-gray-200 focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-500'
                  }`}>
                    <span className="pl-3 pr-1 text-sm text-gray-400 select-none">{symbol}</span>
                    <input
                      type="number"
                      min="1"
                      placeholder="0.00"
                      value={row.amount}
                      onChange={e => onUpdate(row.user_id, { amount: e.target.value })}
                      className="flex-1 py-2 pr-3 text-sm bg-transparent focus:outline-none"
                    />
                  </div>
                  {errors.amount && <p className="text-xs text-red-500 mt-0.5">{errors.amount}</p>}
                </div>

                {/* Date */}
                <div>
                  <div className={`flex items-center border rounded-lg overflow-hidden transition-colors ${
                    errors.date ? 'border-red-400 ring-1 ring-red-400' : 'border-gray-200 focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-500'
                  }`}>
                    <input
                      type="date"
                      value={row.date}
                      onChange={e => onUpdate(row.user_id, { date: e.target.value })}
                      className="w-full px-3 py-2 text-sm bg-transparent focus:outline-none"
                    />
                  </div>
                  {errors.date && <p className="text-xs text-red-500 mt-0.5">{errors.date}</p>}
                </div>

                {/* Receipt */}
                <div>
                  <input
                    type="text"
                    placeholder="Receipt # (optional)"
                    value={row.reference}
                    onChange={e => onUpdate(row.user_id, { reference: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Footer */}
      <div className="pt-3 border-t border-gray-100 -mx-6 px-6 mt-2 space-y-3">
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-500">{rows.length} member{rows.length > 1 ? 's' : ''}</span>
          {totalAmount > 0 && <span className="font-semibold text-gray-900">Total: {currency(totalAmount)}</span>}
        </div>
        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleReview}
            className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors"
          >
            Review →
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function WeeklyPostingPage() {
  const { data: members = [], isLoading } = useMembersForPosting()
  const queryClient = useQueryClient()

  const today = new Date().toISOString().split('T')[0]

  const [search, setSearch] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [modalOpen, setModalOpen] = useState(false)
  const [rows, setRows] = useState<EntryRow[]>([])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return members.filter(
      m =>
        m.full_name.toLowerCase().includes(q) ||
        (m.employee_id ?? '').toLowerCase().includes(q)
    )
  }, [members, search])

  const toggleMember = (m: Member) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(m.user_id) ? next.delete(m.user_id) : next.add(m.user_id)
      return next
    })
  }

  const toggleAll = () => {
    if (filtered.every(m => selectedIds.has(m.user_id))) {
      setSelectedIds(prev => {
        const next = new Set(prev)
        filtered.forEach(m => next.delete(m.user_id))
        return next
      })
    } else {
      setSelectedIds(prev => {
        const next = new Set(prev)
        filtered.forEach(m => next.add(m.user_id))
        return next
      })
    }
  }

  const openModal = () => {
    const selected = members.filter(m => selectedIds.has(m.user_id))
    setRows(selected.map(m => ({
      user_id: m.user_id,
      full_name: m.full_name,
      employee_id: m.employee_id,
      has_completed_share: m.has_completed_share,
      amount: '',
      destination: 'shares',
      date: today,
      reference: '',
    })))
    setModalOpen(true)
  }

  const updateRow = (userId: string, patch: Partial<EntryRow>) => {
    setRows(prev => prev.map(r => r.user_id === userId ? { ...r, ...patch } : r))
  }

  const handlePosted = () => {
    queryClient.invalidateQueries({ queryKey: ['equity_shares'] })
    queryClient.invalidateQueries({ queryKey: ['savings_account'] })
    queryClient.invalidateQueries({ queryKey: ['members_list'] })
    queryClient.invalidateQueries({ queryKey: ['members_for_posting'] })
    setModalOpen(false)
    setSelectedIds(new Set())
  }

  const allFilteredSelected = filtered.length > 0 && filtered.every(m => selectedIds.has(m.user_id))
  const selectedMembers = members.filter(m => selectedIds.has(m.user_id))

  return (
    <div>
      <Header
        title="Post Deposits"
        subtitle="Select members then fill in their deposit details"
      />

      <div className="p-4 sm:p-6 space-y-4">
        <PageGuide
          storageKey="post-deposits"
          steps={[
            'Deposits happen remotely — members send money via GCash or bank transfer and submit a deposit request through the app.',
            'Use "Requests" under the Deposits menu to review and approve member-submitted deposits.',
            'Use this page (Post Manually) only when you need to record a deposit on behalf of a member — e.g. cash hand-off or missing request.',
            'Select one or more members, click Next, fill in the amount and receipt number, then review and confirm before posting.',
          ]}
          note="Posting here bypasses the approval step. Double-check amounts against the actual receipt before confirming."
        />
        <div className="flex gap-5 items-start">

          {/* ── Left: member list ── */}
          <div className="flex-1 min-w-0 space-y-3">
            {/* Search */}
            <div className="relative">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                placeholder="Search by name or employee ID…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              />
            </div>

            {/* Member list */}
            {isLoading ? (
              <div className="py-12 text-center text-sm text-gray-400">Loading members…</div>
            ) : (
              <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
                {filtered.length > 0 && (
                  <div className="px-4 py-2.5 border-b border-gray-100 flex items-center gap-3 bg-gray-50">
                    <input
                      type="checkbox"
                      checked={allFilteredSelected}
                      onChange={toggleAll}
                      className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-xs font-medium text-gray-500">Select all</span>
                  </div>
                )}
                <div className="divide-y divide-gray-50">
                  {filtered.length === 0 && (
                    <div className="py-10 text-center text-sm text-gray-400">No members found</div>
                  )}
                  {filtered.map(member => {
                    const isChecked = selectedIds.has(member.user_id)
                    return (
                      <div
                        key={member.user_id}
                        onClick={() => toggleMember(member)}
                        className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors ${isChecked ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleMember(member)}
                          onClick={e => e.stopPropagation()}
                          className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 shrink-0"
                        />
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-colors ${isChecked ? 'bg-blue-100' : 'bg-gray-100'}`}>
                          <span className={`text-sm font-semibold transition-colors ${isChecked ? 'text-blue-600' : 'text-gray-500'}`}>
                            {member.full_name.charAt(0).toUpperCase()}
                          </span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900">{member.full_name}</p>
                          {member.employee_id && <p className="text-xs text-gray-400">{member.employee_id}</p>}
                        </div>
                        {!member.has_completed_share && (
                          <span className="text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full shrink-0">Shares only</span>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>

          {/* ── Right: selection panel (desktop only) ── */}
          <div className="hidden lg:block w-72 shrink-0">
            <div className="bg-white rounded-2xl border border-gray-100 p-5 sticky top-6">
              {selectedIds.size === 0 ? (
                <div className="text-center py-6">
                  <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-3">
                    <svg className="w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <p className="text-sm font-medium text-gray-700 mb-1">No members selected</p>
                  <p className="text-xs text-gray-400">Check members on the left who submitted a deposit slip this week.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div>
                    <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Selected</p>
                    <div className="space-y-1.5">
                      {selectedMembers.map(m => (
                        <div key={m.user_id} className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
                              <span className="text-xs font-semibold text-blue-600">{m.full_name.charAt(0)}</span>
                            </div>
                            <p className="text-sm text-gray-700 truncate">{m.full_name}</p>
                          </div>
                          <button
                            onClick={() => toggleMember(m)}
                            className="text-gray-300 hover:text-red-400 transition-colors shrink-0"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="pt-3 border-t border-gray-100">
                    <p className="text-xs text-gray-400 mb-3">{selectedIds.size} member{selectedIds.size > 1 ? 's' : ''} ready to post</p>
                    <button
                      onClick={openModal}
                      className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-xl transition-colors"
                    >
                      Next →
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

        </div>
      </div>

      {/* Sticky bottom bar — mobile only */}
      {selectedIds.size > 0 && (
        <div className="lg:hidden fixed bottom-0 left-0 right-0 z-[60] bg-white border-t border-gray-200 px-4 py-3 flex items-center justify-between gap-3">
          <span className="text-sm font-medium text-gray-700">
            {selectedIds.size} member{selectedIds.size > 1 ? 's' : ''} selected
          </span>
          <button
            onClick={openModal}
            className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-xl transition-colors"
          >
            Next →
          </button>
        </div>
      )}

      {/* Batch deposit modal */}
      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={`Post Deposits — ${rows.length} Member${rows.length > 1 ? 's' : ''}`}
        size="2xl"
      >
        <BatchDepositModal
          rows={rows}
          onUpdate={updateRow}
          onClose={() => setModalOpen(false)}
          onPosted={handlePosted}
        />
      </Modal>
    </div>
  )
}
