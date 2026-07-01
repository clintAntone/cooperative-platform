import { Badge } from '../ui/Badge'

type BadgeVariant = 'gray' | 'yellow' | 'green' | 'red' | 'blue' | 'purple'

function getBadgeVariant(status: string): BadgeVariant {
  switch (status) {
    case 'active':
    case 'completed':
    case 'paid':
    case 'approved':
      return 'green'
    case 'pending':
    case 'draft':
    case 'in_progress':
    case 'submitted':
    case 'partial':
    case 'under_review':
      return 'yellow'
    case 'suspended':
    case 'overdue':
    case 'defaulted':
    case 'rejected':
      return 'red'
    case 'inactive':
    case 'cancelled':
    case 'written_off':
    case 'waived':
      return 'gray'
    default:
      return 'blue'
  }
}

function formatStatusLabel(status: string): string {
  return status
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

interface StatusBadgeProps {
  status: string
  size?: 'sm' | 'md'
  className?: string
}

export function StatusBadge({ status, size = 'sm', className }: StatusBadgeProps) {
  return (
    <Badge variant={getBadgeVariant(status)} size={size} className={className}>
      {formatStatusLabel(status)}
    </Badge>
  )
}
