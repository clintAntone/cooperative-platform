import { useState } from 'react'
import { useNavigate, NavLink, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Header } from '../../components/layout/Header'
import { Card, CardHeader, CardBody } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { StatusBadge } from '../../components/shared/StatusBadge'
import { SkeletonPage } from '../../components/shared/Skeleton'
import { Table, Thead, Tbody, Th, Tr, Td } from '../../components/ui/Table'
import { LoanApplicationForm } from './LoanApplicationForm'
import { useLoanApplications, useLoans, useMyCoMakerRequests, useRespondToCoMakerRequest, useMyApplicationCoMakers } from '../../hooks/useLoans'
import { useMembershipStatus } from '../../hooks/useMembership'
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

export function LendingPage() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const profileIncomplete = !profile?.profile_completed_at
  const { data: membershipStatus, isLoading: membershipLoading } = useMembershipStatus()
  const { data: applications, isLoading: applicationsLoading } = useLoanApplications()
  const { data: loans, isLoading: loansLoading } = useLoans()
  const { data: loanConfigured = false } = useLoanConfigured()
  const { data: coMakerRequests = [] } = useMyCoMakerRequests()
  const respondToCoMaker = useRespondToCoMakerRequest()
  const { data: myAppCoMakers = [] } = useMyApplicationCoMakers()
  const [isApplyModalOpen, setIsApplyModalOpen] = useState(false)

  const { format: currency } = useCurrency()
  const isLoading = membershipLoading || applicationsLoading || loansLoading

  if (isLoading) return <SkeletonPage cards={2} rows={4} />

  const isActiveMember = membershipStatus?.status === 'active'
  const hasCompletedShares = (membershipStatus?.completed_shares ?? 0) > 0
  const activeLoans = loans?.filter(l => l.status === 'active') ?? []
  const hasPendingApplication = applications?.some(
    a => a.status === 'draft' || a.status === 'submitted' || a.status === 'under_review'
  ) ?? false
  const hasActiveLoan = activeLoans.length > 0
  const canApply = isActiveMember && hasCompletedShares && !hasPendingApplication && !hasActiveLoan && loanConfigured

  if (!loanConfigured) {
    return (
      <div>
        <Header title="Loan" subtitle="Loan applications and active loans" />
        <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
          <div className="w-20 h-20 rounded-full bg-blue-50 flex items-center justify-center mb-6">
            <svg className="w-10 h-10 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Loan Products Coming Soon</h2>
          <p className="text-sm text-gray-500 max-w-xs">
            The loan product hasn't been configured yet. Please check back later or contact your cooperative administrator.
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
          <div className="flex items-center gap-2 flex-wrap">
            {(applications && applications.length > 0) && (
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
            {isActiveMember && (
              <Button
                size="sm"
                onClick={() => setIsApplyModalOpen(true)}
                disabled={!canApply || profileIncomplete}
              >
                Apply for Loan
              </Button>
            )}
          </div>
        }
      />

      {/* Profile incomplete notice */}
      {profileIncomplete && (
        <div className="mx-4 sm:mx-6 mt-4 flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4">
          <svg className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
          <div>
            <p className="text-sm font-semibold text-amber-800">Profile incomplete</p>
            <p className="text-xs text-amber-700 mt-0.5">
              You must complete your personal details before applying for a loan.{' '}
              <Link to="/complete-profile" className="underline font-medium">Complete now →</Link>
            </p>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-gray-200 px-4 sm:px-6">
        <div className="flex gap-1">
          <NavLink
            to="/lending"
            end
            className={({ isActive }) =>
              `px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                isActive
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`
            }
          >
            My Loans
          </NavLink>
          <NavLink
            to="/lending/calculator"
            className={({ isActive }) =>
              `px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                isActive
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`
            }
          >
            Loan Calculator
          </NavLink>
        </div>
      </div>

      <div className="p-4 sm:p-6 space-y-6">
        {/* Eligibility Banners */}
        {!isActiveMember && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 flex items-start gap-3">
            <svg className="w-5 h-5 text-yellow-600 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div>
              <p className="text-sm font-medium text-yellow-800">Loan eligibility requires active membership</p>
              <p className="text-sm text-yellow-700 mt-0.5">
                Complete at least one equity share to become an active member and unlock loan access.
              </p>
            </div>
          </div>
        )}
        {isActiveMember && !hasCompletedShares && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 flex items-start gap-3">
            <svg className="w-5 h-5 text-yellow-600 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div>
              <p className="text-sm font-medium text-yellow-800">No completed equity shares</p>
              <p className="text-sm text-yellow-700 mt-0.5">
                You must fully pay at least one equity share before you can apply for a loan.
              </p>
            </div>
          </div>
        )}
        {isActiveMember && hasCompletedShares && hasActiveLoan && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-start gap-3">
            <svg className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <p className="text-sm font-medium text-blue-800">You already have an active loan</p>
              <p className="text-sm text-blue-700 mt-0.5">
                Only one active loan is allowed at a time. Please settle your current loan before applying for a new one.
              </p>
            </div>
          </div>
        )}
        {isActiveMember && hasCompletedShares && !hasActiveLoan && hasPendingApplication && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-start gap-3">
            <svg className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <p className="text-sm font-medium text-blue-800">Application already in progress</p>
              <p className="text-sm text-blue-700 mt-0.5">
                You have a pending loan application. Wait for it to be processed before submitting a new one.
              </p>
            </div>
          </div>
        )}
        {isActiveMember && hasCompletedShares && !hasActiveLoan && !hasPendingApplication && !loanConfigured && (
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 flex items-start gap-3">
            <svg className="w-5 h-5 text-gray-500 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <p className="text-sm font-medium text-gray-700">Loan products not yet configured</p>
              <p className="text-sm text-gray-500 mt-0.5">
                The administrator has not set up loan interest rates yet. Please check back later.
              </p>
            </div>
          </div>
        )}

        {/* Guarantor Requests */}
        {coMakerRequests.length > 0 && (
          <Card>
            <CardHeader>
              <div>
                <h3 className="text-base font-semibold text-gray-900">Co-maker Requests</h3>
                <p className="text-sm text-gray-500">Members who added you as a co-maker on their loan application</p>
              </div>
            </CardHeader>
            <CardBody className="divide-y divide-gray-100">
              {coMakerRequests.map(req => (
                <div key={req.id} className="py-4 flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-900">{req.applicant_name}</p>
                    <p className="text-sm text-gray-500 mt-0.5">
                      {currency(req.amount_requested)} · {req.term_months} months
                      {req.purpose && (
                        <span className="text-gray-400"> · {req.purpose}</span>
                      )}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      Requested on {formatDate(req.created_at)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {req.status === 'pending' ? (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => respondToCoMaker.mutate({ applicationId: req.application_id, status: 'declined' })}
                          disabled={respondToCoMaker.isPending}
                        >
                          Decline
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => respondToCoMaker.mutate({ applicationId: req.application_id, status: 'confirmed' })}
                          disabled={respondToCoMaker.isPending}
                        >
                          Confirm
                        </Button>
                      </>
                    ) : (
                      <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                        req.status === 'confirmed'
                          ? 'bg-green-100 text-green-800'
                          : 'bg-red-100 text-red-800'
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
              <div>
                <h3 className="text-base font-semibold text-gray-900">Active Loans</h3>
                <p className="text-sm text-gray-500">{activeLoans.length} active loan(s)</p>
              </div>
            </CardHeader>
            <CardBody className="p-0">
              {/* Mobile cards */}
              <div className="sm:hidden divide-y divide-gray-100">
                {activeLoans.map(loan => (
                  <div key={loan.id} className="p-4">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-lg font-bold text-gray-900">{currency(loan.principal)}</span>
                      <StatusBadge status={loan.status} />
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs mb-3">
                      <span className="text-gray-500">Outstanding</span>
                      <span className="font-medium text-gray-900">{currency(loan.outstanding)}</span>
                      <span className="text-gray-500">Interest</span>
                      <span className="text-gray-700">{loan.interest_rate}%</span>
                      <span className="text-gray-500">Due Date</span>
                      <span className="text-gray-700">{formatDate(loan.due_date)}</span>
                    </div>
                    <button
                      className="text-xs text-blue-600 hover:underline"
                      onClick={() => navigate(`/lending/${loan.id}`)}
                    >
                      View Details →
                    </button>
                  </div>
                ))}
              </div>
              {/* Desktop table */}
              <div className="hidden sm:block">
                <Table>
                  <Thead>
                    <Tr>
                      <Th>Principal</Th>
                      <Th>Outstanding</Th>
                      <Th>Interest Rate</Th>
                      <Th>Due Date</Th>
                      <Th>Status</Th>
                      <Th></Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {activeLoans.map(loan => (
                      <Tr key={loan.id} onClick={() => navigate(`/lending/${loan.id}`)}>
                        <Td>{currency(loan.principal)}</Td>
                        <Td>
                          <span className="font-medium text-gray-900">{currency(loan.outstanding)}</span>
                        </Td>
                        <Td>{loan.interest_rate}% p.a.</Td>
                        <Td>{formatDate(loan.due_date)}</Td>
                        <Td><StatusBadge status={loan.status} /></Td>
                        <Td>
                          <button
                            className="text-blue-600 text-sm hover:underline"
                            onClick={e => {
                              e.stopPropagation()
                              navigate(`/lending/${loan.id}`)
                            }}
                          >
                            View
                          </button>
                        </Td>
                      </Tr>
                    ))}
                  </Tbody>
                </Table>
              </div>
            </CardBody>
          </Card>
        )}

        {/* Loan Applications */}
        <Card>
          <CardHeader>
            <div>
              <h3 className="text-base font-semibold text-gray-900">Loan Applications</h3>
              <p className="text-sm text-gray-500">{applications?.length ?? 0} application(s)</p>
            </div>
          </CardHeader>
          <CardBody className="p-0">
            {!applications || applications.length === 0 ? (
              <div className="py-12 text-center">
                <svg className="w-10 h-10 text-gray-300 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <p className="text-sm text-gray-500">No loan applications yet</p>
              </div>
            ) : (
              <>
                {/* Mobile cards */}
                <div className="sm:hidden divide-y divide-gray-100">
                  {applications.map(app => {
                    const appCoMakers = myAppCoMakers.filter(cm => cm.application_id === app.id)
                    const declined = appCoMakers.filter(cm => cm.status === 'declined').length
                    return (
                      <div key={app.id} className="p-4">
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-bold text-gray-900">{currency(app.amount_requested)}</span>
                          {app.status === 'draft' ? (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-yellow-700 bg-yellow-50 px-2 py-0.5 rounded-full">
                              Awaiting co-maker confirmation
                            </span>
                          ) : (
                            <StatusBadge status={app.status} />
                          )}
                        </div>
                        {app.purpose && (
                          <p className="text-xs text-gray-500 line-clamp-2 mb-2">{app.purpose}</p>
                        )}
                        {app.status === 'rejected' && app.rejection_reason && (
                          <p className="text-xs text-red-600 mb-2">{app.rejection_reason}</p>
                        )}
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs mb-2">
                          <span className="text-gray-500">Term</span>
                          <span className="text-gray-700">{app.term_months} months</span>
                          <span className="text-gray-500">Applied</span>
                          <span className="text-gray-700">{formatDate(app.created_at)}</span>
                        </div>
                        {appCoMakers.length > 0 && (
                          <div className="flex flex-col gap-0.5 mt-1">
                            {appCoMakers.map(cm => (
                              <span key={cm.co_maker_user_id} className={`text-xs ${
                                cm.status === 'confirmed' ? 'text-green-700' :
                                cm.status === 'declined'  ? 'text-red-600' :
                                'text-yellow-700'
                              }`}>
                                {cm.full_name} {cm.status === 'confirmed' ? '✓' : cm.status === 'declined' ? '✗' : '⏳'}
                              </span>
                            ))}
                            {declined > 0 && (
                              <p className="text-xs text-red-500 mt-0.5">
                                {declined} declined — contact them to re-confirm
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
                {/* Desktop table */}
                <div className="hidden sm:block">
                  <Table>
                    <Thead>
                      <Tr>
                        <Th>Amount Requested</Th>
                        <Th>Purpose</Th>
                        <Th>Term</Th>
                        <Th>Status</Th>
                        <Th>Co-makers</Th>
                        <Th>Applied On</Th>
                      </Tr>
                    </Thead>
                    <Tbody>
                      {applications.map(app => {
                        const appCoMakers = myAppCoMakers.filter(cm => cm.application_id === app.id)
                        const declined = appCoMakers.filter(cm => cm.status === 'declined').length
                        return (
                          <Tr key={app.id}>
                            <Td>
                              <span className="font-medium">{currency(app.amount_requested)}</span>
                            </Td>
                            <Td>
                              <span className="max-w-xs truncate block" title={app.purpose ?? undefined}>
                                {app.purpose ?? '—'}
                              </span>
                            </Td>
                            <Td>{app.term_months} months</Td>
                            <Td>
                              {app.status === 'draft' ? (
                                <span className="inline-flex items-center gap-1 text-xs font-medium text-yellow-700 bg-yellow-50 px-2 py-0.5 rounded-full">
                                  Awaiting co-maker confirmation
                                </span>
                              ) : (
                                <div className="space-y-1">
                                  <StatusBadge status={app.status} />
                                  {app.status === 'rejected' && app.rejection_reason && (
                                    <p className="text-xs text-red-600 max-w-[180px]" title={app.rejection_reason}>
                                      {app.rejection_reason}
                                    </p>
                                  )}
                                </div>
                              )}
                            </Td>
                            <Td>
                              {appCoMakers.length > 0 ? (
                                <div className="flex flex-col gap-0.5">
                                  {appCoMakers.map(cm => (
                                    <span key={cm.co_maker_user_id} className={`text-xs ${
                                      cm.status === 'confirmed' ? 'text-green-700' :
                                      cm.status === 'declined'  ? 'text-red-600' :
                                      'text-yellow-700'
                                    }`}>
                                      {cm.full_name} {cm.status === 'confirmed' ? '✓' : cm.status === 'declined' ? '✗' : '⏳'}
                                    </span>
                                  ))}
                                  {declined > 0 && (
                                    <p className="text-xs text-red-500 mt-0.5">
                                      {declined} declined — contact them to re-confirm
                                    </p>
                                  )}
                                </div>
                              ) : (
                                <span className="text-xs text-gray-400">—</span>
                              )}
                            </Td>
                            <Td>{formatDate(app.created_at)}</Td>
                          </Tr>
                        )
                      })}
                    </Tbody>
                  </Table>
                </div>
              </>
            )}
          </CardBody>
        </Card>
      </div>

      {/* Apply Modal */}
      <Modal
        isOpen={isApplyModalOpen}
        onClose={() => setIsApplyModalOpen(false)}
        title="Apply for a Loan"
        size="lg"
      >
        <LoanApplicationForm
          onSuccess={() => setIsApplyModalOpen(false)}
          onCancel={() => setIsApplyModalOpen(false)}
        />
      </Modal>
    </div>
  )
}
