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

/** Convert stored rate + period to a monthly decimal rate */
export function toMonthlyRate(rate: number, period: 'monthly' | 'annual'): number {
  return period === 'monthly' ? rate / 100 : rate / 100 / 12
}

export function calculateMonthlyPayment(
  principal: number,
  rate: number,
  termMonths: number,
  method: 'flat' | 'reducing_balance' | 'equal_principal',
  ratePeriod: 'monthly' | 'annual' = 'annual'
): number {
  if (principal <= 0 || termMonths <= 0) return 0
  const r = toMonthlyRate(rate, ratePeriod)
  if (method === 'flat') {
    const totalInterest = principal * r * termMonths
    return (principal + totalInterest) / termMonths
  } else if (method === 'equal_principal') {
    const principalPerMonth = principal / termMonths
    return principalPerMonth + principal * r
  } else {
    if (r === 0) return principal / termMonths
    return (principal * r * Math.pow(1 + r, termMonths)) / (Math.pow(1 + r, termMonths) - 1)
  }
}

export function calculateTotalRepayable(
  principal: number,
  rate: number,
  termMonths: number,
  method: 'flat' | 'reducing_balance' | 'equal_principal',
  ratePeriod: 'monthly' | 'annual' = 'annual'
): number {
  if (principal <= 0 || termMonths <= 0) return 0
  const r = toMonthlyRate(rate, ratePeriod)
  if (method === 'flat') {
    return principal + principal * r * termMonths
  } else if (method === 'equal_principal') {
    return principal + r * principal * (termMonths + 1) / 2
  } else {
    const monthly = calculateMonthlyPayment(principal, rate, termMonths, method, ratePeriod)
    return monthly * termMonths
  }
}

export function calcFee(
  principal: number,
  type: 'fixed' | 'percentage' | null,
  value: number | null
): number {
  if (!type || value == null || value <= 0) return 0
  return type === 'fixed' ? value : principal * value / 100
}

export function calculateProductFees(
  principal: number,
  product: {
    processing_fee_type: 'fixed' | 'percentage' | null
    processing_fee_value: number | null
    insurance_type: 'fixed' | 'percentage' | null
    insurance_value: number | null
    service_fee_type: 'fixed' | 'percentage' | null
    service_fee_value: number | null
    cbu_type: 'fixed' | 'percentage' | null
    cbu_value: number | null
  }
) {
  const processingFee = calcFee(principal, product.processing_fee_type, product.processing_fee_value)
  const insurance = calcFee(principal, product.insurance_type, product.insurance_value)
  const serviceFee = calcFee(principal, product.service_fee_type, product.service_fee_value)
  const cbuMonthly = calcFee(principal, product.cbu_type, product.cbu_value)
  const totalUpfront = processingFee + insurance + serviceFee
  return { processingFee, insurance, serviceFee, cbuMonthly, totalUpfront, netProceeds: principal - totalUpfront }
}

export function formatInterestLabel(
  rate: number,
  period: 'monthly' | 'annual',
  method: 'flat' | 'reducing_balance' | 'equal_principal'
): string {
  const methodLabel = method === 'flat' ? 'flat' : method === 'reducing_balance' ? 'reducing balance' : 'equal principal'
  const periodLabel = period === 'monthly' ? '/month' : ' p.a.'
  return `${rate}%${periodLabel} ${methodLabel}`
}

export function isOverdue(dueDateStr: string): boolean {
  return new Date(dueDateStr) < new Date()
}
