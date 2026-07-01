import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import { TOAST_EVENT } from '../lib/toast'
import type { ToastOptions, ToastVariant } from '../lib/toast'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ToastItem extends ToastOptions {
  id: string
  visible: boolean
}

interface ToastContextValue {
  toast: (options: ToastOptions) => void
}

// ─── Context ──────────────────────────────────────────────────────────────────

const ToastContext = createContext<ToastContextValue | null>(null)

// ─── Icons ────────────────────────────────────────────────────────────────────

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M13.5 4.5L6.5 11.5L3 8"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function ErrorIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M12 4L4 12M4 4l8 8"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function InfoIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 7v4M8 5.5v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path
        d="M11 3L3 11M3 3l8 8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

// ─── Variant config ───────────────────────────────────────────────────────────

const variantStyles: Record<ToastVariant, { border: string; icon: string; iconBg: string }> = {
  success: {
    border: '4px solid #22c55e',
    icon: '#22c55e',
    iconBg: '#f0fdf4',
  },
  error: {
    border: '4px solid #ef4444',
    icon: '#ef4444',
    iconBg: '#fef2f2',
  },
  info: {
    border: '4px solid #3b82f6',
    icon: '#3b82f6',
    iconBg: '#eff6ff',
  },
}

function variantIcon(variant: ToastVariant) {
  if (variant === 'success') return <CheckIcon />
  if (variant === 'error') return <ErrorIcon />
  return <InfoIcon />
}

// ─── Single Toast ─────────────────────────────────────────────────────────────

const ANIMATION_DURATION_MS = 300

interface ToastCardProps {
  item: ToastItem
  onDismiss: (id: string) => void
}

function ToastCard({ item, onDismiss }: ToastCardProps) {
  const styles = variantStyles[item.variant]

  return (
    <div
      role="alert"
      aria-live="assertive"
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: '10px',
        backgroundColor: '#ffffff',
        borderRadius: '8px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        borderLeft: styles.border,
        padding: '12px 14px',
        minWidth: '280px',
        maxWidth: '360px',
        transform: item.visible ? 'translateX(0)' : 'translateX(110%)',
        opacity: item.visible ? 1 : 0,
        transition: `transform ${ANIMATION_DURATION_MS}ms ease, opacity ${ANIMATION_DURATION_MS}ms ease`,
        pointerEvents: 'all',
      }}
    >
      {/* Icon */}
      <div
        style={{
          flexShrink: 0,
          width: '28px',
          height: '28px',
          borderRadius: '50%',
          backgroundColor: styles.iconBg,
          color: styles.icon,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginTop: '1px',
        }}
      >
        {variantIcon(item.variant)}
      </div>

      {/* Text */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <p
          style={{
            margin: 0,
            fontSize: '14px',
            fontWeight: 600,
            color: '#111827',
            lineHeight: '1.4',
          }}
        >
          {item.title}
        </p>
        {item.description && (
          <p
            style={{
              margin: '2px 0 0',
              fontSize: '13px',
              color: '#6b7280',
              lineHeight: '1.4',
            }}
          >
            {item.description}
          </p>
        )}
      </div>

      {/* Close button */}
      <button
        onClick={() => onDismiss(item.id)}
        aria-label="Dismiss notification"
        style={{
          flexShrink: 0,
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: '#9ca3af',
          padding: '2px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: '4px',
          lineHeight: 1,
        }}
      >
        <CloseIcon />
      </button>
    </div>
  )
}

// ─── Provider ─────────────────────────────────────────────────────────────────

const MAX_TOASTS = 4
const AUTO_DISMISS_MS = 4000

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  // Keep ref to avoid stale closures in the event listener
  const toastsRef = useRef(toasts)
  toastsRef.current = toasts

  const dismiss = useCallback((id: string) => {
    // Animate out first
    setToasts(prev => prev.map(t => (t.id === id ? { ...t, visible: false } : t)))
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, ANIMATION_DURATION_MS)
  }, [])

  const addToast = useCallback(
    (options: ToastOptions) => {
      const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

      setToasts(prev => {
        let next = [...prev, { ...options, id, visible: false }]
        // Enforce max: remove oldest first (they will be animated out separately)
        if (next.length > MAX_TOASTS) {
          const toRemove = next.slice(0, next.length - MAX_TOASTS)
          toRemove.forEach(t => {
            setTimeout(() => dismiss(t.id), 0)
          })
          next = next.slice(next.length - MAX_TOASTS)
        }
        return next
      })

      // Trigger slide-in on next tick so CSS transition fires
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setToasts(prev => prev.map(t => (t.id === id ? { ...t, visible: true } : t)))
        })
      })

      // Auto-dismiss
      const timer = setTimeout(() => dismiss(id), AUTO_DISMISS_MS)
      return () => clearTimeout(timer)
    },
    [dismiss]
  )

  // Listen for module-level toast() calls
  useEffect(() => {
    function handleToastEvent(e: Event) {
      const { detail } = e as CustomEvent<ToastOptions>
      addToast(detail)
    }

    window.addEventListener(TOAST_EVENT, handleToastEvent)
    return () => window.removeEventListener(TOAST_EVENT, handleToastEvent)
  }, [addToast])

  const contextValue: ToastContextValue = { toast: addToast }

  return (
    <ToastContext.Provider value={contextValue}>
      {children}

      {/* Toast container — bottom-right, stacked upward */}
      <div
        aria-label="Notifications"
        style={{
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          zIndex: 9999,
          display: 'flex',
          flexDirection: 'column-reverse',
          gap: '10px',
          pointerEvents: 'none',
        }}
      >
        {toasts.map(item => (
          <ToastCard key={item.id} item={item} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) {
    throw new Error('useToast must be used within a ToastProvider')
  }
  return ctx
}
