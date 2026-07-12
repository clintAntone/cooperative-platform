import { Header } from '../../components/layout/Header'
import { Card, CardHeader, CardBody } from '../../components/ui/Card'
import { useRolePermissions, useUpdateRolePermission } from '../../hooks/useRolePermissions'
import { STAFF_PERMISSIONS, MEMBER_PERMISSIONS, BOARD_PERMISSIONS, PERMISSION_LABELS } from '../../lib/permissions'
import { SkeletonPage } from '../../components/shared/Skeleton'
import type { PermissionKey } from '../../lib/permissions'
import { PageGuide } from '../../components/shared/PageGuide'

type EditableRole = 'staff' | 'member' | 'board'

function Toggle({ enabled, onChange, disabled }: { enabled: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!enabled)}
      disabled={disabled}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 ${enabled ? 'bg-blue-600' : 'bg-gray-200'}`}
    >
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-6' : 'translate-x-1'}`} />
    </button>
  )
}

function PermissionRow({
  permissionKey, role, enabled, disabled, onToggle,
}: {
  permissionKey: PermissionKey; role: EditableRole; enabled: boolean; disabled: boolean
  onToggle: (role: EditableRole, key: PermissionKey, value: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-gray-100 last:border-0">
      <span className="text-sm text-gray-800">{PERMISSION_LABELS[permissionKey]}</span>
      <Toggle enabled={enabled} onChange={(v) => onToggle(role, permissionKey, v)} disabled={disabled} />
    </div>
  )
}

function RoleBadge({ label, color }: { label: string; color: string }) {
  return <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${color}`}>{label}</span>
}

export function PermissionsPage() {
  const { data: permissions = [], isLoading } = useRolePermissions()
  const updatePermission = useUpdateRolePermission()

  if (isLoading) return <SkeletonPage />

  const map = new Map(permissions.map((p) => [`${p.role}:${p.permission_key}`, p.enabled]))

  const handleToggle = (role: EditableRole, permission_key: PermissionKey, enabled: boolean) => {
    updatePermission.mutate({ role, permission_key, enabled })
  }

  const isPending = updatePermission.isPending

  return (
    <div>
      <Header title="Permissions" subtitle="Configure what each role can access" />

      <div className="p-4 sm:p-6 space-y-6">
        <PageGuide
          storageKey="permissions"
          steps={[
            'Permissions define what each role can see and do. Admin always has full access.',
            'Staff — can approve/reject transactions. Good for day-to-day operations staff.',
            'Board of Directors — read-only access to reports, members, loans, and cooperative financials. No action buttons.',
            'Collector — can create batch deposits. No other elevated access.',
            'Member — standard member access: apply for loans, deposit requests, savings, transfers.',
            'Review this page before assigning roles to users in Admin → Manage Users.',
          ]}
          note="Permissions are enforced server-side via Row Level Security (RLS) policies — toggling here reflects intended access but does not override database-level enforcement."
        />

        {/* Role summary */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            { role: 'Admin', desc: 'Full access', color: 'bg-purple-100 text-purple-800' },
            { role: 'Staff', desc: 'Approve & review', color: 'bg-blue-100 text-blue-800' },
            { role: 'Board', desc: 'Read-only oversight', color: 'bg-amber-100 text-amber-800' },
            { role: 'Collector', desc: 'Batch deposits only', color: 'bg-green-100 text-green-800' },
            { role: 'Member', desc: 'Self-service', color: 'bg-gray-100 text-gray-800' },
          ].map(r => (
            <div key={r.role} className="rounded-lg border border-gray-200 px-3 py-2.5 text-center">
              <RoleBadge label={r.role} color={r.color} />
              <p className="mt-1.5 text-xs text-gray-500">{r.desc}</p>
            </div>
          ))}
        </div>

        <div className="flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
          <svg className="mt-0.5 h-5 w-5 flex-shrink-0 text-blue-500" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z" clipRule="evenodd" />
          </svg>
          <p className="text-sm text-blue-800">
            Changes take effect immediately. Admin always has full access regardless of these settings.
          </p>
        </div>

        {/* Staff */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <h3 className="text-base font-semibold text-gray-900">Staff Permissions</h3>
              <RoleBadge label="Staff" color="bg-blue-100 text-blue-800" />
            </div>
            <p className="mt-1 text-xs text-gray-500">Day-to-day operations: approvals, reviews, and financial management.</p>
          </CardHeader>
          <CardBody>
            {STAFF_PERMISSIONS.map((key) => (
              <PermissionRow key={key} permissionKey={key} role="staff"
                enabled={map.get(`staff:${key}`) ?? true} disabled={isPending} onToggle={handleToggle} />
            ))}
          </CardBody>
        </Card>

        {/* Board of Directors */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <h3 className="text-base font-semibold text-gray-900">Board of Directors Permissions</h3>
              <RoleBadge label="Board" color="bg-amber-100 text-amber-800" />
            </div>
            <p className="mt-1 text-xs text-gray-500">Read-only financial oversight — board members can view but not modify anything.</p>
          </CardHeader>
          <CardBody>
            {BOARD_PERMISSIONS.map((key) => (
              <PermissionRow key={key} permissionKey={key} role="board"
                enabled={map.get(`board:${key}`) ?? true} disabled={isPending} onToggle={handleToggle} />
            ))}
          </CardBody>
        </Card>

        {/* Member */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <h3 className="text-base font-semibold text-gray-900">Member Permissions</h3>
              <RoleBadge label="Member" color="bg-gray-100 text-gray-800" />
            </div>
            <p className="mt-1 text-xs text-gray-500">Self-service actions members can perform from their own account.</p>
          </CardHeader>
          <CardBody>
            {MEMBER_PERMISSIONS.map((key) => (
              <PermissionRow key={key} permissionKey={key} role="member"
                enabled={map.get(`member:${key}`) ?? true} disabled={isPending} onToggle={handleToggle} />
            ))}
          </CardBody>
        </Card>

        {/* Collector & Admin notes */}
        <div className="grid sm:grid-cols-2 gap-4">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <h3 className="text-sm font-semibold text-gray-900">Collector</h3>
                <RoleBadge label="Collector" color="bg-green-100 text-green-800" />
              </div>
            </CardHeader>
            <CardBody>
              <p className="text-sm text-gray-500">Collectors can create and manage batch deposits on behalf of members. No other elevated access. This is fixed and cannot be toggled.</p>
            </CardBody>
          </Card>
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <h3 className="text-sm font-semibold text-gray-900">Admin</h3>
                <RoleBadge label="Admin" color="bg-purple-100 text-purple-800" />
              </div>
            </CardHeader>
            <CardBody>
              <p className="text-sm text-gray-500">Admins always have full access to every feature including config, user management, dividends, and rebates. This cannot be restricted.</p>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  )
}
