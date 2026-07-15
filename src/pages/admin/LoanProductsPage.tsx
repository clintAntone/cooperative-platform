import { useState } from 'react'
import { Header } from '../../components/layout/Header'
import { Card, CardBody } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { useLoanProducts, useCreateLoanProduct, useUpdateLoanProduct } from '../../hooks/useLoans'
import { useCurrency } from '../../hooks/useCurrency'
import { formatInterestLabel } from '../../lib/utils'
import { exportToExcel } from '../../lib/exportExcel'
import type { LoanProduct } from '../../types'
import { PageGuide } from '../../components/shared/PageGuide'

const CALC_OPTIONS = [
  { value: 'reducing_balance', label: 'Reducing Balance' },
  { value: 'flat', label: 'Flat Rate' },
  { value: 'equal_principal', label: 'Equal Principal' },
]

const FREQUENCY_OPTIONS = [
  { value: 'monthly',     label: 'Monthly' },
  { value: 'semi_monthly', label: 'Semi-Monthly (twice/month)' },
  { value: 'bi_weekly',   label: 'Bi-Weekly (every 2 weeks)' },
  { value: 'weekly',      label: 'Weekly' },
]

const FREQUENCY_LABELS: Record<string, string> = {
  monthly:      'Monthly',
  semi_monthly: 'Semi-Monthly',
  bi_weekly:    'Bi-Weekly',
  weekly:       'Weekly',
}

const FEE_TYPE_OPTIONS = [
  { value: '', label: 'None' },
  { value: 'fixed', label: 'Fixed Amount' },
  { value: 'percentage', label: 'Percentage (%)' },
]

interface FeeField {
  type: 'fixed' | 'percentage' | ''
  value: string
}

interface ProductFormValues {
  name: string
  description: string
  interest_rate: string
  interest_rate_period: 'monthly' | 'annual'
  calculation_method: 'flat' | 'reducing_balance' | 'equal_principal'
  repayment_frequency: 'weekly' | 'bi_weekly' | 'semi_monthly' | 'monthly'
  min_amount: string
  max_amount: string
  min_term_months: string
  max_term_months: string
  processing_fee: FeeField
  insurance: FeeField
  service_fee: FeeField
  cbu: FeeField
}

const emptyFee = (): FeeField => ({ type: '', value: '' })

const emptyForm = (): ProductFormValues => ({
  name: '',
  description: '',
  interest_rate: '',
  interest_rate_period: 'annual',
  calculation_method: 'reducing_balance',
  repayment_frequency: 'monthly',
  min_amount: '0',
  max_amount: '',
  min_term_months: '1',
  max_term_months: '36',
  processing_fee: emptyFee(),
  insurance: emptyFee(),
  service_fee: emptyFee(),
  cbu: emptyFee(),
})

function feeFromProduct(
  type: 'fixed' | 'percentage' | null | undefined,
  value: number | null | undefined
): FeeField {
  return { type: type ?? '', value: value != null ? String(value) : '' }
}

function validate(v: ProductFormValues): string | null {
  if (!v.name.trim()) return 'Product name is required'
  const rate = parseFloat(v.interest_rate)
  if (isNaN(rate) || rate <= 0) return 'Interest rate must be greater than 0'
  const minTerm = parseInt(v.min_term_months)
  const maxTerm = parseInt(v.max_term_months)
  if (minTerm < 1) return 'Min term must be at least 1 month'
  if (maxTerm < minTerm) return 'Max term must be ≥ min term'
  for (const [label, fee] of [
    ['Processing fee', v.processing_fee],
    ['Insurance', v.insurance],
    ['Service fee', v.service_fee],
    ['CBU', v.cbu],
  ] as [string, FeeField][]) {
    if (fee.type && (!fee.value || parseFloat(fee.value) <= 0)) {
      return `${label}: enter a value greater than 0`
    }
  }
  return null
}

function feePayload(fee: FeeField) {
  if (!fee.type) return { type: null as null, value: null as null }
  return { type: fee.type as 'fixed' | 'percentage', value: parseFloat(fee.value) || 0 }
}

export function LoanProductsPage() {
  const { data: products = [], isLoading } = useLoanProducts()
  const createProduct = useCreateLoanProduct()
  const updateProduct = useUpdateLoanProduct()
  const { format: currency } = useCurrency()

  const [showModal, setShowModal] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<ProductFormValues>(emptyForm())
  const [formError, setFormError] = useState<string | null>(null)
  const [showFees, setShowFees] = useState(false)

  const openCreate = () => {
    setEditingId(null)
    setForm(emptyForm())
    setFormError(null)
    setShowFees(false)
    setShowModal(true)
  }

  const openEdit = (p: LoanProduct) => {
    setEditingId(p.id)
    const hasFees = !!(p.processing_fee_type || p.insurance_type || p.service_fee_type || p.cbu_type)
    setForm({
      name: p.name,
      description: p.description ?? '',
      interest_rate: String(p.interest_rate),
      interest_rate_period: p.interest_rate_period ?? 'annual',
      calculation_method: p.calculation_method,
      repayment_frequency: p.repayment_frequency ?? 'monthly',
      min_amount: String(p.min_amount),
      max_amount: p.max_amount != null ? String(p.max_amount) : '',
      min_term_months: String(p.min_term_months),
      max_term_months: String(p.max_term_months),
      processing_fee: feeFromProduct(p.processing_fee_type, p.processing_fee_value),
      insurance: feeFromProduct(p.insurance_type, p.insurance_value),
      service_fee: feeFromProduct(p.service_fee_type, p.service_fee_value),
      cbu: feeFromProduct(p.cbu_type, p.cbu_value),
    })
    setFormError(null)
    setShowFees(hasFees)
    setShowModal(true)
  }

  const handleSave = async () => {
    const err = validate(form)
    if (err) { setFormError(err); return }

    const pf = feePayload(form.processing_fee)
    const ins = feePayload(form.insurance)
    const sf = feePayload(form.service_fee)
    const cbu = feePayload(form.cbu)

    const payload = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      interest_rate: parseFloat(form.interest_rate),
      interest_rate_period: form.interest_rate_period,
      calculation_method: form.calculation_method,
      repayment_frequency: form.repayment_frequency,
      min_amount: parseFloat(form.min_amount) || 0,
      max_amount: form.max_amount ? parseFloat(form.max_amount) : null,
      min_term_months: parseInt(form.min_term_months),
      max_term_months: parseInt(form.max_term_months),
      is_active: true,
      processing_fee_type: pf.type,
      processing_fee_value: pf.value,
      insurance_type: ins.type,
      insurance_value: ins.value,
      service_fee_type: sf.type,
      service_fee_value: sf.value,
      cbu_type: cbu.type,
      cbu_value: cbu.value,
    }

    if (editingId) {
      await updateProduct.mutateAsync({ id: editingId, ...payload })
    } else {
      await createProduct.mutateAsync(payload as any)
    }
    setShowModal(false)
  }

  const toggleActive = (p: LoanProduct) => {
    updateProduct.mutate({ id: p.id, is_active: !p.is_active })
  }

  const setFee = (key: 'processing_fee' | 'insurance' | 'service_fee' | 'cbu', sub: Partial<FeeField>) => {
    setForm(prev => ({ ...prev, [key]: { ...prev[key], ...sub } }))
  }

  function productFeesSummary(p: LoanProduct): string[] {
    const lines: string[] = []
    if (p.processing_fee_type) lines.push(`Processing: ${p.processing_fee_type === 'fixed' ? currency(p.processing_fee_value ?? 0) : `${p.processing_fee_value}%`}`)
    if (p.insurance_type) lines.push(`Insurance: ${p.insurance_type === 'fixed' ? currency(p.insurance_value ?? 0) : `${p.insurance_value}%`}`)
    if (p.service_fee_type) lines.push(`Service: ${p.service_fee_type === 'fixed' ? currency(p.service_fee_value ?? 0) : `${p.service_fee_value}%`}`)
    if (p.cbu_type) lines.push(`CBU/mo: ${p.cbu_type === 'fixed' ? currency(p.cbu_value ?? 0) : `${p.cbu_value}%`}`)
    return lines
  }

  return (
    <div>
      <Header
        title="Loan Products"
        subtitle="Define loan products that members can apply for"
        actions={
          <div className="flex items-center gap-2">
            {products.length > 0 && (
              <button
                onClick={() => {
                  const rows = products.map(p => ({
                    Name: p.name,
                    Description: p.description ?? '',
                    'Interest Rate': p.interest_rate,
                    Period: p.interest_rate_period ?? 'annual',
                    Method: p.calculation_method,
                    'Min Amount': p.min_amount,
                    'Max Amount': p.max_amount ?? '',
                    'Min Term (mo)': p.min_term_months,
                    'Max Term (mo)': p.max_term_months,
                    Status: p.is_active ? 'Active' : 'Inactive',
                  }))
                  exportToExcel(rows, 'loan-products')
                }}
                title="Export to Excel"
                className="inline-flex items-center justify-center w-9 h-9 border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" />
                </svg>
              </button>
            )}
            <button
              onClick={openCreate}
              title="New Product"
              className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors shadow-sm"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
            </button>
          </div>
        }
      />

      <div className="p-4 sm:p-6 space-y-4">
        <PageGuide
          storageKey="loan-products"
          steps={[
            'Loan products define the terms available to members: interest rate, calculation method, and repayment term range.',
            'Create a product before any loans can be applied for — members pick a product when applying.',
            "Set the interest rate to 3.33% monthly (flat) to match cooperative policy. The method should be 'flat'.",
            'Deactivating a product hides it from new applications but does not affect existing loans.',
          ]}
          note="Run migration 46_loan_product_rate_fix.sql in the Supabase SQL editor to bulk-update existing products to the correct rate."
        />
        {isLoading ? (
          <p className="text-sm text-gray-400 py-12 text-center">Loading…</p>
        ) : products.length === 0 ? (
          <Card>
            <CardBody className="py-16 text-center">
              <div className="w-14 h-14 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-7 h-7 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75}
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <h3 className="text-base font-semibold text-gray-900 mb-1">No loan products yet</h3>
              <p className="text-sm text-gray-500 mb-5 max-w-xs mx-auto">
                Create at least one active loan product to enable members to apply for loans.
              </p>
              <Button onClick={openCreate}>Create First Product</Button>
            </CardBody>
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {products.map(p => {
              const fees = productFeesSummary(p)
              return (
                <div key={p.id} className={`bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden flex flex-col ${p.is_active ? '' : 'opacity-60'}`}>
                  {/* Color accent bar */}
                  <div className={`h-1 w-full ${p.is_active ? 'bg-blue-500' : 'bg-gray-300'}`} />

                  {/* Card body */}
                  <div className="p-4 flex flex-col gap-3 flex-1">
                    {/* Title row */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="font-semibold text-gray-900 leading-tight">{p.name}</h3>
                        {p.description && p.description !== p.name && (
                          <p className="text-xs text-gray-400 mt-0.5 line-clamp-1">{p.description}</p>
                        )}
                      </div>
                      <span className={`flex-shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        p.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                      }`}>
                        {p.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </div>

                    {/* Interest highlight */}
                    <div className="rounded-lg bg-blue-50 border border-blue-100 px-3 py-2.5 flex items-center justify-between">
                      <div>
                        <p className="text-xs text-blue-500 font-medium mb-0.5">Interest Rate</p>
                        <p className="text-sm font-bold text-blue-900">
                          {formatInterestLabel(p.interest_rate, p.interest_rate_period ?? 'annual', p.calculation_method)}
                        </p>
                      </div>
                      <svg className="w-5 h-5 text-blue-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>

                    {/* Term + Amount + Frequency stats */}
                    <div className="grid grid-cols-3 divide-x divide-gray-100 rounded-lg border border-gray-100 overflow-hidden">
                      <div className="px-3 py-2">
                        <p className="text-xs text-gray-400">Term</p>
                        <p className="text-sm font-semibold text-gray-800 mt-0.5">{p.min_term_months}–{p.max_term_months} <span className="font-normal text-gray-500">mo</span></p>
                      </div>
                      <div className="px-3 py-2">
                        <p className="text-xs text-gray-400">Loanable</p>
                        <p className="text-sm font-semibold text-gray-800 mt-0.5 truncate" title={p.max_amount ? currency(p.max_amount) : 'Unlimited'}>
                          {p.max_amount ? currency(p.max_amount) : 'Unlimited'}
                        </p>
                      </div>
                      <div className="px-3 py-2">
                        <p className="text-xs text-gray-400">Schedule</p>
                        <p className="text-sm font-semibold text-gray-800 mt-0.5">{FREQUENCY_LABELS[p.repayment_frequency ?? 'monthly']}</p>
                      </div>
                    </div>

                    {/* Fees pills */}
                    {fees.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {fees.map(f => (
                          <span key={f} className="inline-flex items-center px-2 py-0.5 rounded-md bg-gray-100 text-xs text-gray-600">{f}</span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Actions footer */}
                  <div className="border-t border-gray-100 px-4 py-2.5 flex gap-4 bg-gray-50">
                    <button onClick={() => openEdit(p)} className="text-xs text-blue-600 hover:text-blue-800 font-medium transition-colors">
                      Edit
                    </button>
                    <button
                      onClick={() => toggleActive(p)}
                      disabled={updateProduct.isPending}
                      className={`text-xs font-medium transition-colors ${p.is_active ? 'text-gray-400 hover:text-gray-600' : 'text-green-600 hover:text-green-800'}`}
                    >
                      {p.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <Modal
        isOpen={showModal}
        title={editingId ? 'Edit Loan Product' : 'New Loan Product'}
        onClose={() => setShowModal(false)}
        size="lg"
      >
        <div className="space-y-4">
          {/* Name + Description */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                Product Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                placeholder="e.g. Regular Loan"
                value={form.name}
                onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                Description <span className="text-gray-400 font-normal normal-case">(optional)</span>
              </label>
              <input
                type="text"
                placeholder="Shown to members"
                value={form.description}
                onChange={e => setForm(prev => ({ ...prev, description: e.target.value }))}
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Interest */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Interest</label>
            <div className="rounded-xl border border-gray-200 divide-y divide-gray-100 overflow-hidden">
              {/* Method row */}
              <div className="grid grid-cols-[4rem_1fr] items-center gap-3 px-3 py-2.5 bg-gray-50">
                <span className="text-xs font-medium text-gray-500">Method</span>
                <select
                  value={form.calculation_method}
                  onChange={e => setForm(prev => ({ ...prev, calculation_method: e.target.value as any }))}
                  className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {CALC_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
              {/* Rate + Period row */}
              <div className="grid grid-cols-[4rem_1fr] items-center gap-3 px-3 py-2.5">
                <span className="text-xs font-medium text-gray-500">Rate <span className="text-red-500">*</span></span>
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="relative w-24 flex-shrink-0">
                    <input type="number" step="0.01" min="0.01" placeholder="0"
                      value={form.interest_rate}
                      onChange={e => setForm(prev => ({ ...prev, interest_rate: e.target.value }))}
                      className="block w-full rounded-lg border border-gray-300 pl-3 pr-6 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">%</span>
                  </div>
                  <select
                    value={form.interest_rate_period}
                    onChange={e => setForm(prev => ({ ...prev, interest_rate_period: e.target.value as any }))}
                    className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="monthly">Monthly</option>
                    <option value="annual">Annual</option>
                  </select>
                  {form.interest_rate && parseFloat(form.interest_rate) > 0 && (
                    <span className="text-xs font-semibold text-blue-600">
                      = {formatInterestLabel(parseFloat(form.interest_rate), form.interest_rate_period, form.calculation_method)}
                    </span>
                  )}
                </div>
              </div>
              {/* Repayment frequency row */}
              <div className="grid grid-cols-[4rem_1fr] items-center gap-3 px-3 py-2.5 bg-gray-50">
                <span className="text-xs font-medium text-gray-500">Schedule</span>
                <select
                  value={form.repayment_frequency}
                  onChange={e => setForm(prev => ({ ...prev, repayment_frequency: e.target.value as any }))}
                  className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {FREQUENCY_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Loan Range */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Loan Range</label>
            <div className="rounded-xl border border-gray-200 overflow-hidden divide-y divide-gray-100">
              {/* Amount row */}
              <div className="grid grid-cols-2 divide-x divide-gray-100">
                <div className="px-3 py-2.5">
                  <label className="block text-xs text-gray-400 mb-1">Min Amount</label>
                  <input type="number" step="0.01" min="0" placeholder="0"
                    value={form.min_amount} onChange={e => setForm(prev => ({ ...prev, min_amount: e.target.value }))}
                    className="block w-full rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white" />
                </div>
                <div className="px-3 py-2.5">
                  <label className="block text-xs text-gray-400 mb-1">Max Amount</label>
                  <input type="number" step="0.01" min="0" placeholder="No limit"
                    value={form.max_amount} onChange={e => setForm(prev => ({ ...prev, max_amount: e.target.value }))}
                    className="block w-full rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white" />
                </div>
              </div>
              {/* Term row */}
              <div className="grid grid-cols-2 divide-x divide-gray-100 bg-gray-50">
                <div className="px-3 py-2.5">
                  <label className="block text-xs text-gray-400 mb-1">Min Term <span className="text-red-500">*</span> <span className="text-gray-300">(months)</span></label>
                  <input type="number" step="1" min="1"
                    value={form.min_term_months} onChange={e => setForm(prev => ({ ...prev, min_term_months: e.target.value }))}
                    className="block w-full rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div className="px-3 py-2.5">
                  <label className="block text-xs text-gray-400 mb-1">Max Term <span className="text-red-500">*</span> <span className="text-gray-300">(months)</span></label>
                  <input type="number" step="1" min="1"
                    value={form.max_term_months} onChange={e => setForm(prev => ({ ...prev, max_term_months: e.target.value }))}
                    className="block w-full rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
            </div>
          </div>

          {/* Fees — collapsible */}
          <div>
            <button
              type="button"
              onClick={() => setShowFees(v => !v)}
              className="flex items-center justify-between w-full group"
            >
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide cursor-pointer">
                Fees <span className="font-normal normal-case text-gray-400">(optional)</span>
              </label>
              <span className="flex items-center gap-1 text-xs text-blue-600 group-hover:text-blue-800">
                {showFees ? 'Hide' : 'Configure'}
                <svg className={`w-3.5 h-3.5 transition-transform ${showFees ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </span>
            </button>
            {showFees && (
              <div className="mt-2 rounded-xl border border-gray-200 overflow-hidden divide-y divide-gray-100">
                <div className="grid grid-cols-[1fr_120px_80px] gap-2 px-3 py-1.5 bg-gray-100">
                  <span className="text-xs font-medium text-gray-500">Fee</span>
                  <span className="text-xs font-medium text-gray-500">Type</span>
                  <span className="text-xs font-medium text-gray-500">Amount</span>
                </div>
                {([
                  { key: 'processing_fee' as const, label: 'Processing', hint: 'One-time' },
                  { key: 'insurance' as const, label: 'Insurance', hint: 'One-time' },
                  { key: 'service_fee' as const, label: 'Service Fee', hint: 'One-time' },
                  { key: 'cbu' as const, label: 'CBU', hint: 'Monthly' },
                ]).map(({ key, label, hint }) => {
                  const fee = form[key]
                  return (
                    <div key={key} className="grid grid-cols-[1fr_120px_80px] gap-2 items-center bg-white px-3 py-2">
                      <div className="min-w-0">
                        <span className="text-xs font-medium text-gray-800">{label}</span>
                        <span className="text-xs text-gray-400 ml-1">{hint}</span>
                      </div>
                      <select value={fee.type}
                        onChange={e => setFee(key, { type: e.target.value as any })}
                        className="block w-full rounded-md border border-gray-300 px-1.5 py-1 text-xs text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        {FEE_TYPE_OPTIONS.map(o => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                      <div className="relative">
                        <input type="number" step="0.01" min="0"
                          value={fee.value}
                          disabled={!fee.type}
                          onChange={e => setFee(key, { value: e.target.value })}
                          placeholder="0"
                          className="block w-full rounded-md border border-gray-300 pl-2 pr-5 py-1 text-xs text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-40 disabled:bg-gray-50"
                        />
                        {fee.type === 'percentage' && (
                          <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-xs text-gray-400">%</span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {formError && (
            <div className="flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2">
              <svg className="w-4 h-4 text-red-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <p className="text-sm text-red-700">{formError}</p>
            </div>
          )}
          <div className="flex justify-end gap-3 pt-1">
            <Button variant="secondary" onClick={() => setShowModal(false)}>Cancel</Button>
            <Button onClick={handleSave} loading={createProduct.isPending || updateProduct.isPending}>
              {editingId ? 'Save Changes' : 'Create Product'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
