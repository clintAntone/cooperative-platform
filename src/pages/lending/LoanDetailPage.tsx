import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Header } from '../../components/layout/Header'
import { Card, CardHeader, CardBody } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { Input, Select } from '../../components/ui/Input'
import { StatusBadge } from '../../components/shared/StatusBadge'
import { SkeletonDetailPage } from '../../components/shared/Skeleton'
import { Table, Thead, Tbody, Th, Tr, Td } from '../../components/ui/Table'
import { useLoan, useLoanSchedule, useLoanRepayments, useRecordRepayment, useLoanCoMakers } from '../../hooks/useLoans'
import { formatDate, formatDateTime } from '../../lib/utils'
import { useCurrency } from '../../hooks/useCurrency'
import { exportToExcel } from '../../lib/exportExcel'

const repaymentSchema = z.object({
  amount: z
    .number({ invalid_type_error: 'Enter a valid amount' })
    .positive('Amount must be greater than 0'),
  payment_method: z.enum(['cash', 'bank_transfer', 'mobile_money']),
  reference: z.string().optional(),
  schedule_id: z.string().optional(),
})

type RepaymentFormValues = z.infer<typeof repaymentSchema>

const paymentMethodOptions = [
  { value: 'cash', label: 'Cash' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'mobile_money', label: 'Mobile Money' },
]

export function LoanDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [isRepayModalOpen, setIsRepayModalOpen] = useState(false)
  const [selectedScheduleId, setSelectedScheduleId] = useState<string | undefined>()

  const { data: loan, isLoading: loanLoading } = useLoan(id!)
  const { data: schedule, isLoading: scheduleLoading } = useLoanSchedule(id!)
  const { data: repayments, isLoading: repaymentsLoading } = useLoanRepayments(id!)
  const recordRepayment = useRecordRepayment()
  const { data: coMakers = [] } = useLoanCoMakers(loan?.application_id ?? '')
  const { format: currency } = useCurrency()

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<RepaymentFormValues>({
    resolver: zodResolver(repaymentSchema),
    defaultValues: { payment_method: 'cash' },
  })

  if (loanLoading || scheduleLoading || repaymentsLoading) return <SkeletonDetailPage cards={3} />

  if (!loan) {
    return (
      <div className="p-6">
        <p className="text-gray-500">Loan not found.</p>
        <Button className="mt-4" variant="outline" onClick={() => navigate('/lending')}>
          Back to Lending
        </Button>
      </div>
    )
  }

  const handleOpenRepayModal = (schedId?: string) => {
    setSelectedScheduleId(schedId)
    reset({ payment_method: 'cash' })
    setIsRepayModalOpen(true)
  }

  const onSubmitRepayment = async (values: RepaymentFormValues) => {
    await recordRepayment.mutateAsync({
      loan_id: loan.id,
      schedule_id: selectedScheduleId,
      amount: values.amount,
      payment_method: values.payment_method,
      reference: values.reference,
    })
    setIsRepayModalOpen(false)
    reset()
  }

  const progressPercent = loan.total_repayable > 0
    ? Math.min(100, Math.round((loan.amount_paid / loan.total_repayable) * 100))
    : 0

  return (
    <div>
      <Header
        title="Loan Details"
        subtitle={`Loan ID: ${loan.id.slice(0, 8)}...`}
        actions={
          <Button variant="outline" size="sm" onClick={() => navigate('/lending')}>
            ← Back
          </Button>
        }
      />

      <div className="p-4 sm:p-6 space-y-6">
        {/* Loan Summary */}
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
          <Card className="p-3 sm:p-5">
            <p className="text-xs sm:text-sm text-gray-500">Principal</p>
            <p className="text-base sm:text-xl font-bold text-gray-900 mt-1 truncate">{currency(loan.principal)}</p>
          </Card>
          <Card className="p-3 sm:p-5">
            <p className="text-xs sm:text-sm text-gray-500">Outstanding</p>
            <p className="text-base sm:text-xl font-bold text-red-600 mt-1 truncate">{currency(loan.outstanding)}</p>
          </Card>
          <Card className="p-3 sm:p-5">
            <p className="text-xs sm:text-sm text-gray-500">Amount Paid</p>
            <p className="text-base sm:text-xl font-bold text-green-600 mt-1 truncate">{currency(loan.amount_paid)}</p>
          </Card>
          <Card className="p-3 sm:p-5">
            <p className="text-xs sm:text-sm text-gray-500">Status</p>
            <div className="mt-1.5">
              <StatusBadge status={loan.status} size="md" />
            </div>
          </Card>
        </div>

        {/* Progress */}
        <Card>
          <CardBody>
            <div className="flex justify-between items-center mb-2">
              <p className="text-sm font-medium text-gray-700">Repayment Progress</p>
              <p className="text-sm font-semibold text-gray-900">{progressPercent}%</p>
            </div>
            <div className="w-full bg-gray-100 rounded-full h-3">
              <div
                className="h-3 rounded-full bg-green-500 transition-all"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-gray-400 mt-1.5">
              <span>{currency(loan.amount_paid)} paid</span>
              <span>{currency(loan.total_repayable)} total</span>
            </div>
          </CardBody>
        </Card>

        {/* Loan Details */}
        <Card>
          <CardHeader>
            <h3 className="text-base font-semibold text-gray-900">Loan Information</h3>
          </CardHeader>
          <CardBody>
            <dl className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <div>
                <dt className="text-xs text-gray-500">Interest Rate</dt>
                <dd className="text-sm font-medium text-gray-900 mt-0.5">{loan.interest_rate}% per annum</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500">Term</dt>
                <dd className="text-sm font-medium text-gray-900 mt-0.5">{loan.term_months} months</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500">Calculation Method</dt>
                <dd className="text-sm font-medium text-gray-900 mt-0.5 capitalize">
                  {loan.calculation_method.replace('_', ' ')}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500">Total Repayable</dt>
                <dd className="text-sm font-medium text-gray-900 mt-0.5">{currency(loan.total_repayable)}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500">Disbursed At</dt>
                <dd className="text-sm font-medium text-gray-900 mt-0.5">{formatDate(loan.disbursed_at)}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500">Final Due Date</dt>
                <dd className="text-sm font-medium text-gray-900 mt-0.5">{formatDate(loan.due_date)}</dd>
              </div>
            </dl>
          </CardBody>
        </Card>

        {/* Co-makers */}
        {coMakers.length > 0 && (
          <Card>
            <CardHeader>
              <h3 className="text-base font-semibold text-gray-900">Co-makers / Guarantors</h3>
            </CardHeader>
            <CardBody>
              <div className="flex flex-wrap gap-3">
                {coMakers.map((cm: any) => {
                  const status = cm.status ?? 'pending'
                  const statusStyle =
                    status === 'confirmed' ? 'bg-green-50 text-green-800 border-green-200' :
                    status === 'declined'  ? 'bg-red-50 text-red-800 border-red-200' :
                    'bg-yellow-50 text-yellow-800 border-yellow-200'
                  return (
                    <div key={cm.id} className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm font-medium ${statusStyle}`}>
                      <span>{cm.profiles?.full_name ?? 'Unknown'}</span>
                      <span className="text-xs opacity-70 capitalize">{status}</span>
                    </div>
                  )
                })}
              </div>
            </CardBody>
          </Card>
        )}

        {/* Repayment Schedule */}
        <Card>
          <CardHeader
            action={
              <div className="flex gap-2">
                {schedule && schedule.length > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const rows = schedule.map(row => ({
                        '#': row.installment_no,
                        'Due Date': formatDate(row.due_date),
                        'Principal': row.principal_due,
                        'Interest': row.interest_due,
                        'Total Due': row.total_due,
                        'Amount Paid': row.amount_paid,
                        'Status': row.status,
                      }))
                      exportToExcel(rows, 'repayment-schedule')
                    }}
                  >
                    Export
                  </Button>
                )}
                {loan.status === 'active' && (
                  <Button size="sm" onClick={() => handleOpenRepayModal()}>
                    Record Payment
                  </Button>
                )}
              </div>
            }
          >
            <h3 className="text-base font-semibold text-gray-900">Repayment Schedule</h3>
          </CardHeader>
          <CardBody className="p-0">
            {!schedule || schedule.length === 0 ? (
              <p className="text-sm text-gray-500 p-6 text-center">No repayment schedule generated yet</p>
            ) : (
              <Table>
                <Thead>
                  <Tr>
                    <Th>#</Th>
                    <Th>Due Date</Th>
                    <Th>Principal</Th>
                    <Th>Interest</Th>
                    <Th>Total Due</Th>
                    <Th>Paid</Th>
                    <Th>Status</Th>
                    <Th></Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {schedule.map(row => (
                    <Tr key={row.id}>
                      <Td>{row.installment_no}</Td>
                      <Td>{formatDate(row.due_date)}</Td>
                      <Td>{currency(row.principal_due)}</Td>
                      <Td>{currency(row.interest_due)}</Td>
                      <Td className="font-medium">{currency(row.total_due)}</Td>
                      <Td>{currency(row.amount_paid)}</Td>
                      <Td><StatusBadge status={row.status} /></Td>
                      <Td>
                        {(row.status === 'pending' || row.status === 'partial' || row.status === 'overdue') && loan.status === 'active' && (
                          <button
                            className="text-blue-600 text-xs hover:underline"
                            onClick={() => handleOpenRepayModal(row.id)}
                          >
                            Pay
                          </button>
                        )}
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            )}
          </CardBody>
        </Card>

        {/* Payment History */}
        <Card>
          <CardHeader>
            <h3 className="text-base font-semibold text-gray-900">Payment History</h3>
          </CardHeader>
          <CardBody className="p-0">
            {!repayments || repayments.length === 0 ? (
              <p className="text-sm text-gray-500 p-6 text-center">No payments recorded yet</p>
            ) : (
              <Table>
                <Thead>
                  <Tr>
                    <Th>Date</Th>
                    <Th>Amount</Th>
                    <Th>Method</Th>
                    <Th>Reference</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {repayments.map(repayment => (
                    <Tr key={repayment.id}>
                      <Td>{formatDateTime(repayment.payment_at)}</Td>
                      <Td className="font-medium text-green-700">{currency(repayment.amount)}</Td>
                      <Td className="capitalize">{repayment.payment_method.replace('_', ' ')}</Td>
                      <Td>
                        {repayment.reference ? (
                          <span className="inline-flex items-center gap-1.5">
                            <span className="font-mono text-xs">{repayment.reference}</span>
                            <button
                              onClick={() => navigator.clipboard.writeText(repayment.reference!)}
                              title="Copy reference"
                              className="text-gray-400 hover:text-gray-600"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                  d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                              </svg>
                            </button>
                          </span>
                        ) : '—'}
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            )}
          </CardBody>
        </Card>
      </div>

      {/* Record Repayment Modal */}
      <Modal
        isOpen={isRepayModalOpen}
        onClose={() => setIsRepayModalOpen(false)}
        title="Record Loan Repayment"
      >
        <form onSubmit={handleSubmit(onSubmitRepayment)} className="space-y-4">
          {selectedScheduleId && (
            <div className="bg-blue-50 rounded-lg p-3 text-sm text-blue-800">
              Recording payment for a specific installment
            </div>
          )}

          <Input
            label="Amount"
            type="number"
            step="0.01"
            min="0.01"
            placeholder="0.00"
            error={errors.amount?.message}
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
            {...register('reference')}
          />

          {recordRepayment.error && (
            <p className="text-sm text-red-600">
              {(recordRepayment.error as Error).message ?? 'Failed to record payment'}
            </p>
          )}

          <div className="flex gap-3 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsRepayModalOpen(false)}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              loading={isSubmitting || recordRepayment.isPending}
              className="flex-1"
            >
              Record Payment
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
