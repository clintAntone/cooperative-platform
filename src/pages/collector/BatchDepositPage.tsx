import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Header } from '../../components/layout/Header'
import { Card, CardHeader, CardBody } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input, Select, Textarea } from '../../components/ui/Input'
import { useSubmitBatchDeposit } from '../../hooks/useBatchDeposits'
import { uploadReceipt } from '../../hooks/useDepositRequests'
import { useCurrency } from '../../hooks/useCurrency'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

const paymentMethodOptions = [
  { value: 'mobile_money', label: 'Mobile Banking' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'cash', label: 'Cash' },
]

const schema = z.object({
  payment_method: z.enum(['cash', 'bank_transfer', 'mobile_money']),
  reference: z.string().optional(),
  notes: z.string().optional(),
})

type FormValues = {
  payment_method: 'cash' | 'bank_transfer' | 'mobile_money'
  reference?: string
  notes?: string
}

interface MemberEntry {
  user_id: string
  full_name: string
  employee_id: string
  amount: number
  isSelf: boolean
}

export function BatchDepositPage() {
  const navigate = useNavigate()
  const { user, profile } = useAuth()
  const { format: currency } = useCurrency()
  const submitBatch = useSubmitBatchDeposit()

  const [employeeIdInput, setEmployeeIdInput] = useState('')
  const [lookupError, setLookupError] = useState<string | null>(null)
  const [isLooking, setIsLooking] = useState(false)
  const [members, setMembers] = useState<MemberEntry[]>([])
  const [amountErrors, setAmountErrors] = useState<Record<string, string>>({})
  const [membersError, setMembersError] = useState<string | null>(null)

  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Auto-add the collector themselves on mount
  useEffect(() => {
    if (user && profile) {
      setMembers([{
        user_id: user.id,
        full_name: profile.full_name,
        employee_id: profile.employee_id ?? '',
        amount: 0,
        isSelf: true,
      }])
    }
  }, [user, profile])

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { payment_method: 'mobile_money' },
  })

  const totalAmount = members.reduce((sum, m) => sum + (m.amount || 0), 0)

  const lookupByEmployeeId = async () => {
    const empId = employeeIdInput.trim()
    if (!empId) return

    setLookupError(null)
    setIsLooking(true)
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, employee_id')
        .eq('employee_id', empId)
        .in('role', ['member', 'collector'])
        .eq('account_status', 'active')
        .maybeSingle()

      if (error) throw error

      if (!data) {
        setLookupError(`No active member found with employee ID "${empId}".`)
        return
      }

      if (members.some(m => m.user_id === data.id)) {
        setLookupError('This member is already in the batch.')
        return
      }

      setMembers(prev => [...prev, {
        user_id: data.id,
        full_name: data.full_name,
        employee_id: data.employee_id ?? empId,
        amount: 0,
        isSelf: false,
      }])
      setEmployeeIdInput('')
      setMembersError(null)
    } catch (err: any) {
      setLookupError(err.message ?? 'Lookup failed. Please try again.')
    } finally {
      setIsLooking(false)
    }
  }

  const removeMember = (userId: string) => {
    setMembers(prev => prev.filter(m => m.user_id !== userId))
    setAmountErrors(prev => { const n = { ...prev }; delete n[userId]; return n })
  }

  const updateAmount = (userId: string, value: string) => {
    const num = parseFloat(value)
    setMembers(prev =>
      prev.map(m => m.user_id === userId ? { ...m, amount: isNaN(num) ? 0 : num } : m)
    )
    if (!isNaN(num) && num > 0) {
      setAmountErrors(prev => { const n = { ...prev }; delete n[userId]; return n })
    }
  }

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
    setUploadError(null)
    setMembersError(null)

    // Need collector + at least 1 other
    if (members.length < 2) {
      setMembersError('Add at least one more member to the batch.')
      return
    }

    const newAmountErrors: Record<string, string> = {}
    for (const m of members) {
      if (!m.amount || m.amount <= 0) {
        newAmountErrors[m.user_id] = 'Amount must be greater than 0'
      }
    }
    if (Object.keys(newAmountErrors).length > 0) {
      setAmountErrors(newAmountErrors)
      return
    }

    // Duplicate reference check
    if (values.reference?.trim()) {
      const { data: existing } = await supabase
        .from('deposit_requests')
        .select('id')
        .eq('reference', values.reference.trim())
        .limit(1)

      if (existing && existing.length > 0) {
        setError('reference', { message: 'This reference number has already been used.' })
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

    await submitBatch.mutateAsync({
      payment_method: values.payment_method,
      reference: values.reference,
      receipt_url: receiptUrl,
      notes: values.notes,
      items: members.map(m => ({ user_id: m.user_id, amount: m.amount })),
    })

    setSuccess(true)
    setTimeout(() => navigate('/batch-deposits'), 2000)
  }

  if (profile && !profile.profile_completed_at) {
    return (
      <div>
        <Header title="Batch Deposit" subtitle="Submit deposits for multiple members" />
        <div className="p-4 sm:p-6">
          <Card className="max-w-lg mx-auto p-8 text-center">
            <div className="w-12 h-12 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-1">Profile Incomplete</h3>
            <p className="text-sm text-gray-500 mb-4">
              You need to complete your profile before you can submit a batch deposit.
            </p>
            <div className="flex gap-3 justify-center">
              <Button onClick={() => navigate('/dashboard')} variant="outline" size="sm">
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
        <Header title="Batch Deposit" subtitle="Submit deposits for multiple members" />
        <div className="p-4 sm:p-6">
          <Card className="max-w-lg mx-auto p-8 text-center">
            <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-1">Batch Submitted!</h3>
            <p className="text-sm text-gray-500">Your batch deposit has been submitted for admin review.</p>
            <p className="text-xs text-gray-400 mt-3">Redirecting...</p>
          </Card>
        </div>
      </div>
    )
  }

  return (
    <div>
      <Header
        title="Batch Deposit"
        subtitle="Submit deposits for multiple members at once"
        actions={
          <Button variant="ghost" size="sm" onClick={() => navigate('/batch-deposits')}>
            My Batches
          </Button>
        }
      />

      <div className="p-4 sm:p-6 space-y-6">
        <Card className="max-w-2xl mx-auto">
          <CardHeader>
            <h2 className="text-base font-semibold text-gray-900">Batch Deposit Form</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              You are included by default. Add at least one more member by employee ID.
            </p>
          </CardHeader>
          <CardBody>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
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
                rows={2}
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
                    onClick={() => { setSelectedFile(null); setPreviewUrl(null); if (fileInputRef.current) fileInputRef.current.value = '' }}
                    className="text-xs text-red-500 hover:text-red-700 text-left mt-1"
                  >
                    Remove file
                  </button>
                )}
                {uploadError && <p className="text-xs text-red-600 mt-1">{uploadError}</p>}
              </div>

              {/* Add member by employee ID */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Add Member by Employee ID <span className="text-red-500">*</span>
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Enter exact employee ID"
                    value={employeeIdInput}
                    onChange={e => { setEmployeeIdInput(e.target.value); setLookupError(null) }}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); lookupByEmployeeId() } }}
                    className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    loading={isLooking}
                    onClick={lookupByEmployeeId}
                    disabled={!employeeIdInput.trim()}
                  >
                    Add
                  </Button>
                </div>
                {lookupError && <p className="mt-1 text-xs text-red-600">{lookupError}</p>}
                {membersError && <p className="mt-1 text-xs text-red-600">{membersError}</p>}
              </div>

              {/* Members list */}
              <div className="space-y-2">
                <p className="text-sm font-medium text-gray-700">
                  Members in batch ({members.length})
                </p>
                <div className="space-y-2">
                  {members.map(m => (
                    <div key={m.user_id} className={`flex items-center gap-2 rounded-lg px-3 py-2 ${m.isSelf ? 'bg-blue-50 border border-blue-100' : 'bg-gray-50'}`}>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="text-sm font-medium text-gray-800 truncate">{m.full_name}</p>
                          {m.isSelf && (
                            <span className="text-[10px] font-bold bg-blue-600 text-white px-1.5 py-0.5 rounded uppercase tracking-wide flex-shrink-0">You</span>
                          )}
                        </div>
                        <p className="text-xs text-gray-400">{m.employee_id}</p>
                        {amountErrors[m.user_id] && (
                          <p className="text-xs text-red-600 mt-0.5">{amountErrors[m.user_id]}</p>
                        )}
                      </div>
                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        placeholder="0.00"
                        value={m.amount || ''}
                        onChange={e => updateAmount(m.user_id, e.target.value)}
                        className={`w-28 border rounded-lg px-2 py-1.5 text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                          amountErrors[m.user_id] ? 'border-red-300 focus:ring-red-500' : 'border-gray-300'
                        }`}
                      />
                      {!m.isSelf && (
                        <button
                          type="button"
                          onClick={() => removeMember(m.user_id)}
                          className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors flex-shrink-0"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                {members.length >= 2 && (
                  <div className="flex items-center justify-between bg-blue-50 rounded-lg px-3 py-2.5 mt-2">
                    <span className="text-sm font-medium text-blue-800">Total Amount</span>
                    <span className="text-lg font-bold text-blue-900">{currency(totalAmount)}</span>
                  </div>
                )}
              </div>

              {submitBatch.error && (
                <p className="text-sm text-red-600">
                  {(submitBatch.error as Error).message ?? 'Failed to submit batch deposit'}
                </p>
              )}

              <div className="flex gap-3 pt-2">
                <Button type="button" variant="outline" className="flex-1" onClick={() => navigate('/batch-deposits')}>
                  Cancel
                </Button>
                <Button type="submit" className="flex-1" loading={isSubmitting || submitBatch.isPending}>
                  Submit Batch
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>
      </div>
    </div>
  )
}
