import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { faqSections, AccordionItem } from '../../lib/faqData'

interface HelpModalProps {
  open: boolean
  onClose: () => void
}

export function HelpModal({ open, onClose }: HelpModalProps) {
  // Close on ESC
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-[300] flex items-end sm:items-center justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Drawer — full height on desktop (right side), bottom sheet on mobile */}
      <div className="relative w-full sm:w-[420px] sm:h-full bg-white sm:rounded-l-2xl rounded-t-2xl shadow-2xl flex flex-col max-h-[90dvh] sm:max-h-full">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <h2 className="text-base font-semibold text-gray-900">Help & FAQ</h2>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors p-1 rounded-lg hover:bg-gray-100"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
          {faqSections.map(section => (
            <div key={section.title}>
              <div className="flex items-center gap-2 mb-2.5">
                <span className="text-blue-600">{section.icon}</span>
                <h3 className="text-sm font-semibold text-gray-800">{section.title}</h3>
              </div>
              <div className="space-y-1.5">
                {section.items.map(item => (
                  <AccordionItem key={item.question} {...item} />
                ))}
              </div>
            </div>
          ))}

          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800">
            <p className="font-medium">Still have questions?</p>
            <p className="mt-0.5 text-blue-700">Contact your cooperative administrator for assistance.</p>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
