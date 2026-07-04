export type UserRole = 'admin' | 'member' | 'staff' | 'collector'
export type AccountStatus = 'active' | 'suspended' | 'inactive'
export type MembershipStatusValue = 'pending' | 'active' | 'suspended' | 'inactive'
export type CivilStatus = 'single' | 'married' | 'widowed' | 'separated' | 'divorced'
export type EquityShareStatus = 'in_progress' | 'completed' | 'cancelled'
export type PaymentMethod = 'cash' | 'bank_transfer' | 'mobile_money'
export type LoanApplicationStatus = 'draft' | 'submitted' | 'under_review' | 'approved' | 'rejected' | 'cancelled'

export interface LoanProduct {
  id: string
  name: string
  description: string | null
  interest_rate: number
  interest_rate_period: 'monthly' | 'annual'
  calculation_method: 'flat' | 'reducing_balance' | 'equal_principal'
  min_amount: number
  max_amount: number | null
  min_term_months: number
  max_term_months: number
  is_active: boolean
  created_at: string
  created_by: string | null
  processing_fee_type: 'fixed' | 'percentage' | null
  processing_fee_value: number | null
  insurance_type: 'fixed' | 'percentage' | null
  insurance_value: number | null
  service_fee_type: 'fixed' | 'percentage' | null
  service_fee_value: number | null
  cbu_type: 'fixed' | 'percentage' | null
  cbu_value: number | null
}
export type LoanStatus = 'active' | 'completed' | 'defaulted' | 'written_off'
export type RepaymentScheduleStatus = 'pending' | 'partial' | 'paid' | 'overdue' | 'waived'
export type LedgerEntryType = 'equity_contribution' | 'equity_reversal' | 'loan_disbursement' | 'loan_repayment' | 'fee' | 'adjustment'
export type LedgerDirection = 'debit' | 'credit'
export type ConfigValueType = 'string' | 'number' | 'boolean' | 'enum'

export interface Profile {
  id: string
  full_name: string
  phone: string | null
  role: UserRole
  account_status: AccountStatus
  employee_id: string | null
  avatar_url: string | null
  date_of_birth: string | null
  address: string | null
  civil_status: CivilStatus | null
  emergency_contact_name: string | null
  emergency_contact_phone: string | null
  profile_completed_at: string | null
  created_at: string
  updated_at: string
}

export interface EquityShare {
  id: string
  user_id: string
  share_number: number
  target_amount: number
  paid_amount: number
  status: EquityShareStatus
  completed_at: string | null
  created_at: string
  updated_at: string
}

export interface EquityContribution {
  id: string
  user_id: string
  share_id: string
  deposit_request_id: string | null
  amount: number
  payment_method: PaymentMethod
  reference: string | null
  recorded_by: string | null
  contribution_at: string
  created_at: string
  deposit_requests?: { receipt_url: string | null } | null
}

export interface MembershipStatus {
  id: string
  user_id: string
  status: MembershipStatusValue
  completed_shares: number
  last_evaluated_at: string
  reason: string | null
  updated_at: string
}

export interface MembershipHistory {
  id: string
  user_id: string
  from_status: MembershipStatusValue | null
  to_status: MembershipStatusValue
  reason: string | null
  changed_by_name: string | null
  changed_at: string
}

export interface LoanApplication {
  id: string
  user_id: string
  loan_product_id: string | null
  amount_requested: number
  purpose: string | null
  term_months: number
  status: LoanApplicationStatus
  reviewed_by: string | null
  decision_at: string | null
  rejection_reason: string | null
  created_at: string
  updated_at: string
}

export interface Loan {
  id: string
  application_id: string
  user_id: string
  principal: number
  interest_rate: number
  term_months: number
  calculation_method: 'flat' | 'reducing_balance'
  total_repayable: number
  amount_paid: number
  outstanding: number
  status: LoanStatus
  disbursed_at: string
  due_date: string
  created_at: string
}

export interface LoanRepaymentSchedule {
  id: string
  loan_id: string
  installment_no: number
  due_date: string
  principal_due: number
  interest_due: number
  total_due: number
  amount_paid: number
  status: RepaymentScheduleStatus
  paid_at: string | null
}

export interface LoanRepayment {
  id: string
  loan_id: string
  schedule_id: string | null
  amount: number
  payment_method: PaymentMethod
  reference: string | null
  recorded_by: string | null
  payment_at: string
  created_at: string
}

export interface LoanCoMaker {
  id: string
  application_id: string
  co_maker_user_id: string
  status: 'pending' | 'confirmed' | 'declined'
  responded_at: string | null
  created_at: string
}

export interface EligibleCoMaker {
  id: string
  full_name: string
}

export interface CoMakerRequest {
  id: string
  application_id: string
  status: 'pending' | 'confirmed' | 'declined'
  responded_at: string | null
  created_at: string
  applicant_name: string
  amount_requested: number
  term_months: number
  purpose: string | null
  application_status: string
}

export interface LedgerEntry {
  id: string
  user_id: string
  entry_type: LedgerEntryType
  reference_id: string
  reference_table: string
  amount: number
  direction: LedgerDirection
  notes: string | null
  created_by: string | null
  created_at: string
}

export interface SystemConfig {
  id: string
  config_key: string
  config_value: string
  value_type: ConfigValueType
  description: string | null
  updated_by: string | null
  updated_at: string
}

export interface SystemConfigHistory {
  id: string
  config_key: string
  old_value: string | null
  new_value: string
  changed_by: string | null
  changed_at: string
}

export type DepositRequestStatus = 'pending' | 'approved' | 'rejected'

export interface DepositRequest {
  id: string
  user_id: string
  share_id: string
  amount: number
  payment_method: PaymentMethod
  reference: string | null
  receipt_url: string | null
  notes: string | null
  status: DepositRequestStatus
  reviewed_by: string | null
  reviewed_at: string | null
  rejection_reason: string | null
  created_at: string
  updated_at: string
}
