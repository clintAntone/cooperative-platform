export const PERMISSION_KEYS = [
  // Staff permissions
  'approve_deposits',
  'reject_deposits',
  'approve_loan_apps',
  'reject_loan_apps',
  'approve_membership',
  'view_reports',
  'manage_loan_products',
  'restructure_loans',
  // Member permissions
  'apply_for_loan',
  'submit_deposit_request',
  'view_loan_calculator',
] as const

export type PermissionKey = typeof PERMISSION_KEYS[number]

export const PERMISSION_LABELS: Record<PermissionKey, string> = {
  approve_deposits:        'Approve deposit requests',
  reject_deposits:         'Reject deposit requests',
  approve_loan_apps:       'Approve loan applications',
  reject_loan_apps:        'Reject loan applications',
  approve_membership:      'Approve member memberships',
  view_reports:            'View financial reports',
  manage_loan_products:    'Create / edit loan products',
  restructure_loans:       'Restructure active loans',
  apply_for_loan:          'Apply for a loan',
  submit_deposit_request:  'Submit deposit requests',
  view_loan_calculator:    'Use the loan calculator',
}

export const STAFF_PERMISSIONS: PermissionKey[] = [
  'approve_deposits',
  'reject_deposits',
  'approve_loan_apps',
  'reject_loan_apps',
  'approve_membership',
  'view_reports',
  'manage_loan_products',
  'restructure_loans',
]

export const MEMBER_PERMISSIONS: PermissionKey[] = [
  'apply_for_loan',
  'submit_deposit_request',
  'view_loan_calculator',
]
