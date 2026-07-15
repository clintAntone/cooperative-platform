export const PERMISSION_KEYS = [
  // Staff permissions
  'approve_deposits',
  'reject_deposits',
  'approve_savings',
  'reject_savings',
  'approve_loan_apps',
  'reject_loan_apps',
  'approve_membership',
  'approve_share_transfers',
  'manage_damayan',
  'record_branch_data',
  'view_reports',
  'manage_loan_products',
  'restructure_loans',
  // Member permissions
  'apply_for_loan',
  'submit_deposit_request',
  'submit_savings_request',
  'request_share_transfer',
  'view_loan_calculator',
  'view_branch_portfolio',
  // Board permissions
  'view_reports',
  'view_members',
  'view_branch_portfolio',
  'view_loan_portfolio',
  'view_cooperative_funds',
] as const

// Deduplicate for the type (view_reports and view_branch_portfolio appear in multiple roles)
export type PermissionKey =
  | 'approve_deposits' | 'reject_deposits'
  | 'approve_savings' | 'reject_savings'
  | 'approve_loan_apps' | 'reject_loan_apps'
  | 'approve_membership' | 'approve_share_transfers'
  | 'manage_damayan' | 'record_branch_data'
  | 'view_reports' | 'manage_loan_products' | 'restructure_loans'
  | 'apply_for_loan' | 'submit_deposit_request' | 'submit_savings_request'
  | 'request_share_transfer' | 'view_loan_calculator' | 'view_branch_portfolio'
  | 'view_members' | 'view_loan_portfolio' | 'view_cooperative_funds'

export const PERMISSION_LABELS: Record<PermissionKey, string> = {
  // Staff
  approve_deposits:         'Approve share deposit requests',
  reject_deposits:          'Reject share deposit requests',
  approve_savings:          'Approve savings deposits & withdrawals',
  reject_savings:           'Reject savings deposits & withdrawals',
  approve_loan_apps:        'Approve loan applications',
  reject_loan_apps:         'Reject loan applications',
  approve_membership:       'Approve member memberships',
  approve_share_transfers:  'Approve share transfers between members',
  manage_damayan:           'Create & manage Damayan (mutual aid) events',
  record_branch_data:       'Record branch income & expenses',
  view_reports:             'View financial reports & analytics',
  manage_loan_products:     'Create / edit loan products',
  restructure_loans:        'Restructure active loans',
  // Member
  apply_for_loan:           'Apply for a loan',
  submit_deposit_request:   'Submit share deposit requests',
  submit_savings_request:   'Submit savings deposits & withdrawals',
  request_share_transfer:   'Request a share transfer to another member',
  view_loan_calculator:     'Use the loan calculator',
  view_branch_portfolio:    'View branch portfolio & KPIs',
  // Board
  view_members:             'View member list & profiles (read-only)',
  view_loan_portfolio:      'View full loan portfolio (read-only)',
  view_cooperative_funds:   'View dividends, rebates & branch financials (read-only)',
}

export const STAFF_PERMISSIONS: PermissionKey[] = [
  'approve_deposits',
  'reject_deposits',
  'approve_savings',
  'reject_savings',
  'approve_loan_apps',
  'reject_loan_apps',
  'approve_membership',
  'approve_share_transfers',
  'manage_damayan',
  'record_branch_data',
  'view_reports',
  'manage_loan_products',
  'restructure_loans',
]

export const MEMBER_PERMISSIONS: PermissionKey[] = [
  'apply_for_loan',
  'submit_deposit_request',
  'submit_savings_request',
  'request_share_transfer',
  'view_loan_calculator',
  'view_branch_portfolio',
]

export const BOARD_PERMISSIONS: PermissionKey[] = [
  'view_reports',
  'view_members',
  'view_branch_portfolio',
  'view_loan_portfolio',
  'view_cooperative_funds',
]

// All permissions available for custom role configuration, grouped logically
export const CUSTOM_ROLE_PERMISSION_GROUPS: { label: string; keys: PermissionKey[] }[] = [
  {
    label: 'Approvals & Operations',
    keys: [
      'approve_deposits',
      'reject_deposits',
      'approve_savings',
      'reject_savings',
      'approve_loan_apps',
      'reject_loan_apps',
      'approve_membership',
      'approve_share_transfers',
      'manage_damayan',
      'record_branch_data',
      'manage_loan_products',
      'restructure_loans',
    ],
  },
  {
    label: 'View & Reports',
    keys: [
      'view_reports',
      'view_members',
      'view_branch_portfolio',
      'view_loan_portfolio',
      'view_cooperative_funds',
    ],
  },
]
