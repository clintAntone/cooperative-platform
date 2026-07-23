import React, { useEffect } from 'react'
import { cn } from '../../lib/utils'

interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title?: string
  children: React.ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl'
}

const sizeClasses = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
}

const CloseButton = ({ onClose }: { onClose: () => void }) => (
  <button
    onClick={onClose}
    aria-label="Close"
    className="p-1 text-gray-400 hover:text-gray-600 rounded-md hover:bg-gray-100 transition-colors"
  >
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  </button>
)

export function Modal({ isOpen, onClose, title, children, size = 'md' }: ModalProps) {
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.body.style.overflow = ''
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black bg-opacity-60" onClick={onClose} />
      {/* Modal panel */}
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          'relative z-[101] w-full mx-4 bg-white rounded-xl shadow-xl',
          sizeClasses[size]
        )}
      >
        {title ? (
          <>
            {/* Header with title */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
              <CloseButton onClose={onClose} />
            </div>
            <div className="px-6 py-4 overflow-y-auto max-h-[calc(100vh-10rem)]">{children}</div>
          </>
        ) : (
          <>
            {/* No title — close button floats top-right over content */}
            <div className="absolute top-3 right-3 z-10">
              <CloseButton onClose={onClose} />
            </div>
            <div className="px-6 pt-10 pb-6 overflow-y-auto max-h-[calc(100vh-6rem)]">{children}</div>
          </>
        )}
      </div>
    </div>
  )
}
