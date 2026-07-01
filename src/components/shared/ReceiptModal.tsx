import { useState } from 'react'
import { Modal } from '../ui/Modal'
import { formatDate } from '../../lib/utils'

interface ReceiptDetails {
  amount: string
  date: string
  method: string
  reference?: string | null
  notes?: string | null
}

interface ReceiptModalProps {
  isOpen: boolean
  onClose: () => void
  receiptUrl: string
  details: ReceiptDetails
}

function isPdf(url: string): boolean {
  return url.toLowerCase().includes('.pdf')
}

export function ReceiptModal({ isOpen, onClose, receiptUrl, details }: ReceiptModalProps) {
  const [zoom, setZoom] = useState(1)
  const [lightboxOpen, setLightboxOpen] = useState(false)

  const zoomIn = () => setZoom(z => Math.min(z + 0.25, 3))
  const zoomOut = () => setZoom(z => Math.max(z - 0.25, 0.5))
  const resetZoom = () => setZoom(1)

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose} title="Receipt" size="lg">
        <div className="space-y-4">
          {/* Receipt image or PDF link */}
          <div className="rounded-lg overflow-hidden border border-gray-200 bg-gray-50">
            {isPdf(receiptUrl) ? (
              <div className="text-center py-8">
                <svg className="w-12 h-12 text-gray-400 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
                <a
                  href={receiptUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:text-blue-800 font-medium text-sm underline"
                >
                  Open PDF Receipt
                </a>
              </div>
            ) : (
              <div>
                {/* Zoom controls */}
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

                {/* Scrollable image area */}
                <div className="overflow-auto max-h-80 flex items-start justify-center p-2 bg-gray-50 cursor-zoom-in" onClick={() => setLightboxOpen(true)}>
                  <img
                    src={receiptUrl}
                    alt="Receipt"
                    style={{ transform: `scale(${zoom})`, transformOrigin: 'top center', transition: 'transform 0.15s ease' }}
                    className="max-w-full object-contain"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Detail fields */}
          <div className="divide-y divide-gray-100">
            <div className="flex justify-between py-2 text-sm">
              <span className="text-gray-500">Amount</span>
              <span className="font-medium text-gray-900">{details.amount}</span>
            </div>
            <div className="flex justify-between py-2 text-sm">
              <span className="text-gray-500">Date</span>
              <span className="text-gray-900">{formatDate(details.date)}</span>
            </div>
            <div className="flex justify-between py-2 text-sm">
              <span className="text-gray-500">Payment Method</span>
              <span className="text-gray-900 capitalize">{details.method.replace('_', ' ')}</span>
            </div>
            {details.reference && (
              <div className="flex justify-between py-2 text-sm">
                <span className="text-gray-500">Reference</span>
                <span className="text-gray-900 font-mono text-xs">{details.reference}</span>
              </div>
            )}
            {details.notes && (
              <div className="py-2 text-sm">
                <span className="text-gray-500 block mb-1">Notes</span>
                <p className="text-gray-900">{details.notes}</p>
              </div>
            )}
          </div>
        </div>
      </Modal>

      {/* Lightbox — full screen receipt */}
      {lightboxOpen && (
        <div
          className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center"
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
            src={receiptUrl}
            alt="Receipt full size"
            className="max-w-[90vw] max-h-[90vh] object-contain rounded shadow-2xl"
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}
    </>
  )
}
