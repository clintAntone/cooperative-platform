import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '../../components/ui/Button'
import { Input, Select } from '../../components/ui/Input'
import { useCreateLoanApplication, useEligibleCoMakers } from '../../hooks/useLoans'
import { supabase } from '../../lib/supabase'
import { calculateTotalRepayable, calculateMonthlyPayment } from '../../lib/utils'
import { useCurrency } from '../../hooks/useCurrency'
import { useAuth } from '../../context/AuthContext'
import type { EligibleCoMaker } from '../../types'

const schema = z.object({
  amount_requested: z
    .number({ invalid_type_error: 'Please enter a valid amount' })
    .positive('Amount must be greater than 0'),
  purpose: z.string().min(10, 'Please describe the purpose (min 10 characters)'),
  term_months: z
    .number({ invalid_type_error: 'Please select a term' })
    .int()
    .min(1)
    .max(36, 'Maximum term is 36 months'),
})

type FormValues = z.infer<typeof schema>

interface LoanApplicationFormProps {
  onSuccess: () => void
  onCancel: () => void
}

const termOptions = [
  { value: '3', label: '3 months' },
  { value: '6', label: '6 months' },
  { value: '12', label: '12 months' },
  { value: '18', label: '18 months' },
  { value: '24', label: '24 months' },
  { value: '36', label: '36 months' },
]

export function LoanApplicationForm({ onSuccess, onCancel }: LoanApplicationFormProps) {
  const { user } = useAuth()
  const createApplication = useCreateLoanApplication()
  const { data: eligibleCoMakers = [] } = useEligibleCoMakers()
  const { format: currency } = useCurrency()

  const [maxEligible, setMaxEligible] = useState<number | null>(null)
  const [interestRate, setInterestRate] = useState(12)
  const [calcMethod, setCalcMethod] = useState<'flat' | 'reducing_balance'>('reducing_balance')
  const [minCoMakers, setMinCoMakers] = useState(1)
  const [previewAmount, setPreviewAmount] = useState(0)
  const [previewTerm, setPreviewTerm] = useState(12)
  const [selectedCoMakers, setSelectedCoMakers] = useState<EligibleCoMaker[]>([])
  const [coMakerError, setCoMakerError] = useState<string | null>(null)
  const [purposeLen, setPurposeLen] = useState(0)

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { term_months: 12 },
  })

  const watchAmount = watch('amount_requested')
  const watchTerm = watch('term_months')

  useEffect(() => {
    if (watchAmount) setPreviewAmount(watchAmount)
    if (watchTerm) setPreviewTerm(watchTerm)
  }, [watchAmount, watchTerm])

  useEffect(() => {
    async function fetchEligibility() {
      if (!user) return

      const { data: configs } = await supabase
        .from('system_config')
        .select('config_key, config_value')
        .in('config_key', [
          'loan_to_equity_ratio',
          'loan_ratio_new_member',
          'loan_ratio_senior_member',
          'loan_ratio_tenure_months',
          'share_price',
          'loan_interest_rate',
          'interest_calculation_method',
          'loan_min_co_makers',
        ])

      if (!configs) return

      const cfg: Record<string, string> = {}
      configs.forEach((c: { config_key: string; config_value: string }) => {
        cfg[c.config_key] = c.config_value
      })

      const sharePrice = parseFloat(cfg.share_price ?? '5000')
      const rate = parseFloat(cfg.loan_interest_rate ?? '12')
      const method = (cfg.interest_calculation_method ?? 'reducing_balance') as 'flat' | 'reducing_balance'
      const ratioNewMember = parseFloat(cfg.loan_ratio_new_member ?? '1')
      const ratioSenior = parseFloat(cfg.loan_ratio_senior_member ?? '3')
      const tenureMonths = parseInt(cfg.loan_ratio_tenure_months ?? '12')
      const minCo = parseInt(cfg.loan_min_co_makers ?? '1')

      setInterestRate(rate)
      setCalcMethod(method)
      setMinCoMakers(minCo)

      // Determine tenure-based ratio
      const { data: profile } = await supabase
        .from('profiles')
        .select('created_at')
        .eq('id', user.id)
        .single()

      let ratio = ratioNewMember
      if (profile) {
        const memberSince = new Date(profile.created_at)
        const monthsAsMember = (Date.now() - memberSince.getTime()) / (1000 * 60 * 60 * 24 * 30.44)
        if (monthsAsMember >= tenureMonths) ratio = ratioSenior
      }

      // Count completed shares
      const { count } = await supabase
        .from('equity_shares')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('status', 'completed')

      const completedShares = count ?? 0
      setMaxEligible(completedShares * sharePrice * ratio)
    }

    fetchEligibility()
  }, [user])

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
    if (selectedCoMakers.length < minCoMakers) {
      setCoMakerError(`At least ${minCoMakers} co-maker${minCoMakers > 1 ? 's are' : ' is'} required`)
      return
    }
    await createApplication.mutateAsync({
      amount_requested: values.amount_requested,
      purpose: values.purpose,
      term_months: values.term_months,
      co_maker_ids: selectedCoMakers.map(m => m.id),
    })
    onSuccess()
  }

  const monthlyPayment = previewAmount > 0 && previewTerm > 0
    ? calculateMonthlyPayment(previewAmount, interestRate, previewTerm, calcMethod)
    : 0

  const totalRepayable = previewAmount > 0 && previewTerm > 0
    ? calculateTotalRepayable(previewAmount, interestRate, previewTerm, calcMethod)
    : 0

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
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
            {currency(maxEligible)}
          </p>
          <p className="text-xs text-blue-600 mt-0.5">
            Based on your completed equity shares and membership tenure
          </p>
        </div>
      )}

      <Input
        label="Loan Amount"
        type="number"
        step="0.01"
        min="1"
        max={maxEligible ?? undefined}
        placeholder="0.00"
        error={errors.amount_requested?.message}
        required
        {...register('amount_requested', { valueAsNumber: true })}
      />

      <Select
        label="Repayment Term"
        options={termOptions}
        error={errors.term_months?.message}
        required
        {...register('term_months', { valueAsNumber: true })}
      />

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-gray-700">Purpose <span className="text-red-500">*</span></label>
        <textarea
          className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
          rows={3}
          maxLength={500}
          placeholder="Describe the purpose of this loan..."
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
      {monthlyPayment > 0 && (
        <div className="bg-gray-50 rounded-lg p-4 space-y-2">
          <p className="text-sm font-medium text-gray-700">Loan Preview</p>
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
          disabled={!maxEligible || maxEligible <= 0}
          className="flex-1"
        >
          Submit Application
        </Button>
      </div>
    </form>
  )
}
