interface PaginationProps {
  page: number       // 0-indexed
  pageSize: number
  total: number
  onChange: (page: number) => void
}

export function Pagination({ page, pageSize, total, onChange }: PaginationProps) {
  const pageCount = Math.ceil(total / pageSize)
  if (pageCount <= 1) return null

  const from = page * pageSize + 1
  const to = Math.min((page + 1) * pageSize, total)

  function buildPages(): (number | null)[] {
    if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i)
    const pages: (number | null)[] = [0]
    if (page > 3) pages.push(null)
    for (let p = Math.max(1, page - 1); p <= Math.min(pageCount - 2, page + 1); p++) {
      pages.push(p)
    }
    if (page < pageCount - 4) pages.push(null)
    pages.push(pageCount - 1)
    return pages
  }

  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
      <p className="text-xs text-gray-500">
        {from}–{to} of {total}
      </p>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onChange(page - 1)}
          disabled={page === 0}
          className="px-2 py-1 rounded text-sm text-gray-600 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          ←
        </button>
        {buildPages().map((p, idx) =>
          p === null ? (
            <span key={`e-${idx}`} className="px-1 text-gray-400 text-sm select-none">…</span>
          ) : (
            <button
              key={p}
              onClick={() => onChange(p)}
              className={`min-w-[28px] h-7 rounded text-sm font-medium transition-colors ${
                p === page
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              {p + 1}
            </button>
          )
        )}
        <button
          onClick={() => onChange(page + 1)}
          disabled={page >= pageCount - 1}
          className="px-2 py-1 rounded text-sm text-gray-600 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          →
        </button>
      </div>
    </div>
  )
}
