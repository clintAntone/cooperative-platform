import { useNavigate } from 'react-router-dom'
import { Header } from '../../components/layout/Header'
import { Card, CardHeader, CardBody } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { StatusBadge } from '../../components/shared/StatusBadge'
import { PageLoader } from '../../components/shared/LoadingSpinner'
import { useEquityShares, useEquitySummary } from '../../hooks/useEquity'
import { useMyDepositRequests } from '../../hooks/useDepositRequests'
import { formatDate, getProgressPercent } from '../../lib/utils'
import { useCurrency } from '../../hooks/useCurrency'
import type { EquityShare } from '../../types'

export function EquityPage() {
  const navigate = useNavigate()
  const { data: shares, isLoading } = useEquityShares()
  const { data: summary } = useEquitySummary()
  const { data: myDepositRequests = [] } = useMyDepositRequests()

  const { format: currency } = useCurrency()
  if (isLoading) return <PageLoader />

  const handleRequestDeposit = (share: EquityShare) => {
    navigate(`/equity/deposit-request?share_id=${share.id}`)
  }

  return (
    <div>
      <Header
        title="Equity Shares"
        subtitle="Manage your cooperative equity contributions"
      />

      <div className="p-4 sm:p-6 space-y-6">
        {/* Summary */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-white rounded-xl border border-gray-200 p-3 sm:p-5">
            <p className="text-xs sm:text-sm text-gray-500 truncate">Total Invested</p>
            <p className="text-base sm:text-xl font-semibold text-gray-900 mt-1 truncate">
              {currency(summary?.totalInvested ?? 0)}
            </p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-3 sm:p-5">
            <p className="text-xs sm:text-sm text-gray-500 truncate">Completed</p>
            <p className="text-base sm:text-xl font-semibold text-gray-900 mt-1">
              {summary?.completedShares ?? 0}
            </p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-3 sm:p-5">
            <p className="text-xs sm:text-sm text-gray-500 truncate">Total Shares</p>
            <p className="text-base sm:text-xl font-semibold text-gray-900 mt-1">
              {summary?.totalShares ?? 0}
            </p>
          </div>
        </div>

        {/* Shares List */}
        {!shares || shares.length === 0 ? (
          <Card>
            <CardBody className="py-12 text-center">
              <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h3 className="text-base font-semibold text-gray-900 mb-1">No shares yet</h3>
              <p className="text-sm text-gray-500">
                Equity shares are opened by cooperative staff. Please contact your administrator to get started.
              </p>
            </CardBody>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {shares.map(share => {
              const progress = getProgressPercent(share.paid_amount, share.target_amount)
              const remaining = share.target_amount - share.paid_amount

              return (
                <Card key={share.id}>
                  <CardHeader
                    action={<StatusBadge status={share.status} />}
                  >
                    <h3 className="font-semibold text-gray-900">Share #{share.share_number}</h3>
                    <p className="text-xs text-gray-400 mt-0.5">
                      Opened {formatDate(share.created_at)}
                    </p>
                  </CardHeader>
                  <CardBody>
                    {/* Progress bar */}
                    <div className="mb-4">
                      <div className="flex justify-between text-sm mb-1.5">
                        <span className="text-gray-500">{currency(share.paid_amount)} paid</span>
                        <span className="font-medium text-gray-900">{progress}%</span>
                      </div>
                      <div className="w-full bg-gray-100 rounded-full h-2.5">
                        <div
                          className={`h-2.5 rounded-full transition-all ${
                            share.status === 'completed' ? 'bg-green-500' : 'bg-blue-500'
                          }`}
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                      <p className="text-xs text-gray-400 mt-1.5">
                        Target: {currency(share.target_amount)}
                      </p>
                    </div>

                    {share.status === 'completed' ? (
                      <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 rounded-lg px-3 py-2">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        Completed {share.completed_at ? formatDate(share.completed_at) : ''}
                      </div>
                    ) : share.status === 'in_progress' ? (
                      <div className="space-y-2">
                        <p className="text-xs text-gray-500">
                          Remaining: <span className="font-medium text-gray-700">{currency(remaining)}</span>
                        </p>
                        <Button
                          size="sm"
                          variant="outline"
                          className="w-full"
                          onClick={() => handleRequestDeposit(share)}
                        >
                          Request Deposit
                        </Button>
                      </div>
                    ) : (
                      <p className="text-sm text-gray-400 italic">Share cancelled</p>
                    )}
                  </CardBody>
                </Card>
              )
            })}
          </div>
        )}

        {/* My Deposit Requests */}
        {myDepositRequests.length > 0 && (
          <div>
            <h2 className="text-base font-semibold text-gray-900 mb-3">My Deposit Requests</h2>
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Date</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Amount</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Method</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {myDepositRequests.slice(0, 5).map(req => (
                      <tr key={req.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-gray-500 text-xs">{formatDate(req.created_at)}</td>
                        <td className="px-4 py-3 font-medium text-gray-900">{currency(req.amount)}</td>
                        <td className="px-4 py-3 text-gray-600 capitalize">{req.payment_method.replace('_', ' ')}</td>
                        <td className="px-4 py-3">
                          <StatusBadge status={req.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        )}
      </div>
    </div>
  )
}
