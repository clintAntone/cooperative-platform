import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Header } from '../../components/layout/Header'
import { Card, CardHeader, CardBody } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { Input, Select, Textarea } from '../../components/ui/Input'
import { StatusBadge } from '../../components/shared/StatusBadge'
import { SkeletonDetailPage } from '../../components/shared/Skeleton'
import { Table, Thead, Tbody, Th, Tr, Td } from '../../components/ui/Table'
import { useLoan, useLoanSchedule, useLoanRepayments, useRestructureLoan } from '../../hooks/useLoans'
import { useAuth } from '../../context/AuthContext'
import { useCurrency } from '../../hooks/useCurrency'
import { formatDate, formatDateTime } from '../../lib/utils'

const restructureSchema = z.object({
  new_term: z
    .number({ invalid_type_error: 'Enter a valid number' })
    .int()
    .min(1, 'Min 1 month')
    .max(360),
  new_rate: z
    .number({ invalid_type_error: 'Enter a valid number' })
    .positive('Rate must be positive')
    .max(100),
  new_rate_period: z.enum(['monthly', 'annual']),
  reason: z.string().min(5, 'Please provide a reason (min 5 characters)'),
})

type RestructureFormValues = z.infer<typeof restructureSchema>

const ratePeriodOptions = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'annual', label: 'Annual' },
]

export function AdminLoanDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [isRestructureModalOpen, setIsRestructureModalOpen] = useState(false)

  const { profile } = useAuth()
  const { data: loan, isLoading: loanLoading } = useLoan(id!)
  const { data: schedule, isLoading: scheduleLoading } = useLoanSchedule(id!)
  const { data: repayments, isLoading: repaymentsLoading } = useLoanRepayments(id!)
  const restructureLoan = useRestructureLoan()
  const { format: currency } = useCurrency()

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<RestructureFormValues>({
    resolver: zodResolver(restructureSchema),
    defaultValues: { new_rate_period: 'annual' },
  })

  if (loanLoading || scheduleLoading || repaymentsLoading) return <SkeletonDetailPage cards={3} />

  if (!loan) {
    return (
      <div className="p-6">
        <p className="text-gray-500">Loan not found.</p>
        <Button className="mt-4" variant="outline" onClick={() => navigate('/admin/loans')}>
          Back to Loans
        </Button>
      </div>
    )
  }

  const isAdmin = profile?.role === 'admin'

  const handleOpenRestructureModal = () => {
    reset({ new_rate_period: 'annual' })
    setIsRestructureModalOpen(true)
  }

  const onSubmitRestructure = async (values: RestructureFormValues) => {
    await restructureLoan.mutateAsync({
      loanId: loan.id,
      newTerm: values.new_term,
      newRate: values.new_rate,
      newRatePeriod: values.new_rate_period,
      reason: values.reason,
    })
    setIsRestructureModalOpen(false)
    reset()
  }

  return (
    <div>
      <Header
        title="Loan Details"
        subtitle={`Loan ID: ${loan.id.slice(0, 8)}...`}
        actions={
          <div className="flex gap-2">
            {isAdmin && loan.status === 'active' && (
              <Button size="sm" variant="secondary" onClick={handleOpenRestructureModal}>
                Restructure Loan
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => navigate('/admin/loans')}>
              ← Back
            </Button>
          </div>
        }
      />

      <div className="p-4 sm:p-6 space-y-6">
        {/* Loan Summary KPI Cards */}
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

        {/* Loan Information */}
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
              {loan.calculation_method && (
                <div>
                  <dt className="text-xs text-gray-500">Calculation Method</dt>
                  <dd className="text-sm font-medium text-gray-900 mt-0.5 capitalize">
                    {loan.calculation_method.replace('_', ' ')}
                  </dd>
                </div>
              )}
            </dl>
          </CardBody>
        </Card>

        {/* Repayment Schedule */}
        <Card>
          <CardHeader>
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
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            )}
          </CardBody>
        </Card>

        {/* Repayment History */}
        <Card>
          <CardHeader>
            <h3 className="text-base font-semibold text-gray-900">Repayment History</h3>
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
                          <span className="font-mono text-xs">{repayment.reference}</span>
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

      {/* Restructure Loan Modal */}
      <Modal
        isOpen={isRestructureModalOpen}
        onClose={() => setIsRestructureModalOpen(false)}
        title="Restructure Loan"
      >
        <form onSubmit={handleSubmit(onSubmitRestructure)} className="space-y-4">
          <div className="bg-amber-50 rounded-lg p-3 text-sm text-amber-800">
            Restructuring will generate a new repayment schedule based on the updated terms.
          </div>

          <Input
            label="New Term (months)"
            type="number"
            min={1}
            max={360}
            placeholder="e.g. 24"
            error={errors.new_term?.message}
            required
            {...register('new_term', { valueAsNumber: true })}
          />

          <Input
            label="New Interest Rate (%)"
            type="number"
            step="0.01"
            min="0.01"
            max="100"
            placeholder="e.g. 12.5"
            error={errors.new_rate?.message}
            required
            {...register('new_rate', { valueAsNumber: true })}
          />

          <Select
            label="Rate Period"
            options={ratePeriodOptions}
            error={errors.new_rate_period?.message}
            required
            {...register('new_rate_period')}
          />

          <Textarea
            label="Reason"
            placeholder="Describe the reason for restructuring this loan..."
            rows={3}
            error={errors.reason?.message}
            required
            {...register('reason')}
          />

          {restructureLoan.error && (
            <p className="text-sm text-red-600">
              {(restructureLoan.error as Error).message ?? 'Failed to restructure loan'}
            </p>
          )}

          <div className="flex gap-3 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsRestructureModalOpen(false)}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              loading={isSubmitting || restructureLoan.isPending}
              className="flex-1"
            >
              Confirm Restructure
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
