export type ToastVariant = 'success' | 'error' | 'info'

export interface ToastOptions {
  title: string
  description?: string
  variant: ToastVariant
}

const TOAST_EVENT = 'app:toast'

export function toast(options: ToastOptions): void {
  window.dispatchEvent(new CustomEvent<ToastOptions>(TOAST_EVENT, { detail: options }))
}

export { TOAST_EVENT }
