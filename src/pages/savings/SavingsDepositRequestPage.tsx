import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useQuery } from '@tanstack/react-query'
import { Header } from '../../components/layout/Header'
import { Card, CardHeader, CardBody } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input, Select, Textarea } from '../../components/ui/Input'
import { useSavingsAccount, useSubmitSavingsDeposit, useSavingsWeeklyTotal, uploadSavingsReceipt } from '../../hooks/useSavings'
import { useCurrency } from '../../hooks/useCurrency'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'

const paymentMethodOptions = [
  { value: 'mobile_money', label: 'Mobile Banking' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'cash', label: 'Cash' },
]

type FormValues = {
  amount: number
  payment_method: 'cash' | 'bank_transfer' | 'mobile_money'
  reference?: string
  notes?: string
}

export function SavingsDepositRequestPage() {
  const navigate = useNavigate()
  const { user, profile } = useAuth()
  const { format: currency } = useCurrency()
  const { data: account } = useSavingsAccount()
  const { data: weeklyTotal = 0 } = useSavingsWeeklyTotal(account?.id)
  const submitRequest = useSubmitSavingsDeposit()

  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { data: minDeposit = 500 } = useQuery({
    queryKey: ['savings_min_deposit'],
    queryFn: async () => {
      const { data } = await supabase
        .from('system_config')
        .select('config_value')
        .eq('config_key', 'savings_min_deposit')
        .single()
      return data ? parseFloat(data.config_value) : 500
    },
    staleTime: Infinity,
  })

  const { data: weeklyCap = 5000 } = useQuery({
    queryKey: ['savings_weekly_cap'],
    queryFn: async () => {
      const { data } = await supabase
        .from('system_config')
        .select('config_value')
        .eq('config_key', 'savings_weekly_cap')
        .single()
      return data ? parseFloat(data.config_value) : 5000
    },
    staleTime: Infinity,
  })

  const weeklyRemaining = Math.max(0, weeklyCap - weeklyTotal)

  const schema = z.object({
    amount: z
      .number({ invalid_type_error: 'Please enter a valid amount' })
      .positive('Amount must be greater than 0')
      .min(minDeposit, `Minimum deposit is ${currency(minDeposit)}`),
    payment_method: z.enum(['cash', 'bank_transfer', 'mobile_money']),
    reference: z.string().optional(),
    notes: z.string().optional(),
  })

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { payment_method: 'mobile_money' },
  })

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setSelectedFile(file)
    setUploadError(null)
    if (file.type.startsWith('image/')) {
      const reader = new FileReader()
      reader.onload = ev => setPreviewUrl(ev.target?.result as string)
      reader.readAsDataURL(file)
    } else {
      setPreviewUrl(null)
    }
  }

  const onSubmit = async (values: FormValues) => {
    if (!account) return
    setUploadError(null)

    if (!selectedFile) {
      setUploadError('Please upload a receipt or deposit slip before submitting.')
      return
    }

    let receiptUrl: string | undefined
    if (user) {
      try {
        receiptUrl = await uploadSavingsReceipt(user.id, selectedFile)
      } catch (err: any) {
        setUploadError(err.message ?? 'Failed to upload receipt. Please try again.')
        return
      }
    }

    await submitRequest.mutateAsync({
      account_id: account.id,
      amount: values.amount,
      payment_method: values.payment_method,
      reference: values.reference,
      receipt_url: receiptUrl,
      notes: values.notes,
    })

    setSuccess(true)
    setTimeout(() => navigate('/savings'), 2000)
  }

  const profileIncomplete = !profile?.profile_completed_at

  if (profileIncomplete) {
    return (
      <div>
        <Header title="Savings Deposit" subtitle="Submit a deposit for admin review" />
        <div className="p-4 sm:p-6">
          <Card className="max-w-lg mx-auto p-8 text-center">
            <div className="w-12 h-12 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-1">Profile Incomplete</h3>
            <p className="text-sm text-gray-500 mb-4">Please complete your profile before submitting a deposit.</p>
            <div className="flex gap-3 justify-center">
              <Button onClick={() => navigate('/savings')} variant="outline" size="sm">Go Back</Button>
              <Button onClick={() => window.dispatchEvent(new Event('open-profile-completion'))} size="sm">Complete Profile</Button>
            </div>
          </Card>
        </div>
      </div>
    )
  }

  if (success) {
    return (
      <div>
        <Header title="Savings Deposit" subtitle="Submit a deposit for admin review" />
        <div className="p-4 sm:p-6">
          <Card className="max-w-lg mx-auto p-8 text-center">
            <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-1">Request Submitted!</h3>
            <p className="text-sm text-gray-500">Your deposit request has been submitted for admin review.</p>
            <p className="text-xs text-gray-400 mt-3">Redirecting to Savings page...</p>
          </Card>
        </div>
      </div>
    )
  }

  return (
    <div>
      <Header
        title="Savings Deposit"
        subtitle="Submit a deposit request for admin review"
        actions={
          <Button variant="ghost" size="sm" onClick={() => navigate('/savings')}>
            Back to Savings
          </Button>
        }
      />

      <div className="p-4 sm:p-6 space-y-6">
        {/* Account summary */}
        {account && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-w-2xl mx-auto">
            <div className="bg-white border border-gray-200 rounded-xl p-3 text-center">
              <p className="text-xs text-gray-500">Current Balance</p>
              <p className="text-lg font-bold text-gray-900 mt-0.5">{currency(account.balance)}</p>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-3 text-center">
              <p className="text-xs text-gray-500">Deposited This Week</p>
              <p className="text-lg font-bold text-gray-900 mt-0.5">{currency(weeklyTotal)}</p>
            </div>
            <div className={`border rounded-xl p-3 text-center col-span-2 sm:col-span-1 ${weeklyRemaining === 0 ? 'bg-red-50 border-red-200' : 'bg-white border-gray-200'}`}>
              <p className="text-xs text-gray-500">Weekly Cap Remaining</p>
              <p className={`text-lg font-bold mt-0.5 ${weeklyRemaining === 0 ? 'text-red-600' : 'text-gray-900'}`}>
                {currency(weeklyRemaining)}
              </p>
            </div>
          </div>
        )}

        {weeklyRemaining === 0 && (
          <div className="max-w-2xl mx-auto bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-800">
            You have reached your weekly deposit cap of {currency(weeklyCap)}. You can deposit again next week.
          </div>
        )}

        <Card className="max-w-2xl mx-auto">
          <CardHeader>
            <h2 className="text-base font-semibold text-gray-900">Savings Deposit Form</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              Minimum deposit: {currency(minDeposit)} · Weekly cap: {currency(weeklyCap)}
            </p>
          </CardHeader>
          <CardBody>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
              <Input
                label="Amount"
                type="number"
                step="0.01"
                min={minDeposit}
                placeholder="0.00"
                error={errors.amount?.message}
                hint={`Minimum: ${currency(minDeposit)} · Weekly cap remaining: ${currency(weeklyRemaining)}`}
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
                label="Reference / Transaction #"
                type="text"
                placeholder="Transaction reference or receipt number (optional)"
                error={errors.reference?.message}
                {...register('reference')}
              />

              <Textarea
                label="Notes"
                placeholder="Any additional notes (optional)"
                rows={3}
                error={errors.notes?.message}
                {...register('notes')}
              />

              {/* Receipt upload */}
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700">
                  Upload Receipt / Deposit Slip <span className="text-red-500">*</span>
                </label>
                <div
                  className="border-2 border-dashed border-gray-300 rounded-lg p-4 text-center cursor-pointer hover:border-blue-400 transition-colors"
                  onClick={() => fileInputRef.current?.click()}
                >
                  {previewUrl ? (
                    <img src={previewUrl} alt="Receipt preview" className="max-h-48 mx-auto rounded-lg object-contain" />
                  ) : selectedFile ? (
                    <div className="flex items-center justify-center gap-2 text-sm text-gray-600">
                      <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                      </svg>
                      {selectedFile.name}
                    </div>
                  ) : (
                    <div>
                      <svg className="w-8 h-8 text-gray-300 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      <p className="text-sm text-gray-500">Click to upload image or PDF</p>
                      <p className="text-xs text-gray-400 mt-0.5">JPG, PNG, PDF accepted</p>
                    </div>
                  )}
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,application/pdf"
                  className="hidden"
                  onChange={handleFileChange}
                />
                {selectedFile && (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedFile(null)
                      setPreviewUrl(null)
                      if (fileInputRef.current) fileInputRef.current.value = ''
                    }}
                    className="text-xs text-red-500 hover:text-red-700 text-left mt-1"
                  >
                    Remove file
                  </button>
                )}
              </div>

              {uploadError && <p className="text-sm text-red-600">{uploadError}</p>}
              {submitRequest.error && (
                <p className="text-sm text-red-600">
                  {(submitRequest.error as Error).message ?? 'Failed to submit request'}
                </p>
              )}

              <div className="flex gap-3 pt-2">
                <Button type="button" variant="outline" className="flex-1" onClick={() => navigate('/savings')}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  className="flex-1"
                  loading={isSubmitting || submitRequest.isPending}
                  disabled={!account || weeklyRemaining === 0}
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
