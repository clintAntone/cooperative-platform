import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { LoanApplication, Loan, LoanRepaymentSchedule, LoanRepayment, EligibleCoMaker, CoMakerRequest, LoanProduct } from '../types'
import { useAuth } from '../context/AuthContext'
import { useEffectiveUserId } from '../context/ImpersonationContext'
import { toast } from '../lib/toast'

export function useLoanApplications(userId?: string) {
  const effectiveUserId = useEffectiveUserId()
  const targetId = userId ?? effectiveUserId

  return useQuery({
    queryKey: ['loan_applications', targetId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('loan_applications')
        .select('id, user_id, amount_requested, purpose, term_months, status, reviewed_by, decision_at, rejection_reason, loan_product_id, created_at, updated_at')
        .eq('user_id', targetId!)
        .order('created_at', { ascending: false })

      if (error) throw error
      return data as LoanApplication[]
    },
    enabled: !!targetId,
  })
}

export function useAllLoanApplications() {
  return useQuery({
    queryKey: ['all_loan_applications'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('loan_applications')
        .select('*, profiles(full_name)')
        .order('created_at', { ascending: false })

      if (error) throw error
      return data
    },
  })
}

export function useLoans(userId?: string) {
  const effectiveUserId = useEffectiveUserId()
  const targetId = userId ?? effectiveUserId

  return useQuery({
    queryKey: ['loans', targetId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('loans')
        .select('id, application_id, user_id, principal, interest_rate, term_months, calculation_method, total_repayable, amount_paid, outstanding, status, disbursed_at, due_date, created_at, updated_at')
        .eq('user_id', targetId!)
        .order('created_at', { ascending: false })

      if (error) throw error
      return data as Loan[]
    },
    enabled: !!targetId,
  })
}

export function useLoan(loanId: string) {
  return useQuery({
    queryKey: ['loan', loanId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('loans')
        .select('id, application_id, user_id, principal, interest_rate, term_months, calculation_method, total_repayable, amount_paid, outstanding, status, disbursed_at, due_date, created_at, updated_at')
        .eq('id', loanId)
        .single()

      if (error) throw error
      return data as Loan
    },
    enabled: !!loanId,
  })
}

export function useLoanSchedule(loanId: string) {
  return useQuery({
    queryKey: ['loan_schedule', loanId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('loan_repayment_schedule')
        .select('id, loan_id, installment_no, due_date, principal_due, interest_due, total_due, amount_paid, status, paid_at')
        .eq('loan_id', loanId)
        .order('installment_no', { ascending: true })

      if (error) throw error
      return data as LoanRepaymentSchedule[]
    },
    enabled: !!loanId,
  })
}

export function useLoanRepayments(loanId: string) {
  return useQuery({
    queryKey: ['loan_repayments', loanId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('loan_repayments')
        .select('id, loan_id, schedule_id, amount, payment_method, reference, recorded_by, payment_at, created_at')
        .eq('loan_id', loanId)
        .order('payment_at', { ascending: false })

      if (error) throw error
      return data as LoanRepayment[]
    },
    enabled: !!loanId,
  })
}

interface LoanApplicationInput {
  amount_requested: number
  purpose: string
  term_months: number
  co_maker_ids: string[]
  loan_product_id?: string
}

export function useCreateLoanApplication() {
  const queryClient = useQueryClient()
  const { user } = useAuth()

  return useMutation({
    mutationFn: async (input: LoanApplicationInput) => {
      const { data, error } = await supabase
        .from('loan_applications')
        .insert({
          user_id: user!.id,
          amount_requested: input.amount_requested,
          purpose: input.purpose,
          term_months: input.term_months,
          loan_product_id: input.loan_product_id ?? null,
          status: 'draft',
        })
        .select()
        .single()

      if (error) throw error

      // Insert co-makers
      if (input.co_maker_ids.length > 0) {
        const { error: coMakerError } = await supabase
          .from('loan_co_makers')
          .insert(
            input.co_maker_ids.map(id => ({
              application_id: (data as LoanApplication).id,
              co_maker_user_id: id,
            }))
          )
        if (coMakerError) throw coMakerError
      }

      return data as LoanApplication
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['loan_applications'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      toast({ title: 'Application submitted', description: 'Waiting for co-maker confirmation', variant: 'success' })
    },
  })
}

export function useEligibleCoMakers() {
  return useQuery({
    queryKey: ['eligible_co_makers'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_eligible_co_makers')
      if (error) throw error
      return (data ?? []) as EligibleCoMaker[]
    },
  })
}

export function useLoanCoMakers(applicationId: string) {
  return useQuery({
    queryKey: ['loan_co_makers', applicationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('loan_co_makers')
        .select('*, profiles!loan_co_makers_co_maker_user_id_fkey(full_name)')
        .eq('application_id', applicationId)
      if (error) throw error
      return data ?? []
    },
    enabled: !!applicationId,
  })
}

interface RecordRepaymentInput {
  loan_id: string
  schedule_id?: string
  amount: number
  payment_method: 'cash' | 'bank_transfer' | 'mobile_money'
  reference?: string
}

export function useRecordRepayment() {
  const queryClient = useQueryClient()
  const { user } = useAuth()

  return useMutation({
    mutationFn: async (input: RecordRepaymentInput) => {
      const { data, error } = await supabase
        .from('loan_repayments')
        .insert({
          loan_id: input.loan_id,
          schedule_id: input.schedule_id ?? null,
          amount: input.amount,
          payment_method: input.payment_method,
          reference: input.reference ?? null,
          recorded_by: user!.id,
        })
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['loan', variables.loan_id] })
      queryClient.invalidateQueries({ queryKey: ['loan_schedule', variables.loan_id] })
      queryClient.invalidateQueries({ queryKey: ['loan_repayments', variables.loan_id] })
      queryClient.invalidateQueries({ queryKey: ['loans'] })
      queryClient.invalidateQueries({ queryKey: ['ledger'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      toast({ title: 'Payment recorded', variant: 'success' })
    },
  })
}

export function useLoanPortfolioStats() {
  return useQuery({
    queryKey: ['loan_portfolio_stats'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('loans')
        .select('principal, outstanding, amount_paid, status')

      if (error) throw error

      const stats = {
        totalDisbursed: 0,
        totalOutstanding: 0,
        totalRepaid: 0,
        activeLoans: 0,
        defaultedLoans: 0,
      }

      data.forEach((loan: { principal: number; outstanding: number; amount_paid: number; status: string }) => {
        stats.totalDisbursed += loan.principal
        stats.totalOutstanding += loan.outstanding
        stats.totalRepaid += loan.amount_paid
        if (loan.status === 'active') stats.activeLoans++
        if (loan.status === 'defaulted') stats.defaultedLoans++
      })

      return stats
    },
  })
}

export function useMyCoMakerRequests() {
  return useQuery({
    queryKey: ['my_co_maker_requests'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_my_co_maker_requests')
      if (error) throw error
      return (data ?? []) as CoMakerRequest[]
    },
    refetchInterval: 60_000,
  })
}

export function usePendingCoMakerCount() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['pending_co_maker_count'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('loan_co_makers')
        .select('id')
        .eq('co_maker_user_id', user!.id)
        .eq('status', 'pending')
      if (error) return 0
      return data?.length ?? 0
    },
    enabled: !!user,
    refetchInterval: 60_000,
  })
}

export function useRespondToCoMakerRequest() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ applicationId, status }: { applicationId: string; status: 'confirmed' | 'declined' }) => {
      const { error } = await supabase.rpc('respond_to_co_maker_request', {
        p_application_id: applicationId,
        p_status: status,
      })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my_co_maker_requests'] })
      queryClient.invalidateQueries({ queryKey: ['loan_co_makers'] })
      queryClient.invalidateQueries({ queryKey: ['pending_co_maker_count'] })
      toast({ title: 'Response recorded', variant: 'success' })
    },
  })
}

export function useAdminApproveLoan() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (applicationId: string) => {
      const { data, error } = await supabase.rpc('admin_approve_loan_application', {
        p_application_id: applicationId,
      })
      if (error) throw error
      return data as string // loan id
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all_loan_applications'] })
      queryClient.invalidateQueries({ queryKey: ['loan_applications'] })
      queryClient.invalidateQueries({ queryKey: ['loans'] })
      queryClient.invalidateQueries({ queryKey: ['loan_portfolio_stats'] })
      queryClient.invalidateQueries({ queryKey: ['member_list_report'] })
      toast({ title: 'Loan approved', variant: 'success' })
    },
  })
}

export function useAdminRejectLoan() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ applicationId, reason }: { applicationId: string; reason?: string }) => {
      const { error } = await supabase.rpc('admin_reject_loan_application', {
        p_application_id: applicationId,
        p_reason: reason ?? null,
      })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all_loan_applications'] })
      queryClient.invalidateQueries({ queryKey: ['loan_applications'] })
      toast({ title: 'Loan application rejected', variant: 'info' })
    },
  })
}

export function useAdminSetUnderReview() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (applicationId: string) => {
      const { error } = await supabase.rpc('admin_set_loan_under_review', {
        p_application_id: applicationId,
      })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all_loan_applications'] })
    },
  })
}

// ── Loan Products ─────────────────────────────────────────────────────────────

export function useLoanProducts() {
  return useQuery({
    queryKey: ['loan_products'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('loan_products')
        .select('id, name, description, interest_rate, min_amount, max_amount, min_term_months, max_term_months, calculation_method, is_active, created_at, created_by')
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as LoanProduct[]
    },
  })
}

export function useActiveLoanProducts() {
  return useQuery({
    queryKey: ['loan_products_active'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('loan_products')
        .select('*')
        .eq('is_active', true)
        .order('name')
      if (error) throw error
      return (data ?? []) as LoanProduct[]
    },
    staleTime: 60_000,
  })
}

export function useCreateLoanProduct() {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  return useMutation({
    mutationFn: async (input: Omit<LoanProduct, 'id' | 'created_at' | 'created_by'>) => {
      const { data, error } = await supabase
        .from('loan_products')
        .insert({ ...input, created_by: user!.id })
        .select()
        .single()
      if (error) throw error
      return data as LoanProduct
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['loan_products'] })
      queryClient.invalidateQueries({ queryKey: ['loan_products_active'] })
      toast({ title: 'Loan product created', variant: 'success' })
    },
  })
}

export function useUpdateLoanProduct() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...patch }: Partial<LoanProduct> & { id: string }) => {
      const { data, error } = await supabase
        .from('loan_products')
        .update(patch)
        .eq('id', id)
        .select()
        .single()
      if (error) throw error
      return data as LoanProduct
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['loan_products'] })
      queryClient.invalidateQueries({ queryKey: ['loan_products_active'] })
    },
  })
}

// ─────────────────────────────────────────────────────────────────────────────

export function useAdminMarkDefaulted() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (loanId: string) => {
      const { error } = await supabase.rpc('admin_mark_loan_defaulted', {
        p_loan_id: loanId,
      })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['loans'] })
      queryClient.invalidateQueries({ queryKey: ['loan_portfolio_stats'] })
    },
  })
}

export interface ApplicationCoMaker {
  application_id: string
  co_maker_user_id: string
  full_name: string
  status: 'pending' | 'confirmed' | 'declined'
  responded_at: string | null
}

export function useMyApplicationCoMakers() {
  return useQuery({
    queryKey: ['my_application_co_makers'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_my_application_co_makers')
      if (error) throw error
      return (data ?? []) as ApplicationCoMaker[]
    },
  })
}

export function useRestructureLoan() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      loanId: string
      newTerm: number
      newRate: number
      newRatePeriod: 'monthly' | 'annual'
      reason: string
    }) => {
      const { error } = await (supabase.rpc as any)('restructure_loan', {
        p_loan_id:         input.loanId,
        p_new_term:        input.newTerm,
        p_new_rate:        input.newRate,
        p_new_rate_period: input.newRatePeriod,
        p_reason:          input.reason,
      })
      if (error) throw error
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['loan', variables.loanId] })
      queryClient.invalidateQueries({ queryKey: ['loan_schedule', variables.loanId] })
      queryClient.invalidateQueries({ queryKey: ['loans'] })
      queryClient.invalidateQueries({ queryKey: ['loan_portfolio_stats'] })
      toast({ title: 'Loan restructured successfully', variant: 'success' })
    },
    onError: (err: any) => {
      toast({ title: err.message ?? 'Failed to restructure loan', variant: 'error' })
    },
  })
}
