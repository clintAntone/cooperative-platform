import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '../../components/ui/Button'
import { Input, Select } from '../../components/ui/Input'
import { useAddContribution } from '../../hooks/useEquity'
import { useCurrency } from '../../hooks/useCurrency'
import type { EquityShare } from '../../types'

const schema = z.object({
  amount: z
    .number({ invalid_type_error: 'Please enter a valid amount' })
    .positive('Amount must be greater than 0')
    .min(100, 'Minimum contribution is 100'),
  payment_method: z.enum(['cash', 'bank_transfer', 'mobile_money']),
  reference: z.string().optional(),
})

type FormValues = z.infer<typeof schema>

interface ContributionFormProps {
  share: EquityShare
  onSuccess: () => void
  onCancel: () => void
}

const paymentMethodOptions = [
  { value: 'mobile_money', label: 'Mobile Banking' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'cash', label: 'Cash' },
]

export function ContributionForm({ share, onSuccess, onCancel }: ContributionFormProps) {
  const addContribution = useAddContribution()
  const { format: currency } = useCurrency()

  const remaining = share.target_amount - share.paid_amount

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      payment_method: 'mobile_money',
    },
  })

  const onSubmit = async (values: FormValues) => {
    await addContribution.mutateAsync({
      share_id: share.id,
      amount: values.amount,
      payment_method: values.payment_method,
      reference: values.reference,
    })
    onSuccess()
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="bg-blue-50 rounded-lg p-3 text-sm text-blue-800">
        <p className="font-medium">Share #{share.share_number}</p>
        <p className="mt-1">Remaining balance: <span className="font-semibold">{currency(remaining)}</span></p>
      </div>

      <Input
        label="Amount"
        type="number"
        step="0.01"
        min="100"
        max={remaining}
        placeholder="0.00"
        error={errors.amount?.message}
        hint={`Max: ${currency(remaining)}`}
        required
        {...register('amount', { valueAsNumber: true })}
      />

      <Select
        label="Payment Method"
        options={paymentMethodOptions}
        error={errors.payment_method?.message}
        required
        {...register('payment_method')}
      />

      <Input
        label="Reference"
        type="text"
        placeholder="Transaction reference (optional)"
        error={errors.reference?.message}
        {...register('reference')}
      />

      {addContribution.error && (
        <p className="text-sm text-red-600">
          {(addContribution.error as Error).message ?? 'Failed to record contribution'}
        </p>
      )}

      <div className="flex gap-3 pt-2">
        <Button type="button" variant="outline" onClick={onCancel} className="flex-1">
          Cancel
        </Button>
        <Button type="submit" loading={isSubmitting || addContribution.isPending} className="flex-1">
          Record Payment
        </Button>
      </div>
    </form>
  )
}
