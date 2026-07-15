import { useState } from 'react'

interface PageGuideProps {
  storageKey?: string
  steps: string[]
  note?: string
}

export function PageGuide({ steps, note }: PageGuideProps) {
  const [collapsed, setCollapsed] = useState(true)

  return (
    <div className="rounded-xl border border-blue-300 bg-blue-50 text-sm overflow-hidden">
      <button
        onClick={() => setCollapsed(c => !c)}
        className="flex w-full items-center justify-between gap-2 text-left px-4 py-3 hover:bg-blue-100 transition-colors"
        aria-expanded={!collapsed}
      >
        <span className="flex items-center gap-2 font-semibold text-blue-700">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </span>
          Check this quick guide
        </span>
        <svg
          className={`w-4 h-4 text-blue-500 transition-transform ${collapsed ? '' : 'rotate-180'}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {!collapsed && (
        <div className="px-4 pb-4 border-t border-blue-200">
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
          {note && (
            <p className="mt-3 text-xs text-blue-600 border-t border-blue-200 pt-2">{note}</p>
          )}
        </div>
      )}
    </div>
  )
}
