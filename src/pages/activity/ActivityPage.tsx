import { useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { Header } from '../../components/layout/Header'
import { Card, CardBody } from '../../components/ui/Card'
import { SkeletonList } from '../../components/shared/Skeleton'
import { Pagination } from '../../components/shared/Pagination'
import { formatDateTime } from '../../lib/utils'
import { useCurrency } from '../../hooks/useCurrency'
import type { LedgerEntry } from '../../types'

const PAGE_SIZE = 20

const entryTypeLabel: Record<string, string> = {
  equity_contribution: 'Equity Contribution',
  equity_reversal: 'Equity Reversal',
  loan_disbursement: 'Loan Disbursement',
  loan_repayment: 'Loan Repayment',
  fee: 'Fee',
  adjustment: 'Adjustment',
}

function useActivityLog(page: number) {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['activity_log', user?.id, page],
    queryFn: async () => {
      const from = page * PAGE_SIZE
      const to = from + PAGE_SIZE - 1

      const { data, error, count } = await supabase
        .from('ledger_entries')
        .select('*', { count: 'exact' })
        .eq('user_id', user!.id)
        .order('created_at', { ascending: false })
        .range(from, to)

      if (error) throw error
      return { entries: (data ?? []) as LedgerEntry[], total: count ?? 0 }
    },
    enabled: !!user?.id,
  })
}

export function ActivityPage() {
  const [page, setPage] = useState(0)
  const { data, isLoading } = useActivityLog(page)
  const { format: currency } = useCurrency()

  const entries = data?.entries ?? []
  const total = data?.total ?? 0

  if (isLoading) return <SkeletonList rows={6} />

  return (
    <div>
      <Header
        title="Activity Log"
        subtitle="Your complete transaction history"
      />
      <div className="p-4 sm:p-6">
        <Card>
          <CardBody className="p-0">
            {entries.length === 0 && total === 0 ? (
              <div className="py-12 text-center">
                <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                </div>
                <p className="text-sm text-gray-500">No transactions yet</p>
              </div>
            ) : (
              <>
                <div className="divide-y divide-gray-100">
                  {entries.map(entry => (
                    <div key={entry.id} className="flex items-start gap-3 px-4 py-3.5">
                      <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${
                        entry.direction === 'credit' ? 'bg-green-100' : 'bg-blue-100'
                      }`}>
                        {entry.direction === 'credit' ? (
                          <svg className="w-4 h-4 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
                          </svg>
                        ) : (
                          <svg className="w-4 h-4 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                          </svg>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900">
                          {entryTypeLabel[entry.entry_type] ?? entry.entry_type}
                        </p>
                        {entry.notes && (
                          <p className="text-xs text-gray-500 mt-0.5">{entry.notes}</p>
                        )}
                        <p className="text-xs text-gray-400 mt-0.5">{formatDateTime(entry.created_at)}</p>
                      </div>
                      <span className={`text-sm font-semibold flex-shrink-0 ${
                        entry.direction === 'credit' ? 'text-green-700' : 'text-gray-900'
                      }`}>
                        {entry.direction === 'credit' ? '+' : '-'}{currency(entry.amount)}
                      </span>
                    </div>
                  ))}
                </div>
                <Pagination
                  page={page}
                  pageSize={PAGE_SIZE}
                  total={total}
                  onChange={p => { setPage(p); window.scrollTo({ top: 0, behavior: 'smooth' }) }}
                />
              </>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  )
}
