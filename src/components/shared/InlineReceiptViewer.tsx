import { useState } from 'react'
import { createPortal } from 'react-dom'

interface InlineReceiptViewerProps {
  url: string
}

export function InlineReceiptViewer({ url }: InlineReceiptViewerProps) {
  const [lightboxOpen, setLightboxOpen] = useState(false)

  const isPdf = /\.pdf($|\?)/i.test(url)

  if (isPdf) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800 font-medium"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
        </svg>
        Open PDF ↗
      </a>
    )
  }

  return (
    <>
      <div className="relative group">
        <img
          src={url}
          alt="Receipt"
          onClick={() => setLightboxOpen(true)}
          className="rounded-lg border border-gray-200 max-h-72 w-full object-contain bg-gray-50 cursor-zoom-in"
        />
        <span className="absolute bottom-1.5 right-1.5 text-[10px] bg-black/50 text-white rounded px-1.5 py-0.5 pointer-events-none opacity-70 group-hover:opacity-100 transition-opacity">
          Click to zoom
        </span>
      </div>

      {lightboxOpen && createPortal(
        <div
          className="fixed inset-0 z-[300] flex items-center justify-center bg-black/80 p-4"
          onClick={() => setLightboxOpen(false)}
        >
          <img
            src={url}
            alt="Receipt"
            className="max-w-full max-h-full rounded-lg shadow-2xl cursor-zoom-out object-contain"
            onClick={e => e.stopPropagation()}
          />
          <button
            onClick={() => setLightboxOpen(false)}
            className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>,
        document.body
      )}
    </>
  )
}
