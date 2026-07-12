import { useState } from 'react'
import { Header } from '../../components/layout/Header'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { useLastDividendRelease, useReleaseDividends } from '../../hooks/useEquityDividends'
import { useCurrency } from '../../hooks/useCurrency'
import { formatDateTime } from '../../lib/utils'
import { PageGuide } from '../../components/shared/PageGuide'

export function DividendsPage() {
  const { format: currency } = useCurrency()
  const { data: lastRelease } = useLastDividendRelease()
  const release = useReleaseDividends()
  const [showConfirm, setShowConfirm] = useState(false)

  return (
    <div>
      <Header title="Equity Dividends" subtitle="Release annual dividends to members with completed shares" />
      <div className="p-4 sm:p-6 space-y-4">
        <PageGuide
          storageKey="dividends"
          steps={[
            'Equity dividends are annual payments to members based on the value of their completed shares.',
            "The dividend rate is set in System Config under 'equity_dividend_rate' (default 5%).",
            "Click 'Release Dividends Now' once per year to credit all members with completed shares.",
            "Dividends are credited directly to each member's savings account and recorded in the ledger.",
          ]}
          note="Run this once per year, typically at the cooperative's fiscal year-end. The system tracks the last release date to prevent double-releasing."
        />
        <Card>
          <div className="px-6 py-5 space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Last Dividend Release</h3>
              {lastRelease ? (
                <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
                  <div>
                    <p className="text-gray-500">Period End</p>
                    <p className="font-semibold">{new Date(lastRelease.period_end).toLocaleDateString()}</p>
                  </div>
                  <div>
                    <p className="text-gray-500">Total Credited</p>
                    <p className="font-semibold text-green-700">{currency(lastRelease.total_dividend)}</p>
                  </div>
                  <div>
                    <p className="text-gray-500">Shares Credited</p>
                    <p className="font-semibold">{lastRelease.share_count}</p>
                  </div>
                  <div className="col-span-2 sm:col-span-3">
                    <p className="text-gray-500">Run at</p>
                    <p className="font-semibold">{formatDateTime(lastRelease.released_at)}</p>
                  </div>
                </div>
              ) : (
                <p className="mt-1 text-sm text-gray-500">No dividends have been released yet.</p>
              )}
            </div>
            <div className="pt-2 border-t border-gray-100">
              <p className="text-xs text-gray-500 mb-3">
                Dividends are computed as a percentage of each completed share's target value.
                The rate is configured in System Config (<code>equity_dividend_rate</code>).
                Dividends are credited directly to each member's savings account.
              </p>
              <Button onClick={() => setShowConfirm(true)}>Release Dividends Now</Button>
            </div>
          </div>
        </Card>
      </div>

      <Modal isOpen={showConfirm} onClose={() => setShowConfirm(false)} title="Release Equity Dividends" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            This will credit dividends to <strong>all members with completed equity shares</strong>.
            The dividend is calculated based on each share's target value × the configured rate.
            This action cannot be undone.
          </p>
          {lastRelease && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-xs text-yellow-800">
              Last release was on <strong>{formatDateTime(lastRelease.released_at)}</strong>.
            </div>
          )}
          <div className="flex gap-3">
            <Button variant="outline" className="flex-1" onClick={() => setShowConfirm(false)}>Cancel</Button>
            <Button
              className="flex-1"
              loading={release.isPending}
              onClick={() => release.mutate(undefined, {
                onSuccess: () => setShowConfirm(false),
                onError: (err: any) => alert(err.message ?? 'Failed to release dividends'),
              })}
            >
              Release Dividends
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
