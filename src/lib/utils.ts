export function formatCurrency(amount: number, symbol = '₱'): string {
  const formatted = new Intl.NumberFormat('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
  return `${symbol}${formatted}`
}

export function formatDate(dateStr: string): string {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(dateStr))
}

export function formatDateTime(dateStr: string): string {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(dateStr))
}

export function formatPercent(value: number): string {
  return `${Math.round(value)}%`
}

export function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(' ')
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-PH').format(Math.round(value))
}

export function getProgressPercent(paid: number, target: number): number {
  if (target <= 0) return 0
  return Math.min(100, Math.round((paid / target) * 100))
}

export function calculateMonthlyPayment(
  principal: number,
  annualRate: number,
  termMonths: number,
  method: 'flat' | 'reducing_balance'
): number {
  if (method === 'flat') {
    const totalInterest = principal * (annualRate / 100) * (termMonths / 12)
    return (principal + totalInterest) / termMonths
  } else {
    // Reducing balance (EMI formula)
    const r = annualRate / 100 / 12
    if (r === 0) return principal / termMonths
    return (principal * r * Math.pow(1 + r, termMonths)) / (Math.pow(1 + r, termMonths) - 1)
  }
}

export function calculateTotalRepayable(
  principal: number,
  annualRate: number,
  termMonths: number,
  method: 'flat' | 'reducing_balance'
): number {
  const monthly = calculateMonthlyPayment(principal, annualRate, termMonths, method)
  return monthly * termMonths
}

export function isOverdue(dueDateStr: string): boolean {
  return new Date(dueDateStr) < new Date()
}
