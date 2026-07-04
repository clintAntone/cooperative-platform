import { useState } from 'react'
import { Header } from '../../components/layout/Header'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { StatusBadge } from '../../components/shared/StatusBadge'
import { SkeletonPage } from '../../components/shared/Skeleton'
import {
  useAllBatchDeposits,
  useBatchDepositDetail,
  useApproveBatchDeposit,
  useRejectBatchDeposit,
  type BatchDeposit,
} from '../../hooks/useBatchDeposits'
import { useCurrency } from '../../hooks/useCurrency'
import { formatDate, formatDateTime } from '../../lib/utils'
import { cn } from '../../lib/utils'

type TabValue = 'pending' | 'approved' | 'rejected'

const tabs: { label: string; value: TabValue }[] = [
  { label: 'Pending', value: 'pending' },
  { label: 'Approved', value: 'approved' },
  { label: 'Rejected', value: 'rejected' },
]

function isPdf(url: string): boolean {
  return url.toLowerCase().includes('.pdf')
}

interface BatchReviewModalProps {
  batchId: string
  onClose: () => void
}

function BatchReviewModal({ batchId, onClose }: BatchReviewModalProps) {
  const { data: batch, isLoading } = useBatchDepositDetail(batchId)
  const approveBatch = useApproveBatchDeposit()
  const rejectBatch = useRejectBatchDeposit()
  const { format: currency } = useCurrency()

  const [zoom, setZoom] = useState(1)
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [confirmApprove, setConfirmApprove] = useState(false)
  const [showRejectForm, setShowRejectForm] = useState(false)
  const [rejectReason, setRejectReason] = useState('')

  const zoomIn = () => setZoom(z => Math.min(z + 0.25, 3))
  const zoomOut = () => setZoom(z => Math.max(z - 0.25, 0.5))
  const resetZoom = () => setZoom(1)

  const handleApprove = async () => {
    await approveBatch.mutateAsync(batchId)
    setConfirmApprove(false)
    onClose()
  }

  const handleReject = async () => {
    if (!rejectReason.trim()) return
    await rejectBatch.mutateAsync({ batchId, reason: rejectReason })
    setShowRejectForm(false)
    onClose()
  }

  const sortedItems = batch?.items
    ? [...batch.items].sort((a, b) => b.amount - a.amount)
    : []

  return (
    <>
      <Modal isOpen={true} onClose={onClose} title="Batch Deposit Review" size="lg">
        {isLoading || !batch ? (
          <div className="py-10 text-center text-gray-400 text-sm">Loading batch details…</div>
        ) : (
          <div className="space-y-4">
            {/* Receipt */}
            {batch.receipt_url && (
              <div className="rounded-lg overflow-hidden border border-gray-200 bg-gray-50">
                {isPdf(batch.receipt_url) ? (
                  <div className="text-center py-8">
                    <svg className="w-12 h-12 text-gray-400 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                    </svg>
                    <a
                      href={batch.receipt_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:text-blue-800 font-medium text-sm underline"
                    >
                      Open PDF Receipt
                    </a>
                  </div>
                ) : (
                  <div>
                    <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 bg-white">
                      <span className="text-xs text-gray-500">{Math.round(zoom * 100)}%</span>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={zoomOut}
                          disabled={zoom <= 0.5}
                          className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed text-gray-600"
                          title="Zoom out"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM13 10H7" />
                          </svg>
                        </button>
                        <button
                          onClick={resetZoom}
                          className="px-2 py-1 text-xs rounded hover:bg-gray-100 text-gray-600 font-medium"
                          title="Reset zoom"
                        >
                          Reset
                        </button>
                        <button
                          onClick={zoomIn}
                          disabled={zoom >= 3}
                          className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed text-gray-600"
                          title="Zoom in"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
                          </svg>
                        </button>
                        <div className="w-px h-4 bg-gray-200 mx-1" />
                        <button
                          onClick={() => setLightboxOpen(true)}
                          className="p-1.5 rounded hover:bg-gray-100 text-gray-600"
                          title="Full screen"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                          </svg>
                        </button>
                      </div>
                    </div>
                    <div
                      className="overflow-auto max-h-64 flex items-start justify-center p-2 bg-gray-50 cursor-zoom-in"
                      onClick={() => setLightboxOpen(true)}
                    >
                      <img
                        src={batch.receipt_url}
                        alt="Receipt"
                        style={{ transform: `scale(${zoom})`, transformOrigin: 'top center', transition: 'transform 0.15s ease' }}
                        className="max-w-full object-contain"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Reference callout */}
            {batch.reference && (
              <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl p-3">
                <svg className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                </svg>
                <div>
                  <p className="text-sm font-semibold text-amber-800">Verify this reference appears on the receipt</p>
                  <p className="text-xs text-amber-700 mt-0.5 font-mono">{batch.reference}</p>
                </div>
              </div>
            )}

            {/* Batch metadata */}
            <div className="divide-y divide-gray-100 rounded-lg border border-gray-100">
              <div className="flex justify-between py-2 px-3 text-sm">
                <span className="text-gray-500">Submitted by</span>
                <span className="font-medium text-gray-900">{batch.submitter_name}</span>
              </div>
              <div className="flex justify-between py-2 px-3 text-sm">
                <span className="text-gray-500">Submitted at</span>
                <span className="text-gray-900">{formatDateTime(batch.created_at)}</span>
              </div>
              <div className="flex justify-between py-2 px-3 text-sm">
                <span className="text-gray-500">Payment method</span>
                <span className="text-gray-900 capitalize">{batch.payment_method.replace('_', ' ')}</span>
              </div>
              <div className="flex justify-between py-2 px-3 text-sm">
                <span className="text-gray-500">Status</span>
                <StatusBadge status={batch.status} />
              </div>
              {batch.reviewed_at && (
                <div className="flex justify-between py-2 px-3 text-sm">
                  <span className="text-gray-500">Reviewed at</span>
                  <span className="text-gray-900">{formatDateTime(batch.reviewed_at)}</span>
                </div>
              )}
              {batch.status === 'rejected' && batch.rejection_reason && (
                <div className="py-2 px-3 text-sm">
                  <span className="text-gray-500 block mb-1">Rejection reason</span>
                  <p className="text-red-700 bg-red-50 rounded px-2 py-1">{batch.rejection_reason}</p>
                </div>
              )}
              {batch.notes && (
                <div className="py-2 px-3 text-sm">
                  <span className="text-gray-500 block mb-1">Notes</span>
                  <p className="text-gray-900">{batch.notes}</p>
                </div>
              )}
            </div>

            {/* Member breakdown table */}
            <div>
              <p className="text-sm font-medium text-gray-700 mb-2">
                Member Breakdown ({sortedItems.length} members)
              </p>
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium text-gray-600">Member</th>
                      <th className="text-right px-3 py-2 font-medium text-gray-600">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {sortedItems.map(item => (
                      <tr key={item.id} className="hover:bg-gray-50">
                        <td className="px-3 py-2 text-gray-800">{item.member_name}</td>
                        <td className="px-3 py-2 text-right font-medium text-gray-900">{currency(item.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t border-gray-200 bg-gray-50">
                    <tr>
                      <td className="px-3 py-2 text-sm font-semibold text-gray-700">Total</td>
                      <td className="px-3 py-2 text-right text-sm font-bold text-gray-900">{currency(batch.total_amount)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            {/* Actions for pending */}
            {batch.status === 'pending' && (
              <div className="flex gap-3 pt-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={onClose}
                >
                  Close
                </Button>
                <Button
                  variant="danger"
                  className="flex-1"
                  onClick={() => setShowRejectForm(true)}
                >
                  Reject
                </Button>
                <Button
                  variant="primary"
                  className="flex-1"
                  onClick={() => setConfirmApprove(true)}
                >
                  Approve
                </Button>
              </div>
            )}

            {batch.status !== 'pending' && (
              <div className="flex justify-end pt-2">
                <Button variant="secondary" onClick={onClose}>Close</Button>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Lightbox */}
      {lightboxOpen && batch?.receipt_url && (
        <div
          className="fixed inset-0 z-[200] bg-black/90 flex items-center justify-center"
          onClick={() => setLightboxOpen(false)}
        >
          <button
            className="absolute top-4 right-4 text-white/80 hover:text-white p-2 rounded-full hover:bg-white/10"
            onClick={() => setLightboxOpen(false)}
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <img
            src={batch.receipt_url}
            alt="Receipt full size"
            className="max-w-[90vw] max-h-[90vh] object-contain rounded shadow-2xl"
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}

      {/* Approve confirmation */}
      <Modal
        isOpen={confirmApprove}
        onClose={() => setConfirmApprove(false)}
        title="Confirm Batch Approval"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Are you sure you want to approve this batch? A deposit request will be created and approved for each member listed.
          </p>
          <div className="flex gap-3 pt-1">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setConfirmApprove(false)}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              className="flex-1"
              loading={approveBatch.isPending}
              onClick={handleApprove}
            >
              Confirm Approve
            </Button>
          </div>
        </div>
      </Modal>

      {/* Reject form */}
      <Modal
        isOpen={showRejectForm}
        onClose={() => { setShowRejectForm(false); setRejectReason('') }}
        title="Reject Batch Deposit"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Please provide a reason for rejecting this batch deposit.
          </p>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Rejection Reason</label>
            <textarea
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
              rows={3}
              className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Enter reason..."
              autoFocus
            />
          </div>
          <div className="flex gap-3 pt-1">
            <Button
              variant="secondary"
              onClick={() => { setShowRejectForm(false); setRejectReason('') }}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={rejectBatch.isPending}
              disabled={!rejectReason.trim()}
              onClick={handleReject}
            >
              Reject Batch
            </Button>
          </div>
        </div>
      </Modal>
    </>
  )
}

function BatchRow({ batch, onReview }: { batch: BatchDeposit; onReview: (id: string) => void }) {
  const { format: currency } = useCurrency()
  return (
    <tr className="hover:bg-gray-50">
      <td className="px-4 py-3">
        <p className="font-medium text-gray-900">{batch.submitter_name ?? '—'}</p>
      </td>
      <td className="px-4 py-3 text-gray-500 text-xs">{formatDate(batch.created_at)}</td>
      <td className="px-4 py-3 font-medium text-gray-900">{currency(batch.total_amount)}</td>
      <td className="px-4 py-3 text-gray-600">{batch.items?.length ?? 0}</td>
      <td className="px-4 py-3">
        <StatusBadge status={batch.status} />
      </td>
      <td className="px-4 py-3">
        <Button size="sm" variant="outline" onClick={() => onReview(batch.id)}>
          Review
        </Button>
      </td>
    </tr>
  )
}

function BatchCard({ batch, onReview }: { batch: BatchDeposit; onReview: (id: string) => void }) {
  const { format: currency } = useCurrency()
  return (
    <div className="p-4 space-y-2 border-b border-gray-100 last:border-0">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-medium text-sm text-gray-900">{batch.submitter_name ?? '—'}</p>
          <p className="text-xs text-gray-400 mt-0.5">{formatDate(batch.created_at)}</p>
        </div>
        <StatusBadge status={batch.status} />
      </div>
      <div className="flex items-baseline justify-between">
        <span className="text-lg font-bold text-gray-900">{currency(batch.total_amount)}</span>
        <span className="text-xs text-gray-500">{batch.items?.length ?? 0} members</span>
      </div>
      <Button size="sm" variant="outline" className="w-full" onClick={() => onReview(batch.id)}>
        Review
      </Button>
    </div>
  )
}

export function BatchDepositsPage() {
  const [activeTab, setActiveTab] = useState<TabValue>('pending')
  const [reviewBatchId, setReviewBatchId] = useState<string | null>(null)

  const { data: batches = [], isLoading } = useAllBatchDeposits(activeTab)

  if (isLoading) return <SkeletonPage cards={0} rows={6} />

  return (
    <div>
      <Header
        title="Batch Deposits"
        subtitle="Review batch deposit submissions from collectors"
      />

      <div className="p-4 sm:p-6 space-y-4">
        {/* Tabs */}
        <div className="overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0">
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-max min-w-full sm:w-fit">
            {tabs.map(tab => (
              <button
                key={tab.value}
                onClick={() => setActiveTab(tab.value)}
                className={cn(
                  'px-3 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap',
                  activeTab === tab.value
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                )}
              >
                {tab.label}
                {tab.value === 'pending' && batches.length > 0 && activeTab === 'pending' && (
                  <span className="ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-yellow-400 text-white text-[10px] font-bold">
                    {batches.length}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <Card className="overflow-hidden">
          {batches.length === 0 ? (
            <div className="py-14 text-center">
              <svg className="w-10 h-10 text-gray-300 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <p className="text-sm text-gray-400">No {activeTab} batch deposits</p>
            </div>
          ) : (
            <>
              {/* Mobile cards */}
              <div className="sm:hidden divide-y divide-gray-100">
                {batches.map(batch => (
                  <BatchCard key={batch.id} batch={batch} onReview={setReviewBatchId} />
                ))}
              </div>

              {/* Desktop table */}
              <div className="hidden sm:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Submitted By</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Date</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Total Amount</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Members</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {batches.map(batch => (
                      <BatchRow key={batch.id} batch={batch} onReview={setReviewBatchId} />
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Card>
      </div>

      {reviewBatchId && (
        <BatchReviewModal
          batchId={reviewBatchId}
          onClose={() => setReviewBatchId(null)}
        />
      )}
    </div>
  )
}
