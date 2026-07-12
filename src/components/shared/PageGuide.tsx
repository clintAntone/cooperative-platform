import { useState, useEffect } from 'react'

interface PageGuideProps {
  /** Unique key — used to persist collapsed state in localStorage */
  storageKey: string
  steps: string[]
  note?: string
}

export function PageGuide({ storageKey, steps, note }: PageGuideProps) {
  const key = `page_guide_collapsed_${storageKey}`
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(key) === '1' } catch { return false }
  })

  useEffect(() => {
    try { localStorage.setItem(key, collapsed ? '1' : '0') } catch { /* ignore */ }
  }, [collapsed, key])

  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm">
      <button
        onClick={() => setCollapsed(c => !c)}
        className="flex w-full items-center justify-between gap-2 text-left"
        aria-expanded={!collapsed}
      >
        <span className="flex items-center gap-2 font-medium text-blue-800">
          <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          How this works
        </span>
        <svg
          className={`w-4 h-4 text-blue-500 transition-transform ${collapsed ? '' : 'rotate-180'}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {!collapsed && (
        <ol className="mt-3 space-y-1.5 list-none pl-0">
          {steps.map((step, i) => (
            <li key={i} className="flex gap-2.5 text-blue-800">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-200 text-xs font-semibold text-blue-700">
                {i + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      )}

      {!collapsed && note && (
        <p className="mt-3 text-xs text-blue-600 border-t border-blue-200 pt-2">{note}</p>
      )}
    </div>
  )
}
