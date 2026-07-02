import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { useCreateLoanApplication, useEligibleCoMakers, useActiveLoanProducts } from '../../hooks/useLoans'
import { supabase } from '../../lib/supabase'
import { calculateTotalRepayable, calculateMonthlyPayment, formatInterestLabel } from '../../lib/utils'
import { useCurrency } from '../../hooks/useCurrency'
import { useAuth } from '../../context/AuthContext'
import { useLoanEligibility } from '../../hooks/useLoanEligibility'
import type { EligibleCoMaker, LoanProduct } from '../../types'

const schema = z.object({
  amount_requested: z
    .number({ invalid_type_error: 'Please enter a valid amount' })
    .positive('Amount must be greater than 0'),
  purpose: z.string().min(10, 'Please describe the purpose (min 10 characters)'),
  term_months: z
    .number({ invalid_type_error: 'Please select a term' })
    .int()
    .min(1),
})

type FormValues = z.infer<typeof schema>

interface LoanApplicationFormProps {
  onSuccess: () => void
  onCancel: () => void
}

export function LoanApplicationForm({ onSuccess, onCancel }: LoanApplicationFormProps) {
  const { user } = useAuth()
  const createApplication = useCreateLoanApplication()
  const { data: eligibleCoMakers = [] } = useEligibleCoMakers()
  const { data: loanProducts = [] } = useActiveLoanProducts()
  const { format: currency } = useCurrency()

  const [selectedProduct, setSelectedProduct] = useState<LoanProduct | null>(null)
  const { data: maxEligible = null } = useLoanEligibility()
  const [minCoMakers, setMinCoMakers] = useState(1)
  const [previewAmount, setPreviewAmount] = useState(0)
  const [previewTerm, setPreviewTerm] = useState(0)
  const [selectedCoMakers, setSelectedCoMakers] = useState<EligibleCoMaker[]>([])
  const [coMakerError, setCoMakerError] = useState<string | null>(null)
  const [purposeLen, setPurposeLen] = useState(0)

  const interestRate = selectedProduct?.interest_rate ?? 12
  const calcMethod = selectedProduct?.calculation_method ?? 'reducing_balance'
  const ratePeriod = selectedProduct?.interest_rate_period ?? 'annual'

  // Build term options from the selected product
  const termOptions = selectedProduct
    ? Array.from(
        { length: selectedProduct.max_term_months - selectedProduct.min_term_months + 1 },
        (_, i) => selectedProduct.min_term_months + i
      ).filter(n => n <= selectedProduct.max_term_months)
    : [3, 6, 12, 18, 24, 36]

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { term_months: termOptions[0] ?? 12 },
  })

  const watchAmount = watch('amount_requested')
  const watchTerm = watch('term_months')

  useEffect(() => {
    if (watchAmount) setPreviewAmount(watchAmount)
    if (watchTerm) setPreviewTerm(watchTerm)
  }, [watchAmount, watchTerm])

  // Reset term to product's default min when product changes
  useEffect(() => {
    if (selectedProduct) {
      setValue('term_months', selectedProduct.min_term_months)
      setPreviewTerm(selectedProduct.min_term_months)
    }
  }, [selectedProduct, setValue])

  useEffect(() => {
    async function fetchCoMakerConfig() {
      if (!user) return
      const { data: configs } = await supabase
        .from('system_config')
        .select('config_key, config_value')
        .eq('config_key', 'loan_min_co_makers')
      if (!configs) return
      const cfg: Record<string, string> = {}
      configs.forEach((c: { config_key: string; config_value: string }) => {
        cfg[c.config_key] = c.config_value
      })
      setMinCoMakers(parseInt(cfg.loan_min_co_makers ?? '1'))
    }
    fetchCoMakerConfig()
  }, [user])

  // Auto-select if only one product
  useEffect(() => {
    if (loanProducts.length === 1 && !selectedProduct) {
      setSelectedProduct(loanProducts[0])
    }
  }, [loanProducts, selectedProduct])

  const addCoMaker = (id: string) => {
    const member = eligibleCoMakers.find(m => m.id === id)
    if (!member || selectedCoMakers.find(m => m.id === id)) return
    setSelectedCoMakers(prev => [...prev, member])
    setCoMakerError(null)
  }

  const removeCoMaker = (id: string) => {
    setSelectedCoMakers(prev => prev.filter(m => m.id !== id))
  }

  const availableToAdd = eligibleCoMakers.filter(
    m => !selectedCoMakers.find(s => s.id === m.id)
  )

  const onSubmit = async (values: FormValues) => {
    if (!maxEligible || maxEligible <= 0) return
    if (!selectedProduct) return
    if (selectedCoMakers.length < minCoMakers) {
      setCoMakerError(`At least ${minCoMakers} co-maker${minCoMakers > 1 ? 's are' : ' is'} required`)
      return
    }
    await createApplication.mutateAsync({
      amount_requested: values.amount_requested,
      purpose: values.purpose,
      term_months: values.term_months,
      co_maker_ids: selectedCoMakers.map(m => m.id),
      loan_product_id: selectedProduct.id,
    })
    onSuccess()
  }

  const effectiveMax = selectedProduct?.max_amount
    ? Math.min(maxEligible ?? Infinity, selectedProduct.max_amount)
    : maxEligible ?? undefined

  const monthlyPayment = previewAmount > 0 && previewTerm > 0
    ? calculateMonthlyPayment(previewAmount, interestRate, previewTerm, calcMethod, ratePeriod)
    : 0

  const totalRepayable = previewAmount > 0 && previewTerm > 0
    ? calculateTotalRepayable(previewAmount, interestRate, previewTerm, calcMethod, ratePeriod)
    : 0

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      {/* Loan Product selector */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Loan Product <span className="text-red-500">*</span>
        </label>
        {loanProducts.length === 0 ? (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
            <p className="text-sm text-yellow-800 font-medium">No loan products available</p>
            <p className="text-xs text-yellow-700 mt-0.5">
              Please contact your administrator to set up a loan product.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {loanProducts.map(p => (
              <label
                key={p.id}
                className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
                  selectedProduct?.id === p.id
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 hover:border-gray-300 bg-white'
                }`}
              >
                <input
                  type="radio"
                  name="loan_product"
                  value={p.id}
                  checked={selectedProduct?.id === p.id}
                  onChange={() => setSelectedProduct(p)}
                  className="mt-0.5 accent-blue-600"
                />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm text-gray-900">{p.name}</p>
                  {p.description && (
                    <p className="text-xs text-gray-500 mt-0.5">{p.description}</p>
                  )}
                  <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1 text-xs text-gray-500">
                    <span>{formatInterestLabel(p.interest_rate, p.interest_rate_period ?? 'annual', p.calculation_method)}</span>
                    <span>Term: {p.min_term_months}–{p.max_term_months} mo</span>
                    {p.max_amount && <span>Up to {currency(p.max_amount)}</span>}
                  </div>
                </div>
              </label>
            ))}
          </div>
        )}
      </div>

      {/* Eligibility banner */}
      {maxEligible !== null && maxEligible <= 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
          <p className="text-sm font-medium text-yellow-800">No completed equity shares</p>
          <p className="text-xs text-yellow-700 mt-0.5">
            You must have at least one fully paid equity share to apply for a loan.
          </p>
        </div>
      )}
      {maxEligible !== null && maxEligible > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
          <p className="text-sm text-blue-800">
            <span className="font-semibold">Maximum eligible:</span>{' '}
            {currency(effectiveMax ?? maxEligible)}
          </p>
          <p className="text-xs text-blue-600 mt-0.5">
            Based on your completed equity shares and membership tenure
            {selectedProduct?.max_amount ? ' (capped by product limit)' : ''}
          </p>
        </div>
      )}

      <Input
        label="Loan Amount"
        type="number"
        step="0.01"
        min="1"
        max={effectiveMax}
        placeholder="0.00"
        error={errors.amount_requested?.message}
        required
        disabled={!selectedProduct}
        {...register('amount_requested', { valueAsNumber: true })}
      />

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Repayment Term <span className="text-red-500">*</span>
        </label>
        <select
          disabled={!selectedProduct}
          className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
          {...register('term_months', { valueAsNumber: true })}
        >
          {termOptions.map(n => (
            <option key={n} value={n}>{n} months</option>
          ))}
        </select>
        {errors.term_months && <p className="text-xs text-red-600 mt-1">{errors.term_months.message}</p>}
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-gray-700">Purpose <span className="text-red-500">*</span></label>
        <textarea
          className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
          rows={3}
          maxLength={500}
          placeholder="Describe the purpose of this loan..."
          disabled={!selectedProduct}
          {...register('purpose')}
          onChange={e => {
            setPurposeLen(e.target.value.length)
            register('purpose').onChange(e)
          }}
        />
        <p className="text-xs text-gray-400 text-right">{purposeLen} / 500</p>
        {errors.purpose && <p className="text-xs text-red-600">{errors.purpose.message}</p>}
      </div>

      {/* Co-makers */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Co-makers / Guarantors <span className="text-red-500">*</span>
          <span className="text-xs font-normal text-gray-400 ml-1">(min {minCoMakers})</span>
        </label>
        <p className="text-xs text-gray-400 mb-2">
          Your application will be submitted for admin review only after all co-makers confirm.
        </p>

        {selectedCoMakers.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {selectedCoMakers.map(m => (
              <span
                key={m.id}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-blue-100 text-blue-800 text-xs font-medium"
              >
                {m.full_name}
                <button
                  type="button"
                  onClick={() => removeCoMaker(m.id)}
                  className="hover:text-blue-600 ml-0.5"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        {availableToAdd.length > 0 ? (
          <select
            onChange={e => { if (e.target.value) addCoMaker(e.target.value); e.target.value = '' }}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            defaultValue=""
          >
            <option value="">— Add a co-maker —</option>
            {availableToAdd.map(m => (
              <option key={m.id} value={m.id}>{m.full_name}</option>
            ))}
          </select>
        ) : selectedCoMakers.length === 0 ? (
          <p className="text-xs text-gray-400 italic">No eligible co-makers available</p>
        ) : null}

        {coMakerError && <p className="text-xs text-red-600 mt-1">{coMakerError}</p>}
      </div>

      {/* Loan Preview */}
      {monthlyPayment > 0 && selectedProduct && (
        <div className="bg-gray-50 rounded-lg p-4 space-y-2">
          <p className="text-sm font-medium text-gray-700">Loan Preview — {selectedProduct.name}</p>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-gray-500">Monthly Payment</p>
              <p className="font-semibold text-gray-900">{currency(monthlyPayment)}</p>
            </div>
            <div>
              <p className="text-gray-500">Total Repayable</p>
              <p className="font-semibold text-gray-900">{currency(totalRepayable)}</p>
            </div>
            <div>
              <p className="text-gray-500">Interest Rate</p>
              <p className="font-semibold text-gray-900">{interestRate}% p.a.</p>
            </div>
            <div>
              <p className="text-gray-500">Method</p>
              <p className="font-semibold text-gray-900 capitalize">{calcMethod.replace('_', ' ')}</p>
            </div>
          </div>
        </div>
      )}

      {createApplication.error && (
        <p className="text-sm text-red-600">
          {(createApplication.error as Error).message ?? 'Failed to submit application'}
        </p>
      )}

      <div className="flex gap-3 pt-2">
        <Button type="button" variant="outline" onClick={onCancel} className="flex-1">
          Cancel
        </Button>
        <Button
          type="submit"
          loading={isSubmitting || createApplication.isPending}
          disabled={
            isSubmitting ||
            createApplication.isPending ||
            !maxEligible ||
            maxEligible <= 0 ||
            !selectedProduct ||
            loanProducts.length === 0
          }
          className="flex-1"
        >
          Submit Application
        </Button>
      </div>
    </form>
  )
}
