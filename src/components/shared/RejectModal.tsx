import { useState, useEffect } from 'react'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'

interface RejectModalProps {
  isOpen: boolean
  onClose: () => void
  title?: string
  description?: React.ReactNode
  reasonLabel?: string
  reasonPlaceholder?: string
  confirmLabel?: string
  isLoading?: boolean
  onConfirm: (reason: string) => void
}

/**
 * Generic rejection modal with a required reason textarea.
 * Used across deposit requests, savings deposits, withdrawals, share transfers, etc.
 */
export function RejectModal({
  isOpen,
  onClose,
  title = 'Reject Request',
  description,
  reasonLabel = 'Reason',
  reasonPlaceholder = 'Provide a reason for rejection…',
  confirmLabel = 'Reject',
  isLoading = false,
  onConfirm,
}: RejectModalProps) {
  const [reason, setReason] = useState('')

  // Reset reason when modal opens
  useEffect(() => {
    if (isOpen) setReason('')
  }, [isOpen])

  const handleConfirm = () => {
    if (!reason.trim()) return
    onConfirm(reason.trim())
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="sm">
      <div className="space-y-4">
        {description && (
          <p className="text-sm text-gray-600">{description}</p>
        )}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {reasonLabel} <span className="text-red-500">*</span>
          </label>
          <textarea
            rows={3}
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder={reasonPlaceholder}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500 resize-none"
            autoFocus
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleConfirm()
              if (e.key === 'Escape') onClose()
            }}
          />
        </div>
        <div className="flex gap-3">
          <Button variant="outline" className="flex-1" onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button
            variant="danger"
            className="flex-1"
            loading={isLoading}
            disabled={!reason.trim()}
            onClick={handleConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
