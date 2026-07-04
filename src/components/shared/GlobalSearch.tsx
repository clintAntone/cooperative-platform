import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { createPortal } from 'react-dom'
import { useGlobalSearch } from '../../hooks/useGlobalSearch'
import { useCurrency } from '../../hooks/useCurrency'

interface GlobalSearchProps {
  open: boolean
  onClose: () => void
}

export function GlobalSearch({ open, onClose }: GlobalSearchProps) {
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()
  const { format } = useCurrency()
  const { data, isLoading } = useGlobalSearch(debouncedQuery)

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setQuery('')
      setDebouncedQuery('')
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  // Debounce query
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 300)
    return () => clearTimeout(timer)
  }, [query])

  // ESC to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  if (!open) return null

  function go(path: string) {
    navigate(path)
    onClose()
  }

  const hasResults = data && (
    data.members.length > 0 || data.loans.length > 0 || data.deposits.length > 0
  )

  return createPortal(
    <div
      className="fixed inset-0 z-[300] flex items-start justify-center pt-[10vh] px-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" aria-hidden="true" />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Global search"
        className="relative w-full max-w-lg bg-white rounded-xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200">
          <svg className="w-5 h-5 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search members, loans, deposits..."
            className="flex-1 text-sm outline-none placeholder-gray-400 text-gray-900"
          />
          {isLoading && (
            <span className="text-xs text-gray-400 animate-pulse">Searching…</span>
          )}
          <kbd className="hidden sm:inline-flex text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded border border-gray-200">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div className="max-h-[60vh] overflow-y-auto divide-y divide-gray-100">
          {query.length < 2 && (
            <p className="px-4 py-8 text-sm text-center text-gray-400">
              Type at least 2 characters to search
            </p>
          )}

          {query.length >= 2 && !isLoading && !hasResults && (
            <p className="px-4 py-8 text-sm text-center text-gray-400">
              No results for "{query}"
            </p>
          )}

          {data?.members && data.members.length > 0 && (
            <section>
              <p className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider bg-gray-50">
                Members
              </p>
              {data.members.map(m => (
                <button
                  key={m.id}
                  onClick={() => go(`/admin/members/${m.id}`)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-blue-50 text-left transition-colors"
                >
                  <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                    <span className="text-xs font-semibold text-blue-600">
                      {m.full_name.charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{m.full_name}</p>
                    <p className="text-xs text-gray-500">
                      {m.employee_id ?? 'No employee ID'}
                      {' · '}
                      <span className="capitalize">{m.account_status.replace('_', ' ')}</span>
                    </p>
                  </div>
                  <svg className="w-4 h-4 text-gray-300 flex-shrink-0 ml-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              ))}
            </section>
          )}

          {data?.loans && data.loans.length > 0 && (
            <section>
              <p className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider bg-gray-50">
                Loan Applications
              </p>
              {data.loans.map(l => (
                <button
                  key={l.id}
                  onClick={() => go(`/admin/loans/${l.id}`)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-blue-50 text-left transition-colors"
                >
                  <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                    <svg className="w-4 h-4 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{l.member_name}</p>
                    <p className="text-xs text-gray-500">
                      {format(l.amount_requested)}
                      {' · '}
                      <span className="capitalize">{l.status.replace(/_/g, ' ')}</span>
                    </p>
                  </div>
                  <svg className="w-4 h-4 text-gray-300 flex-shrink-0 ml-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              ))}
            </section>
          )}

          {data?.deposits && data.deposits.length > 0 && (
            <section>
              <p className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider bg-gray-50">
                Deposit Requests
              </p>
              {data.deposits.map(d => (
                <button
                  key={d.id}
                  onClick={() => go('/admin/deposit-requests')}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-blue-50 text-left transition-colors"
                >
                  <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center flex-shrink-0">
                    <svg className="w-4 h-4 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{d.member_name}</p>
                    <p className="text-xs text-gray-500">
                      {format(d.amount)}
                      {' · '}
                      <span className="capitalize">{d.status}</span>
                    </p>
                  </div>
                  <svg className="w-4 h-4 text-gray-300 flex-shrink-0 ml-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              ))}
            </section>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
