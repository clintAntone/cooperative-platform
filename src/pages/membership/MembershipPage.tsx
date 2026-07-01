import { useQuery } from '@tanstack/react-query'
import { Header } from '../../components/layout/Header'
import { Card, CardHeader, CardBody } from '../../components/ui/Card'
import { StatusBadge } from '../../components/shared/StatusBadge'
import { PageLoader } from '../../components/shared/LoadingSpinner'
import { useMembershipStatus, useMembershipHistory } from '../../hooks/useMembership'
import { useEquitySummary } from '../../hooks/useEquity'
import { formatDateTime, formatDate } from '../../lib/utils'
import { supabase } from '../../lib/supabase'

const statusDescriptions: Record<string, string> = {
  pending: 'You have not yet completed any equity shares. Complete at least one share to become an active member.',
  active: 'You are an active member of the cooperative. You are eligible for all member benefits.',
  suspended: 'Your membership has been suspended, likely due to a defaulted loan. Please contact support.',
  inactive: 'Your account is currently inactive. Please contact the cooperative admin.',
}

export function MembershipPage() {
  const { data: membershipStatus, isLoading: statusLoading } = useMembershipStatus()
  const { data: history, isLoading: historyLoading } = useMembershipHistory()
  const { data: equitySummary, isLoading: equityLoading } = useEquitySummary()

  const { data: sharePrice = 0 } = useQuery({
    queryKey: ['share_price_config'],
    queryFn: async () => {
      const { data } = await supabase
        .from('system_config')
        .select('config_value')
        .eq('config_key', 'share_price')
        .single()
      return data ? parseFloat(data.config_value) : 0
    },
    staleTime: Infinity,
  })

  if (statusLoading || historyLoading || equityLoading) return <PageLoader />

  const effectiveShares = sharePrice > 0 && equitySummary
    ? Number((equitySummary.totalInvested / sharePrice).toFixed(2))
    : 0

  const currentStatus = membershipStatus?.status ?? 'pending'

  const statusColorMap: Record<string, string> = {
    pending: 'border-yellow-200 bg-yellow-50',
    active: 'border-green-200 bg-green-50',
    suspended: 'border-red-200 bg-red-50',
    inactive: 'border-gray-200 bg-gray-50',
  }

  return (
    <div>
      <Header
        title="Membership"
        subtitle="Your cooperative membership status and history"
      />

      <div className="p-6 space-y-6">
        {/* Main Status Card */}
        <Card className={`border-2 ${statusColorMap[currentStatus]}`}>
          <CardBody className="py-8">
            <div className="flex flex-col sm:flex-row items-center gap-6">
              <div className={`w-20 h-20 rounded-full flex items-center justify-center flex-shrink-0 ${
                currentStatus === 'active' ? 'bg-green-200' :
                currentStatus === 'pending' ? 'bg-yellow-200' :
                currentStatus === 'suspended' ? 'bg-red-200' :
                'bg-gray-200'
              }`}>
                {currentStatus === 'active' ? (
                  <svg className="w-10 h-10 text-green-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                ) : currentStatus === 'suspended' ? (
                  <svg className="w-10 h-10 text-red-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                ) : (
                  <svg className="w-10 h-10 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                )}
              </div>

              <div className="text-center sm:text-left">
                <div className="flex items-center gap-3 justify-center sm:justify-start mb-2">
                  <h2 className="text-2xl font-bold text-gray-900">Membership Status</h2>
                  <StatusBadge status={currentStatus} size="md" />
                </div>
                <p className="text-gray-600 max-w-lg">
                  {statusDescriptions[currentStatus]}
                </p>
                {membershipStatus?.reason && (
                  <p className="mt-2 text-sm text-gray-500 italic">Reason: {membershipStatus.reason}</p>
                )}
              </div>
            </div>
          </CardBody>
        </Card>

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card>
            <CardBody>
              <p className="text-sm text-gray-500">Completed Shares</p>
              <p className="text-3xl font-bold text-gray-900 mt-1">
                {membershipStatus?.completed_shares ?? 0}
              </p>
            </CardBody>
          </Card>
          <Card>
            <CardBody>
              <p className="text-sm text-gray-500">Total Shares</p>
              <p className="text-3xl font-bold text-gray-900 mt-1">
                {effectiveShares}
              </p>
              <p className="text-xs text-gray-400 mt-0.5">
                {equitySummary?.totalShares ?? 0} share(s) opened
              </p>
            </CardBody>
          </Card>
          <Card>
            <CardBody>
              <p className="text-sm text-gray-500">Last Evaluated</p>
              <p className="text-lg font-semibold text-gray-900 mt-1">
                {membershipStatus?.last_evaluated_at
                  ? formatDate(membershipStatus.last_evaluated_at)
                  : '—'}
              </p>
            </CardBody>
          </Card>
        </div>

        {/* Status History */}
        <Card>
          <CardHeader>
            <h3 className="text-base font-semibold text-gray-900">Status History</h3>
          </CardHeader>
          <CardBody>
            {!history || history.filter(e => e.from_status !== e.to_status).length === 0 ? (
              <p className="text-sm text-gray-500 py-4 text-center">No status changes recorded yet</p>
            ) : (
              <div className="relative">
                <div className="absolute left-3.5 top-0 bottom-0 w-0.5 bg-gray-200" />
                <div className="space-y-4">
                  {history.filter(e => e.from_status !== e.to_status).map((entry) => (
                    <div key={entry.id} className="relative flex gap-4 pl-10">
                      <div className="absolute left-1 top-1 w-5 h-5 rounded-full bg-white border-2 border-gray-300 flex items-center justify-center">
                        <div className="w-2 h-2 rounded-full bg-blue-500" />
                      </div>
                      <div className="flex-1 pb-4">
                        <div className="flex items-center gap-2 flex-wrap">
                          {entry.from_status && (
                            <>
                              <StatusBadge status={entry.from_status} />
                              <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                              </svg>
                            </>
                          )}
                          <StatusBadge status={entry.to_status} />
                        </div>
                        {entry.changed_by_name && (
                          <p className="text-sm text-gray-700 mt-1 font-medium">
                            Approved by {entry.changed_by_name}
                          </p>
                        )}
                        {entry.reason && entry.reason !== 'Approved by staff' && (
                          <p className="text-sm text-gray-500">{entry.reason}</p>
                        )}
                        <p className="text-xs text-gray-400 mt-0.5">{formatDateTime(entry.changed_at)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  )
}
