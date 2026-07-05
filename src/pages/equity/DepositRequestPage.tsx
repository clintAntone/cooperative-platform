import { useState, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useQuery } from '@tanstack/react-query'
import { Header } from '../../components/layout/Header'
import { Card, CardHeader, CardBody } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input, Select, Textarea } from '../../components/ui/Input'
import { useEquityShares } from '../../hooks/useEquity'
import { useSubmitDepositRequest, uploadReceipt } from '../../hooks/useDepositRequests'
import { useCurrency } from '../../hooks/useCurrency'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

const paymentMethodOptions = [
  { value: 'mobile_money', label: 'Mobile Banking' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'cash', label: 'Cash' },
]

function buildSchema(minAmount: number) {
  return z.object({
    share_id: z.string().min(1, 'Please select a share'),
    amount: z
      .number({ invalid_type_error: 'Please enter a valid amount' })
      .positive('Amount must be greater than 0')
      .min(minAmount, `Minimum deposit amount is ${minAmount}`),
    payment_method: z.enum(['cash', 'bank_transfer', 'mobile_money']),
    reference: z.string().optional(),
    notes: z.string().optional(),
  })
}

type FormValues = {
  share_id: string
  amount: number
  payment_method: 'cash' | 'bank_transfer' | 'mobile_money'
  reference?: string
  notes?: string
}

export function DepositRequestPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { user, profile } = useAuth()
  const profileIncomplete = !profile?.profile_completed_at
  const { format: currency } = useCurrency()
  const { data: shares = [] } = useEquityShares()
  const submitRequest = useSubmitDepositRequest()

  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Fetch min installment amount from config
  const { data: minAmount = 100 } = useQuery({
    queryKey: ['min_installment_amount'],
    queryFn: async () => {
      const { data } = await supabase
        .from('system_config')
        .select('config_value')
        .eq('config_key', 'min_installment_amount')
        .single()
      return data ? parseFloat(data.config_value) : 100
    },
    staleTime: Infinity,
  })

  const inProgressShares = shares.filter(s => s.status === 'in_progress')
  const shareOptions = [
    { value: '', label: 'Select a share...' },
    ...inProgressShares.map(s => ({
      value: s.id,
      label: `Share #${s.share_number} — ${currency(s.paid_amount)} / ${currency(s.target_amount)}`,
    })),
  ]

  // Only pre-select if the share_id from URL is actually an in-progress share
  const rawShareId = searchParams.get('share_id') ?? ''
  const defaultShareId = inProgressShares.some(s => s.id === rawShareId) ? rawShareId : ''

  const schema = buildSchema(minAmount)

  const {
    register,
    handleSubmit,
    watch,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      share_id: defaultShareId,
      payment_method: 'mobile_money',
    },
  })

  const selectedShareId = watch('share_id')
  const watchAmount = watch('amount') ?? 0
  const selectedShare = shares.find(s => s.id === selectedShareId)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setSelectedFile(file)
    setUploadError(null)

    // Show preview for images
    if (file.type.startsWith('image/')) {
      const reader = new FileReader()
      reader.onload = ev => setPreviewUrl(ev.target?.result as string)
      reader.readAsDataURL(file)
    } else {
      setPreviewUrl(null)
    }
  }

  const onSubmit = async (values: FormValues) => {
    setUploadError(null)

    // Check for duplicate reference number before uploading or submitting
    if (values.reference && values.reference.trim() !== '') {
      const { data: existing } = await supabase
        .from('deposit_requests')
        .select('id')
        .eq('reference', values.reference.trim())
        .limit(1)

      if (existing && existing.length > 0) {
        setError('reference', {
          message: 'This reference number has already been used in a previous deposit request.',
        })
        return
      }
    }

    if (!selectedFile) {
      setUploadError('Please upload a receipt or deposit slip before submitting.')
      return
    }

    let receiptUrl: string | undefined

    if (user) {
      try {
        receiptUrl = await uploadReceipt(user.id, selectedFile)
      } catch (err: any) {
        setUploadError(err.message ?? 'Failed to upload receipt. Please try again.')
        return
      }
    }

    await submitRequest.mutateAsync({
      share_id: values.share_id,
      amount: values.amount,
      payment_method: values.payment_method,
      reference: values.reference,
      receipt_url: receiptUrl,
      notes: values.notes,
    })

    setSuccess(true)
    setTimeout(() => navigate('/equity'), 2000)
  }

  if (profileIncomplete) {
    return (
      <div>
        <Header title="Request Deposit" subtitle="Submit a deposit for admin review" />
        <div className="p-4 sm:p-6">
          <Card className="max-w-lg mx-auto p-8 text-center">
            <div className="w-12 h-12 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-1">Profile Incomplete</h3>
            <p className="text-sm text-gray-500 mb-4">
              You need to complete your profile before you can submit a deposit request.
            </p>
            <div className="flex gap-3 justify-center">
              <Button onClick={() => navigate('/equity')} variant="outline" size="sm">
                Go Back
              </Button>
              <Button onClick={() => window.dispatchEvent(new Event('open-profile-completion'))} size="sm">
                Complete Profile
              </Button>
            </div>
          </Card>
        </div>
      </div>
    )
  }

  if (success) {
    return (
      <div>
        <Header title="Request Deposit" subtitle="Submit a deposit for admin review" />
        <div className="p-4 sm:p-6">
          <Card className="max-w-lg mx-auto p-8 text-center">
            <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-1">Request Submitted!</h3>
            <p className="text-sm text-gray-500">
              Your deposit request has been submitted for review. You will be notified once it is approved.
            </p>
            <p className="text-xs text-gray-400 mt-3">Redirecting to Equity page...</p>
          </Card>
        </div>
      </div>
    )
  }

  return (
    <div>
      <Header
        title="Request Deposit"
        subtitle="Submit a deposit for admin review"
        actions={
          <Button variant="ghost" size="sm" onClick={() => navigate('/equity')}>
            Back to Equity
          </Button>
        }
      />

      <div className="p-4 sm:p-6 space-y-6">
        <Card className="max-w-2xl mx-auto">
          <CardHeader>
            <h2 className="text-base font-semibold text-gray-900">Deposit Request Form</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              Fill in the details below and upload your deposit slip or receipt.
            </p>
          </CardHeader>
          <CardBody>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
              {/* Share selector */}
              {inProgressShares.length === 0 ? (
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-sm text-yellow-800">
                  You have no in-progress shares. Please open a new share from the Equity page first.
                </div>
              ) : (
                <Select
                  label="Select Share"
                  options={shareOptions}
                  error={errors.share_id?.message}
                  required
                  {...register('share_id')}
                />
              )}

              {/* Selected share info */}
              {selectedShare && (
                <div className="bg-blue-50 rounded-lg p-3 text-sm text-blue-800">
                  <p className="font-medium">Share #{selectedShare.share_number}</p>
                  <p className="mt-0.5">
                    Remaining:{' '}
                    <span className="font-semibold">
                      {currency(selectedShare.target_amount - selectedShare.paid_amount)}
                    </span>
                  </p>
                  {watchAmount > 0 && selectedShare && watchAmount > (selectedShare.target_amount - selectedShare.paid_amount) && (
                    <p className="mt-1 text-blue-700 text-xs">
                      {currency(selectedShare.target_amount - selectedShare.paid_amount)} will complete this share.
                      The remaining {currency(watchAmount - (selectedShare.target_amount - selectedShare.paid_amount))} will be applied to your next share automatically.
                    </p>
                  )}
                </div>
              )}

              {/* Amount */}
              <Input
                label="Amount"
                type="number"
                step="0.01"
                min={minAmount}
                placeholder="0.00"
                error={errors.amount?.message}
                hint={`Minimum: ${currency(minAmount)}`}
                required
                {...register('amount', { valueAsNumber: true })}
              />

              {/* Payment method */}
              <Select
                label="Payment Method"
                options={paymentMethodOptions}
                error={errors.payment_method?.message}
                required
                {...register('payment_method')}
              />

              {/* Reference */}
              <Input
                label="Reference / Transaction #"
                type="text"
                placeholder="Transaction reference or receipt number (optional)"
                error={errors.reference?.message}
                {...register('reference')}
              />

              {/* Notes */}
              <Textarea
                label="Notes"
                placeholder="Any additional notes (optional)"
                rows={3}
                error={errors.notes?.message}
                {...register('notes')}
              />

              {/* File upload */}
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700">
                  Upload Receipt / Deposit Slip <span className="text-red-500">*</span>
                </label>
                <div
                  className="border-2 border-dashed border-gray-300 rounded-lg p-4 text-center cursor-pointer hover:border-blue-400 transition-colors"
                  onClick={() => fileInputRef.current?.click()}
                >
                  {previewUrl ? (
                    <img
                      src={previewUrl}
                      alt="Receipt preview"
                      className="max-h-48 mx-auto rounded-lg object-contain"
                    />
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

              {/* Errors */}
              {uploadError && (
                <p className="text-sm text-red-600">{uploadError}</p>
              )}
              {submitRequest.error && (
                <p className="text-sm text-red-600">
                  {(submitRequest.error as Error).message ?? 'Failed to submit request'}
                </p>
              )}

              {/* Actions */}
              <div className="flex gap-3 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1"
                  onClick={() => navigate('/equity')}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  className="flex-1"
                  loading={isSubmitting || submitRequest.isPending}
                  disabled={inProgressShares.length === 0 || profileIncomplete}
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
