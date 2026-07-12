import { useState } from 'react'
import { Header } from '../../components/layout/Header'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { useRebateReleases, useReleaseRebates } from '../../hooks/useRebates'
import { useCurrency } from '../../hooks/useCurrency'
import { formatDate, formatDateTime } from '../../lib/utils'
import { PageGuide } from '../../components/shared/PageGuide'

export function RebatesPage() {
  const { format: currency } = useCurrency()
  const { data: releases = [], isLoading } = useRebateReleases()
  const releaseRebates = useReleaseRebates()

  const [showModal, setShowModal] = useState(false)

  // Default: last year's date range
  const now = new Date()
  const defaultEnd = now.toISOString().slice(0, 10)
  const defaultStart = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()).toISOString().slice(0, 10)

  const [periodStart, setPeriodStart] = useState(defaultStart)
  const [periodEnd, setPeriodEnd] = useState(defaultEnd)

  const handleRelease = () => {
    if (!periodStart || !periodEnd) return
    releaseRebates.mutate(
      { periodStart, periodEnd },
      {
        onSuccess: () => setShowModal(false),
        onError: (err: any) => alert(err.message ?? 'Failed to release rebates'),
      }
    )
  }

  return (
    <div>
      <Header
        title="Loan Rebates"
        subtitle="Return a portion of loan interest paid to members as a rebate"
        actions={
          <Button size="sm" onClick={() => setShowModal(true)}>Release Rebates</Button>
        }
      />

      <div className="p-4 sm:p-6 space-y-4">
        <PageGuide
          storageKey="rebates"
          steps={[
            'Rebates return a percentage of the loan interest paid by members back to them as a reward for good standing.',
            "Select a period (start and end date), then click 'Release Rebates' — the system sums interest paid per member during that period.",
            "The rebate rate is set in System Config under 'rebate_rate' (default 10% of interest paid).",
            "Rebates are credited to the member's savings account and recorded in the ledger.",
          ]}
          note="Only members who made loan repayments during the selected period will receive a rebate. Run this at your chosen cadence (e.g., semi-annually)."
        />
        {/* Release history */}
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Released At</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Period</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase">Rate</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase">Total Credited</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {isLoading ? (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-sm text-gray-400">Loading…</td></tr>
              ) : releases.length === 0 ? (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-sm text-gray-400">No rebates have been released yet.</td></tr>
              ) : releases.map(r => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{formatDateTime(r.created_at)}</td>
                  <td className="px-4 py-3 text-gray-700">
                    {formatDate(r.period_start)} – {formatDate(r.period_end)}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-700">{r.rebate_rate}%</td>
                  <td className="px-4 py-3 text-right font-semibold text-green-700">{currency(r.total_amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      {/* Release modal */}
      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="Release Loan Rebates" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Select the period over which to compute loan interest paid. Members will receive a rebate
            (configured as <code>rebate_rate</code> in System Config) of the interest they paid during
            this period, credited to their savings account.
          </p>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Period Start <span className="text-red-500">*</span></label>
            <input
              type="date"
              value={periodStart}
              onChange={e => setPeriodStart(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Period End <span className="text-red-500">*</span></label>
            <input
              type="date"
              value={periodEnd}
              onChange={e => setPeriodEnd(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <p className="text-xs text-gray-400">
            Rebates are computed from loan repayment schedule rows with status "paid" within this date range.
          </p>
          <div className="flex gap-3 pt-1">
            <Button variant="outline" className="flex-1" onClick={() => setShowModal(false)}>Cancel</Button>
            <Button
              className="flex-1"
              loading={releaseRebates.isPending}
              disabled={!periodStart || !periodEnd || periodStart >= periodEnd}
              onClick={handleRelease}
            >
              Release Rebates
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
