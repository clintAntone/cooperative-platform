import { cn } from '../../lib/utils'

// Base shimmer block
export function Skeleton({ className }: { className?: string }) {
  return (
    <div className={cn('animate-pulse rounded-md bg-gray-200', className)} />
  )
}

// A stat card placeholder (matches the KPI bento grid pattern)
export function SkeletonStatCard() {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-2">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-7 w-16" />
    </div>
  )
}

// A list card row placeholder (matches mobile card layouts)
export function SkeletonCard({ lines = 2 }: { lines?: number }) {
  return (
    <div className="p-4 space-y-2 border-b border-gray-100 last:border-0">
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-36" />
        <Skeleton className="h-5 w-16 rounded-full" />
      </div>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={`h-3 ${i % 2 === 0 ? 'w-48' : 'w-32'}`} />
      ))}
    </div>
  )
}

// A table row placeholder (matches desktop table layouts)
export function SkeletonTableRow({ cols = 5 }: { cols?: number }) {
  return (
    <tr>
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <Skeleton className="h-4 w-full max-w-[120px]" />
        </td>
      ))}
    </tr>
  )
}

// Full page skeleton — stat cards + list
export function SkeletonPage({ cards = 3, rows = 5 }: { cards?: number; rows?: number }) {
  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Stat cards */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        {Array.from({ length: cards }).map((_, i) => (
          <SkeletonStatCard key={i} />
        ))}
      </div>
      {/* Content card */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {/* Mobile */}
        <div className="sm:hidden">
          {Array.from({ length: rows }).map((_, i) => (
            <SkeletonCard key={i} lines={2} />
          ))}
        </div>
        {/* Desktop */}
        <div className="hidden sm:block">
          <div className="bg-gray-50 border-b border-gray-200 px-4 py-3 flex gap-6">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-3 w-20" />
            ))}
          </div>
          <table className="w-full">
            <tbody>
              {Array.from({ length: rows }).map((_, i) => (
                <SkeletonTableRow key={i} cols={5} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// Simple list-only skeleton (no stat cards — for detail pages)
export function SkeletonList({ rows = 4 }: { rows?: number }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="sm:hidden">
        {Array.from({ length: rows }).map((_, i) => (
          <SkeletonCard key={i} lines={2} />
        ))}
      </div>
      <div className="hidden sm:block">
        <table className="w-full">
          <tbody>
            {Array.from({ length: rows }).map((_, i) => (
              <SkeletonTableRow key={i} cols={5} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// Detail page skeleton — avatar header + stat cards + content (MemberDetail, LoanDetail, etc.)
export function SkeletonDetailPage({ cards = 4 }: { cards?: number }) {
  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
        <div className="flex items-center gap-4 mb-4">
          <Skeleton className="w-14 h-14 rounded-full flex-shrink-0" />
          <div className="space-y-2 flex-1">
            <Skeleton className="h-5 w-44" />
            <Skeleton className="h-3 w-28" />
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {Array.from({ length: cards }).map((_, i) => (
            <SkeletonStatCard key={i} />
          ))}
        </div>
      </div>
      {/* Content */}
      <SkeletonList rows={5} />
    </div>
  )
}

// Form/settings page skeleton — rows of label + input pairs
export function SkeletonFormPage({ rows = 6 }: { rows?: number }) {
  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100 overflow-hidden">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center justify-between gap-4 px-4 py-3">
            <div className="space-y-1.5">
              <Skeleton className="h-3.5 w-36" />
              <Skeleton className="h-3 w-52" />
            </div>
            <Skeleton className="h-8 w-40 rounded-lg flex-shrink-0" />
          </div>
        ))}
      </div>
    </div>
  )
}
