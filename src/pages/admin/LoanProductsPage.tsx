import { useState } from 'react'
import { Header } from '../../components/layout/Header'
import { Card, CardBody, CardHeader } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input, Select } from '../../components/ui/Input'
import { Modal } from '../../components/ui/Modal'
import { useLoanProducts, useCreateLoanProduct, useUpdateLoanProduct } from '../../hooks/useLoans'
import { useCurrency } from '../../hooks/useCurrency'
import type { LoanProduct } from '../../types'

const CALC_OPTIONS = [
  { value: 'reducing_balance', label: 'Reducing Balance' },
  { value: 'flat', label: 'Flat Rate' },
]

interface ProductFormValues {
  name: string
  description: string
  interest_rate: string
  min_amount: string
  max_amount: string
  min_term_months: string
  max_term_months: string
  calculation_method: 'flat' | 'reducing_balance'
}

const emptyForm = (): ProductFormValues => ({
  name: '',
  description: '',
  interest_rate: '',
  min_amount: '0',
  max_amount: '',
  min_term_months: '1',
  max_term_months: '36',
  calculation_method: 'reducing_balance',
})

function validate(v: ProductFormValues): string | null {
  if (!v.name.trim()) return 'Product name is required'
  const rate = parseFloat(v.interest_rate)
  if (isNaN(rate) || rate <= 0) return 'Interest rate must be greater than 0'
  const minTerm = parseInt(v.min_term_months)
  const maxTerm = parseInt(v.max_term_months)
  if (minTerm < 1) return 'Min term must be at least 1 month'
  if (maxTerm < minTerm) return 'Max term must be ≥ min term'
  return null
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

  const openCreate = () => {
    setEditingId(null)
    setForm(emptyForm())
    setFormError(null)
    setShowModal(true)
  }

  const openEdit = (p: LoanProduct) => {
    setEditingId(p.id)
    setForm({
      name: p.name,
      description: p.description ?? '',
      interest_rate: String(p.interest_rate),
      min_amount: String(p.min_amount),
      max_amount: p.max_amount != null ? String(p.max_amount) : '',
      min_term_months: String(p.min_term_months),
      max_term_months: String(p.max_term_months),
      calculation_method: p.calculation_method,
    })
    setFormError(null)
    setShowModal(true)
  }

  const handleSave = async () => {
    const err = validate(form)
    if (err) { setFormError(err); return }

    const payload = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      interest_rate: parseFloat(form.interest_rate),
      min_amount: parseFloat(form.min_amount) || 0,
      max_amount: form.max_amount ? parseFloat(form.max_amount) : null,
      min_term_months: parseInt(form.min_term_months),
      max_term_months: parseInt(form.max_term_months),
      calculation_method: form.calculation_method,
      is_active: true,
    }

    if (editingId) {
      await updateProduct.mutateAsync({ id: editingId, ...payload })
    } else {
      await createProduct.mutateAsync(payload)
    }
    setShowModal(false)
  }

  const toggleActive = (p: LoanProduct) => {
    updateProduct.mutate({ id: p.id, is_active: !p.is_active })
  }

  const field = (key: keyof ProductFormValues) => ({
    value: form[key] as string,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm(prev => ({ ...prev, [key]: e.target.value })),
  })

  return (
    <div>
      <Header
        title="Loan Products"
        subtitle="Define loan products that members can apply for"
        actions={
          <Button size="sm" onClick={openCreate}>
            + New Product
          </Button>
        }
      />

      <div className="p-4 sm:p-6">
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
            {products.map(p => (
              <Card key={p.id} className={p.is_active ? '' : 'opacity-60'}>
                <CardHeader
                  action={
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                      p.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                    }`}>
                      {p.is_active ? 'Active' : 'Inactive'}
                    </span>
                  }
                >
                  <h3 className="font-semibold text-gray-900 truncate">{p.name}</h3>
                </CardHeader>
                <CardBody className="space-y-3">
                  {p.description && (
                    <p className="text-xs text-gray-500 line-clamp-2">{p.description}</p>
                  )}
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                    <div>
                      <p className="text-xs text-gray-400">Interest Rate</p>
                      <p className="text-sm font-semibold text-gray-900">{p.interest_rate}% p.a.</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-400">Method</p>
                      <p className="text-sm font-semibold text-gray-900 capitalize">{p.calculation_method.replace('_', ' ')}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-400">Amount</p>
                      <p className="text-sm font-semibold text-gray-900">
                        {p.min_amount > 0 ? `${currency(p.min_amount)}+` : 'Any'}
                        {p.max_amount ? ` – ${currency(p.max_amount)}` : ''}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-400">Term</p>
                      <p className="text-sm font-semibold text-gray-900">{p.min_term_months}–{p.max_term_months} months</p>
                    </div>
                  </div>
                  <div className="flex gap-3 pt-2 border-t border-gray-100">
                    <button
                      onClick={() => openEdit(p)}
                      className="text-xs text-blue-600 hover:underline font-medium"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => toggleActive(p)}
                      disabled={updateProduct.isPending}
                      className={`text-xs font-medium hover:underline ${p.is_active ? 'text-gray-500' : 'text-green-700'}`}
                    >
                      {p.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                  </div>
                </CardBody>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Modal
        isOpen={showModal}
        title={editingId ? 'Edit Loan Product' : 'New Loan Product'}
        onClose={() => setShowModal(false)}
        size="sm"
      >
        <div className="space-y-4">
          <Input
            label="Product Name"
            required
            placeholder="e.g. Regular Loan, Emergency Loan"
            {...field('name')}
          />
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-700">Description</label>
            <textarea
              rows={2}
              placeholder="Brief description (optional)"
              className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              {...field('description')}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Interest Rate (% p.a.)"
              type="number"
              step="0.01"
              min="0.01"
              required
              placeholder="12"
              {...field('interest_rate')}
            />
            <Select
              label="Calculation Method"
              options={CALC_OPTIONS}
              {...field('calculation_method')}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Min Amount"
              type="number"
              step="0.01"
              min="0"
              placeholder="0 (no minimum)"
              {...field('min_amount')}
            />
            <Input
              label="Max Amount"
              type="number"
              step="0.01"
              min="0"
              placeholder="Leave blank for no limit"
              {...field('max_amount')}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Min Term (months)"
              type="number"
              step="1"
              min="1"
              required
              {...field('min_term_months')}
            />
            <Input
              label="Max Term (months)"
              type="number"
              step="1"
              min="1"
              required
              {...field('max_term_months')}
            />
          </div>
          {formError && <p className="text-sm text-red-600">{formError}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={() => setShowModal(false)}>Cancel</Button>
            <Button
              onClick={handleSave}
              loading={createProduct.isPending || updateProduct.isPending}
            >
              {editingId ? 'Save Changes' : 'Create Product'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
