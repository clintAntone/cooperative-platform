import { useState } from 'react'
import { useNavigate, NavLink, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Header } from '../../components/layout/Header'
import { Card, CardHeader, CardBody } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { StatusBadge } from '../../components/shared/StatusBadge'
import { SkeletonPage } from '../../components/shared/Skeleton'
import { LoanApplicationForm } from './LoanApplicationForm'
import { useLoanApplications, useLoans, useMyCoMakerRequests, useRespondToCoMakerRequest, useMyApplicationCoMakers, useCancelLoanApplication } from '../../hooks/useLoans'
import { useMembershipStatus } from '../../hooks/useMembership'
import { useSavingsAccount } from '../../hooks/useSavings'
import { useAuth } from '../../context/AuthContext'
import { formatDate } from '../../lib/utils'
import { useCurrency } from '../../hooks/useCurrency'
import { supabase } from '../../lib/supabase'
import { exportToExcel } from '../../lib/exportExcel'

function useLoanConfigured() {
  return useQuery({
    queryKey: ['loan_configured'],
    queryFn: async () => {
      const { count } = await supabase
        .from('loan_products')
        .select('*', { count: 'exact', head: true })
        .eq('is_active', true)
      return (count ?? 0) > 0
    },
    staleTime: 60_000,
  })
}

function useLoanMinSavings() {
  return useQuery({
    queryKey: ['loan_min_savings_balance'],
    queryFn: async () => {
      const { data } = await supabase
        .from('system_config')
        .select('config_value')
        .eq('config_key', 'loan_min_savings_balance')
        .single()
      return data ? parseFloat(data.config_value) : 500
    },
    staleTime: Infinity,
  })
}

const FREQUENCY_LABEL: Record<string, string> = {
  weekly:       'Weekly',
  bi_weekly:    'Bi-Weekly',
  semi_monthly: 'Semi-Monthly',
  monthly:      'Monthly',
}

export function LendingPage() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const profileIncomplete = !profile?.profile_completed_at
  const { data: membershipStatus, isLoading: membershipLoading } = useMembershipStatus()
  const { data: applications, isLoading: applicationsLoading } = useLoanApplications()
  const { data: loans, isLoading: loansLoading } = useLoans()
  const { data: loanConfigured = false } = useLoanConfigured()
  const { data: minSavings = 500 } = useLoanMinSavings()
  const { data: coMakerRequests = [] } = useMyCoMakerRequests()
  const respondToCoMaker = useRespondToCoMakerRequest()
  const { data: myAppCoMakers = [] } = useMyApplicationCoMakers()
  const cancelApplication = useCancelLoanApplication()
  const { data: savingsAccount } = useSavingsAccount()
  const [isApplyModalOpen, setIsApplyModalOpen] = useState(false)

  const { format: currency } = useCurrency()
  const isLoading = membershipLoading || applicationsLoading || loansLoading

  if (isLoading) return <SkeletonPage cards={2} rows={4} />

  const hasCompletedShares = (membershipStatus?.completed_shares ?? 0) > 0
  const savingsBalance = savingsAccount?.balance ?? 0
  const hasSufficientSavings = savingsBalance >= minSavings
  const activeLoans = loans?.filter(l => l.status === 'active') ?? []
  const hasPendingApplication = applications?.some(
    a => a.status === 'draft' || a.status === 'submitted' || a.status === 'under_review'
  ) ?? false
  const hasActiveLoan = activeLoans.length > 0
  const canApply = hasCompletedShares && hasSufficientSavings && !hasPendingApplication && !hasActiveLoan && loanConfigured && !profileIncomplete

  if (!loanConfigured) {
    return (
      <div>
        <Header title="Loan" subtitle="Loan applications and active loans" />
        <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
          <div className="w-16 h-16 rounded-full bg-blue-50 flex items-center justify-center mb-4">
            <svg className="w-8 h-8 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 className="text-lg font-bold text-gray-900 mb-1">Loan Products Coming Soon</h2>
          <p className="text-sm text-gray-500 max-w-xs">
            No loan products have been configured yet. Check back later or contact your admin.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div>
      <Header
        title="Loan"
        subtitle="Loan applications and active loans"
        actions={
          <div className="flex items-center gap-2">
            {applications && applications.length > 0 && (
              <button
                onClick={() => {
                  const rows = (applications ?? []).map(app => ({
                    Amount: app.amount_requested,
                    Purpose: app.purpose ?? '',
                    'Term (months)': app.term_months,
                    Status: app.status,
                    'Applied On': formatDate(app.created_at),
                  }))
                  exportToExcel(rows, 'loan-applications')
                }}
                title="Export to Excel"
                className="inline-flex items-center gap-1.5 border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" />
                </svg>
                <span className="hidden sm:inline">Export</span>
              </button>
            )}
            <Button size="sm" onClick={() => setIsApplyModalOpen(true)} disabled={!canApply}>
              Apply for Loan
            </Button>
          </div>
        }
      />

      <div className="p-4 sm:p-6 space-y-4">

        {/* Eligibility checklist — shown when user can't apply yet */}
        {!canApply && (
          <Card>
            <CardHeader>
              <h3 className="text-sm font-semibold text-gray-900">Loan Eligibility</h3>
              <p className="text-xs text-gray-500 mt-0.5">Complete all steps below to unlock your loan application.</p>
            </CardHeader>
            <CardBody className="space-y-3">

              {/* Step 1: Complete a share */}
              <EligibilityStep
                done={hasCompletedShares}
                label="Complete an equity share"
                description={hasCompletedShares
                  ? 'You have at least one completed share.'
                  : 'Fully pay at least one equity share. This also opens your savings account.'}
                action={!hasCompletedShares
                  ? <Link to="/equity" className="text-xs text-blue-600 font-medium hover:underline">Go to Shares →</Link>
                  : null}
              />

              {/* Step 2: Build savings */}
              <EligibilityStep
                done={hasSufficientSavings}
                label={`Maintain savings balance of at least ${currency(minSavings)}`}
                description={hasSufficientSavings
                  ? `Your savings balance is ${currency(savingsBalance)}.`
                  : savingsAccount
                    ? `Your current balance is ${currency(savingsBalance)}. Deposit at least ${currency(minSavings - savingsBalance)} more.`
                    : 'Complete a share first to open your savings account.'}
                action={hasCompletedShares && !hasSufficientSavings
                  ? <Link to="/savings" className="text-xs text-blue-600 font-medium hover:underline">Go to Savings →</Link>
                  : null}
              />

              {/* Step 3: No active loan or pending application */}
              <EligibilityStep
                done={!hasActiveLoan && !hasPendingApplication}
                label="No active loan or pending application"
                description={hasActiveLoan
                  ? 'Settle your current loan before applying for a new one.'
                  : hasPendingApplication
                    ? 'Your current application is being processed.'
                    : 'You\'re clear to apply.'}
              />

              {/* Step 4: Complete profile */}
              {profileIncomplete && (
                <EligibilityStep
                  done={false}
                  label="Complete your profile"
                  description="Your personal details are required before applying."
                  action={<Link to="/complete-profile" className="text-xs text-blue-600 font-medium hover:underline">Complete profile →</Link>}
                />
              )}

            </CardBody>
          </Card>
        )}

        {/* Co-maker Requests */}
        {coMakerRequests.length > 0 && (
          <Card>
            <CardHeader>
              <h3 className="text-sm font-semibold text-gray-900">Co-maker Requests</h3>
              <p className="text-xs text-gray-500 mt-0.5">Members who added you as guarantor on their application</p>
            </CardHeader>
            <CardBody className="divide-y divide-gray-100 p-0">
              {coMakerRequests.map(req => (
                <div key={req.id} className="px-4 py-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900">{req.applicant_name}</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {currency(req.amount_requested)} · {req.term_months} months
                      {req.purpose && <span className="text-gray-400"> · {req.purpose}</span>}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">Requested {formatDate(req.created_at)}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {req.status === 'pending' ? (
                      <>
                        <Button size="sm" variant="outline"
                          onClick={() => respondToCoMaker.mutate({ applicationId: req.application_id, status: 'declined' })}
                          disabled={respondToCoMaker.isPending}>
                          Decline
                        </Button>
                        <Button size="sm"
                          onClick={() => respondToCoMaker.mutate({ applicationId: req.application_id, status: 'confirmed' })}
                          disabled={respondToCoMaker.isPending}>
                          Confirm
                        </Button>
                      </>
                    ) : (
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                        req.status === 'confirmed' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                      }`}>
                        {req.status === 'confirmed' ? 'Confirmed' : 'Declined'}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </CardBody>
          </Card>
        )}

        {/* Active Loans */}
        {activeLoans.length > 0 && (
          <Card>
            <CardHeader>
              <h3 className="text-sm font-semibold text-gray-900">Active Loans</h3>
            </CardHeader>
            <CardBody className="divide-y divide-gray-100 p-0">
              {activeLoans.map(loan => {
                const paidPct = loan.principal > 0
                  ? Math.round(((loan.principal - loan.outstanding) / loan.principal) * 100)
                  : 0
                return (
                  <div
                    key={loan.id}
                    onClick={() => navigate(`/lending/${loan.id}`)}
                    className="px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div>
                        <p className="text-sm font-bold text-gray-900">{currency(loan.principal)}</p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {loan.interest_rate}% · {FREQUENCY_LABEL[loan.repayment_frequency ?? 'monthly']} · Due {formatDate(loan.due_date)}
                        </p>
                      </div>
                      <StatusBadge status={loan.status} />
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-gray-100 rounded-full h-1.5">
                        <div className="bg-blue-500 h-1.5 rounded-full" style={{ width: `${paidPct}%` }} />
                      </div>
                      <span className="text-xs text-gray-500 shrink-0">{currency(loan.outstanding)} left</span>
                    </div>
                  </div>
                )
              })}
            </CardBody>
          </Card>
        )}

        {/* Loan Applications */}
        <Card>
          <CardHeader>
            <h3 className="text-sm font-semibold text-gray-900">My Applications</h3>
          </CardHeader>
          {!applications || applications.length === 0 ? (
            <CardBody>
              <p className="text-sm text-gray-400 text-center py-6">No applications yet.</p>
            </CardBody>
          ) : (
            <CardBody className="divide-y divide-gray-100 p-0">
              {applications.map(app => {
                const appCoMakers = myAppCoMakers.filter(cm => cm.application_id === app.id)
                const declined = appCoMakers.filter(cm => cm.status === 'declined').length
                return (
                  <div key={app.id} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-3 mb-1">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-900">{currency(app.amount_requested)}</p>
                        {app.purpose && (
                          <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">{app.purpose}</p>
                        )}
                      </div>
                      <div className="shrink-0">
                        {app.status === 'draft' ? (
                          <span className="text-xs font-medium text-yellow-700 bg-yellow-50 px-2 py-0.5 rounded-full whitespace-nowrap">
                            Awaiting co-makers
                          </span>
                        ) : (
                          <StatusBadge status={app.status} />
                        )}
                      </div>
                    </div>

                    <p className="text-xs text-gray-400">{app.term_months} months · Applied {formatDate(app.created_at)}</p>

                    {app.status === 'rejected' && app.rejection_reason && (
                      <p className="text-xs text-red-600 mt-1">{app.rejection_reason}</p>
                    )}

                    {appCoMakers.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
                        {appCoMakers.map(cm => (
                          <span key={cm.co_maker_user_id} className={`text-xs ${
                            cm.status === 'confirmed' ? 'text-green-700' :
                            cm.status === 'declined'  ? 'text-red-600' : 'text-yellow-700'
                          }`}>
                            {cm.full_name} {cm.status === 'confirmed' ? '✓' : cm.status === 'declined' ? '✗' : '⏳'}
                          </span>
                        ))}
                        {declined > 0 && (
                          <p className="text-xs text-red-500 w-full mt-0.5">{declined} co-maker(s) declined</p>
                        )}
                      </div>
                    )}

                    {(app.status === 'draft' || app.status === 'submitted') && (
                      <button
                        onClick={() => { if (confirm('Cancel this loan application?')) cancelApplication.mutate(app.id) }}
                        className="mt-1.5 text-xs text-red-500 hover:text-red-700"
                      >
                        Cancel application
                      </button>
                    )}
                  </div>
                )
              })}
            </CardBody>
          )}
        </Card>

        {/* Loan Calculator tab link */}
        <div className="border-b border-gray-200">
          <div className="flex gap-1">
            <NavLink to="/lending" end
              className={({ isActive }) => `px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${isActive ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
              My Loans
            </NavLink>
            <NavLink to="/lending/calculator"
              className={({ isActive }) => `px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${isActive ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
              Loan Calculator
            </NavLink>
          </div>
        </div>

      </div>

      <Modal isOpen={isApplyModalOpen} onClose={() => setIsApplyModalOpen(false)} title="Apply for a Loan" size="lg">
        <LoanApplicationForm
          onSuccess={() => setIsApplyModalOpen(false)}
          onCancel={() => setIsApplyModalOpen(false)}
        />
      </Modal>
    </div>
  )
}

// ─── Eligibility step component ───────────────────────────────────────────────

function EligibilityStep({
  done,
  label,
  description,
  action,
}: {
  done: boolean
  label: string
  description: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-3">
      <div className={`mt-0.5 w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${
        done ? 'bg-green-100' : 'bg-gray-100'
      }`}>
        {done ? (
          <svg className="w-3 h-3 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          <div className="w-2 h-2 rounded-full bg-gray-300" />
        )}
      </div>
      <div className="min-w-0">
        <p className={`text-sm font-medium ${done ? 'text-gray-400 line-through' : 'text-gray-800'}`}>{label}</p>
        {!done && <p className="text-xs text-gray-500 mt-0.5">{description}</p>}
        {!done && action && <div className="mt-1">{action}</div>}
      </div>
    </div>
  )
}
