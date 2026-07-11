import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Header } from '../../components/layout/Header'
import { Card, CardHeader, CardBody } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input, Textarea } from '../../components/ui/Input'
import { useSavingsAccount, useSubmitSavingsWithdrawal } from '../../hooks/useSavings'
import { useCurrency } from '../../hooks/useCurrency'

type FormValues = {
  amount: number
  reason?: string
}

export function SavingsWithdrawPage() {
  const navigate = useNavigate()
  const { format: currency } = useCurrency()
  const { data: account } = useSavingsAccount()
  const submitWithdrawal = useSubmitSavingsWithdrawal()
  const [success, setSuccess] = useState(false)

  const schema = z.object({
    amount: z
      .number({ invalid_type_error: 'Please enter a valid amount' })
      .positive('Amount must be greater than 0')
      .refine(
        val => !account || val <= account.balance,
        { message: 'Amount cannot exceed your current balance' }
      ),
    reason: z.string().optional(),
  })

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
  })

  const onSubmit = async (values: FormValues) => {
    if (!account) return

    await submitWithdrawal.mutateAsync({
      account_id: account.id,
      amount: values.amount,
      reason: values.reason,
    })

    setSuccess(true)
    setTimeout(() => navigate('/savings'), 2000)
  }

  if (success) {
    return (
      <div>
        <Header title="Request Withdrawal" subtitle="Withdraw from your savings account" />
        <div className="p-4 sm:p-6">
          <Card className="max-w-lg mx-auto p-8 text-center">
            <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-1">Withdrawal Requested!</h3>
            <p className="text-sm text-gray-500">Your withdrawal request has been submitted for admin review.</p>
            <p className="text-xs text-gray-400 mt-3">Redirecting to Savings page...</p>
          </Card>
        </div>
      </div>
    )
  }

  return (
    <div>
      <Header
        title="Request Withdrawal"
        subtitle="Withdraw funds from your savings account"
        actions={
          <Button variant="ghost" size="sm" onClick={() => navigate('/savings')}>
            Back to Savings
          </Button>
        }
      />

      <div className="p-4 sm:p-6 space-y-6">
        {/* Balance display */}
        {account && (
          <div className="max-w-lg mx-auto bg-white border border-gray-200 rounded-xl p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-gray-500">Available Balance</p>
              <p className="text-2xl font-bold text-gray-900 mt-0.5">{currency(account.balance)}</p>
            </div>
            <div className="w-12 h-12 bg-blue-50 rounded-full flex items-center justify-center">
              <svg className="w-6 h-6 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
              </svg>
            </div>
          </div>
        )}

        {account && account.balance === 0 && (
          <div className="max-w-lg mx-auto bg-yellow-50 border border-yellow-200 rounded-xl p-4 text-sm text-yellow-800">
            Your savings balance is zero. There is nothing to withdraw at this time.
          </div>
        )}

        <Card className="max-w-lg mx-auto">
          <CardHeader>
            <h2 className="text-base font-semibold text-gray-900">Withdrawal Request</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              Your request will be reviewed and approved by an admin before funds are released.
            </p>
          </CardHeader>
          <CardBody>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
              <Input
                label="Amount to Withdraw"
                type="number"
                step="0.01"
                min={1}
                max={account?.balance ?? 0}
                placeholder="0.00"
                error={errors.amount?.message}
                hint={account ? `Maximum: ${currency(account.balance)}` : undefined}
                required
                {...register('amount', { valueAsNumber: true })}
              />

              <Textarea
                label="Reason"
                placeholder="e.g. Emergency expense, medical, education... (optional)"
                rows={3}
                error={errors.reason?.message}
                {...register('reason')}
              />

              {submitWithdrawal.error && (
                <p className="text-sm text-red-600">
                  {(submitWithdrawal.error as Error).message ?? 'Failed to submit withdrawal request'}
                </p>
              )}

              <div className="flex gap-3 pt-2">
                <Button type="button" variant="outline" className="flex-1" onClick={() => navigate('/savings')}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  className="flex-1"
                  loading={isSubmitting || submitWithdrawal.isPending}
                  disabled={!account || account.balance === 0}
                >
                  Submit Request
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>
      </div>
    </div>
  )
}
