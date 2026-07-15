import { useState, useRef, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Input, Select, Textarea } from '../ui/Input'
import { useSubmitBatchDeposit } from '../../hooks/useBatchDeposits'
import { uploadReceipt } from '../../hooks/useDepositRequests'
import { useCurrency } from '../../hooks/useCurrency'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { toast } from '../../lib/toast'
import { useQueryClient } from '@tanstack/react-query'

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
  shareRemaining: number | null
  savingsAccountId: string | null
}

type DepositType = 'shares' | 'savings'

async function fetchMemberMeta(userId: string): Promise<{ shareRemaining: number; savingsAccountId: string | null }> {
  const [sharesResult, savingsResult] = await Promise.all([
    supabase
      .from('equity_shares')
      .select('target_amount, paid_amount, status')
      .eq('user_id', userId),
    supabase
      .from('savings_accounts')
      .select('id')
      .eq('user_id', userId)
      .eq('status', 'active')
      .maybeSingle(),
  ])

  const shares = (sharesResult.data ?? []) as { target_amount: number; paid_amount: number; status: string }[]
  const incompleteShares = shares.filter(s => s.status !== 'completed')
  const shareRemaining = incompleteShares.reduce(
    (sum, s) => sum + Math.max(0, s.target_amount - s.paid_amount),
    0
  )

  return {
    shareRemaining,
    savingsAccountId: savingsResult.data?.id ?? null,
  }
}

interface BatchDepositModalProps {
  isOpen: boolean
  onClose: () => void
  defaultType?: DepositType
}

export function BatchDepositModal({ isOpen, onClose, defaultType = 'shares' }: BatchDepositModalProps) {
  const { user, profile } = useAuth()
  const { format: currency } = useCurrency()
  const queryClient = useQueryClient()
  const submitBatch = useSubmitBatchDeposit()

  const [depositType, setDepositType] = useState<DepositType>(defaultType)
  const [employeeIdInput, setEmployeeIdInput] = useState('')
  const [lookupError, setLookupError] = useState<string | null>(null)
  const [isLooking, setIsLooking] = useState(false)
  const [members, setMembers] = useState<MemberEntry[]>([])
  const [amountErrors, setAmountErrors] = useState<Record<string, string>>({})
  const [membersError, setMembersError] = useState<string | null>(null)

  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { register, handleSubmit, setError, reset, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { payment_method: 'mobile_money' },
  })

  // Reset state when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      setDepositType(defaultType)
      setEmployeeIdInput('')
      setLookupError(null)
      setMembersError(null)
      setAmountErrors({})
      setSelectedFile(null)
      setPreviewUrl(null)
      setUploadError(null)
      reset({ payment_method: 'mobile_money' })

      // Auto-add self
      if (user && profile) {
        const entry: MemberEntry = {
          user_id: user.id,
          full_name: profile.full_name,
          employee_id: profile.employee_id ?? '',
          amount: 0,
          isSelf: true,
          shareRemaining: null,
          savingsAccountId: null,
        }
        setMembers([entry])
        fetchMemberMeta(user.id).then(meta => {
          setMembers(prev => prev.map(m => m.user_id === user.id ? { ...m, ...meta } : m))
        })
      }
    } else {
      setMembers([])
    }
  }, [isOpen, defaultType, user, profile, reset])

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
        .in('role', ['member'])
        .eq('account_status', 'active')
        .maybeSingle()
      if (error) throw error
      if (!data) { setLookupError(`No active member found with employee ID "${empId}".`); return }
      if (members.some(m => m.user_id === data.id)) { setLookupError('This member is already in the batch.'); return }
      const newEntry: MemberEntry = {
        user_id: data.id, full_name: data.full_name,
        employee_id: data.employee_id ?? empId, amount: 0,
        isSelf: false, shareRemaining: null, savingsAccountId: null,
      }
      setMembers(prev => [...prev, newEntry])
      setEmployeeIdInput('')
      setMembersError(null)
      fetchMemberMeta(data.id).then(meta => {
        setMembers(prev => prev.map(m => m.user_id === data.id ? { ...m, ...meta } : m))
      })
    } catch (err: any) {
      setLookupError(err.message ?? 'Lookup failed.')
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
    setMembers(prev => prev.map(m => m.user_id === userId ? { ...m, amount: isNaN(num) ? 0 : num } : m))
    if (!isNaN(num) && num > 0) setAmountErrors(prev => { const n = { ...prev }; delete n[userId]; return n })
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

    if (members.length < 1) { setMembersError('At least one member must be in the batch.'); return }

    const newAmountErrors: Record<string, string> = {}
    for (const m of members) {
      if (!m.amount || m.amount <= 0) newAmountErrors[m.user_id] = 'Amount must be greater than 0'
    }

    if (depositType === 'shares') {
      for (const m of members) {
        if (m.shareRemaining === null) { newAmountErrors[m.user_id] = 'Share data is still loading. Please wait.'; continue }
        if (m.shareRemaining <= 0) { newAmountErrors[m.user_id] = 'No remaining share balance.'; continue }
        if (m.amount > m.shareRemaining) newAmountErrors[m.user_id] = `Exceeds share balance. Max: ${currency(m.shareRemaining)}`
      }
    }

    if (depositType === 'savings') {
      for (const m of members) {
        if (!m.savingsAccountId) newAmountErrors[m.user_id] = 'No active savings account.'
      }
    }

    if (Object.keys(newAmountErrors).length > 0) { setAmountErrors(newAmountErrors); return }

    if (depositType === 'shares' && values.reference?.trim()) {
      const { data: existing } = await supabase.from('equity_deposit_requests').select('id').eq('reference', values.reference.trim()).limit(1)
      if (existing && existing.length > 0) { setError('reference', { message: 'This reference number has already been used.' }); return }
    }

    if (!selectedFile) { setUploadError('Please upload a receipt or deposit slip before submitting.'); return }

    let receiptUrl: string | undefined
    if (user) {
      try { receiptUrl = await uploadReceipt(user.id, selectedFile) }
      catch (err: any) { setUploadError(err.message ?? 'Failed to upload receipt.'); return }
    }

    if (depositType === 'shares') {
      await submitBatch.mutateAsync({
        payment_method: values.payment_method,
        reference: values.reference,
        receipt_url: receiptUrl,
        notes: values.notes,
        items: members.map(m => ({ user_id: m.user_id, amount: m.amount })),
      })
    } else {
      const inserts = members.map(m => ({
        user_id: m.user_id,
        account_id: m.savingsAccountId!,
        amount: m.amount,
        payment_method: values.payment_method,
        reference: values.reference ?? null,
        receipt_url: receiptUrl ?? null,
        notes: values.notes ?? null,
        status: 'pending',
      }))
      const { error } = await supabase.from('savings_deposit_requests').insert(inserts)
      if (error) { toast({ title: error.message ?? 'Failed to submit', variant: 'error' }); return }
    }

    toast({
      title: 'Deposit submitted!',
      description: 'Your deposit is pending admin review.',
      variant: 'success',
    })
    queryClient.invalidateQueries({ queryKey: ['my_deposit_requests'] })
    queryClient.invalidateQueries({ queryKey: ['savings_deposit_requests'] })
    onClose()
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Submit Deposit" size="xl">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5 pb-2">

        {/* Deposit type selector — when locked to one type, only show that button */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Deposit To <span className="text-red-500">*</span>
          </label>
          <div className={defaultType ? 'block' : 'grid grid-cols-2 gap-3'}>
            {(defaultType === 'shares' || !defaultType) && (
              <button
                type="button"
                onClick={() => { if (!defaultType) { setDepositType('shares'); setAmountErrors({}) } }}
                className={`flex items-center gap-2.5 rounded-lg border-2 px-4 py-3 text-sm font-medium w-full ${
                  defaultType === 'shares'
                    ? 'border-blue-500 bg-blue-50 text-blue-700 cursor-default'
                    : depositType === 'shares'
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'
                }`}
              >
                <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
                </svg>
                <div className="text-left">
                  <p className="font-semibold">Equity Shares</p>
                  <p className="text-xs font-normal text-gray-500">Share capital deposit</p>
                </div>
              </button>
            )}
            {(defaultType === 'savings' || !defaultType) && (
              <button
                type="button"
                onClick={() => { if (!defaultType) { setDepositType('savings'); setAmountErrors({}) } }}
                className={`flex items-center gap-2.5 rounded-lg border-2 px-4 py-3 text-sm font-medium w-full ${
                  defaultType === 'savings'
                    ? 'border-emerald-500 bg-emerald-50 text-emerald-700 cursor-default'
                    : depositType === 'savings'
                    ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                    : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'
                }`}
              >
                <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
                <div className="text-left">
                  <p className="font-semibold">Savings</p>
                  <p className="text-xs font-normal text-gray-500">Savings account deposit</p>
                </div>
              </button>
            )}
          </div>
        </div>

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
              <img src={previewUrl} alt="Receipt preview" className="max-h-40 mx-auto rounded-lg object-contain" />
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

        {/* Add member by employee ID — shares only */}
        {depositType === 'shares' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Add Member by Employee ID
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
              <Button type="button" variant="outline" size="sm" loading={isLooking} onClick={lookupByEmployeeId} disabled={!employeeIdInput.trim()}>
                Add
              </Button>
            </div>
            {lookupError && <p className="mt-1 text-xs text-red-600">{lookupError}</p>}
            {membersError && <p className="mt-1 text-xs text-red-600">{membersError}</p>}
          </div>
        )}

        {/* Members list */}
        <div className="space-y-2">
          {depositType === 'shares' && (
            <p className="text-sm font-medium text-gray-700">Members in batch ({members.length})</p>
          )}
          <div className="space-y-2">
            {members.map(m => {
              const isLoadingMeta = m.shareRemaining === null
              const hasShareCapacity = m.shareRemaining !== null && m.shareRemaining > 0
              const hasSavings = !!m.savingsAccountId
              return (
                <div key={m.user_id} className={`rounded-lg border px-3 py-2.5 ${m.isSelf ? 'bg-blue-50 border-blue-100' : 'bg-gray-50 border-gray-100'}`}>
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="text-sm font-medium text-gray-800 truncate">{m.full_name}</p>
                        {m.isSelf && (
                          <span className="text-[10px] font-bold bg-blue-600 text-white px-1.5 py-0.5 rounded uppercase tracking-wide flex-shrink-0">You</span>
                        )}
                      </div>
                      <p className="text-xs text-gray-400">{m.employee_id}</p>
                      {isLoadingMeta ? (
                        <p className="text-xs text-gray-400 mt-0.5">Loading account info…</p>
                      ) : depositType === 'shares' ? (
                        <p className={`text-xs mt-0.5 ${hasShareCapacity ? 'text-gray-500' : 'text-red-500'}`}>
                          {hasShareCapacity ? `Remaining share balance: ${currency(m.shareRemaining!)}` : 'No remaining share balance'}
                        </p>
                      ) : (
                        <p className={`text-xs mt-0.5 ${hasSavings ? 'text-gray-500' : 'text-red-500'}`}>
                          {hasSavings ? 'Savings account active' : 'No active savings account'}
                        </p>
                      )}
                      {amountErrors[m.user_id] && (
                        <p className="text-xs text-red-600 mt-0.5">{amountErrors[m.user_id]}</p>
                      )}
                    </div>
                    <input
                      type="number" min="0.01" step="0.01" placeholder="0.00"
                      value={m.amount || ''}
                      onChange={e => updateAmount(m.user_id, e.target.value)}
                      className={`w-28 border rounded-lg px-2 py-1.5 text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-500 flex-shrink-0 ${amountErrors[m.user_id] ? 'border-red-300 focus:ring-red-500' : 'border-gray-300'}`}
                    />
                    {!m.isSelf && depositType === 'shares' && (
                      <button type="button" onClick={() => removeMember(m.user_id)}
                        className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors flex-shrink-0 mt-0.5">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
          {members.length >= 2 && depositType === 'shares' && (
            <div className="flex items-center justify-between bg-blue-50 rounded-lg px-3 py-2.5 mt-2">
              <span className="text-sm font-medium text-blue-800">Total Amount</span>
              <span className="text-lg font-bold text-blue-900">{currency(totalAmount)}</span>
            </div>
          )}
        </div>

        {submitBatch.error && (
          <p className="text-sm text-red-600">{(submitBatch.error as Error).message ?? 'Failed to submit deposit'}</p>
        )}

        <div className="flex gap-3 pt-2">
          <Button type="button" variant="outline" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" className="flex-1" loading={isSubmitting || submitBatch.isPending}>
            Submit Deposit
          </Button>
        </div>
      </form>
    </Modal>
  )
}
