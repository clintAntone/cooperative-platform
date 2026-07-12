import { Header } from '../../components/layout/Header'
import { Card, CardHeader, CardBody } from '../../components/ui/Card'
import { useRolePermissions, useUpdateRolePermission } from '../../hooks/useRolePermissions'
import { STAFF_PERMISSIONS, MEMBER_PERMISSIONS, PERMISSION_LABELS } from '../../lib/permissions'
import { SkeletonPage } from '../../components/shared/Skeleton'
import type { PermissionKey } from '../../lib/permissions'
import { PageGuide } from '../../components/shared/PageGuide'

function Toggle({
  enabled,
  onChange,
  disabled,
}: {
  enabled: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!enabled)}
      disabled={disabled}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 ${enabled ? 'bg-blue-600' : 'bg-gray-200'}`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-6' : 'translate-x-1'}`}
      />
    </button>
  )
}

function PermissionRow({
  permissionKey,
  role,
  enabled,
  disabled,
  onToggle,
}: {
  permissionKey: PermissionKey
  role: 'staff' | 'member'
  enabled: boolean
  disabled: boolean
  onToggle: (role: 'staff' | 'member', key: PermissionKey, value: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-gray-100 last:border-0">
      <span className="text-sm text-gray-800">{PERMISSION_LABELS[permissionKey]}</span>
      <Toggle
        enabled={enabled}
        onChange={(v) => onToggle(role, permissionKey, v)}
        disabled={disabled}
      />
    </div>
  )
}

export function PermissionsPage() {
  const { data: permissions = [], isLoading } = useRolePermissions()
  const updatePermission = useUpdateRolePermission()

  if (isLoading) return <SkeletonPage />

  const map = new Map(permissions.map((p) => [`${p.role}:${p.permission_key}`, p.enabled]))

  const handleToggle = (role: 'staff' | 'member', permission_key: PermissionKey, enabled: boolean) => {
    updatePermission.mutate({ role, permission_key, enabled })
  }

  const isPending = updatePermission.isPending

  return (
    <div>
      <Header
        title="Permissions"
        subtitle="Configure what staff and members can access"
      />

      <div className="p-4 sm:p-6 space-y-6">
        <PageGuide
          storageKey="permissions"
          steps={[
            'Permissions define what each role (admin, staff, collector, member) can see and do.',
            'Admin has full access. Staff can approve transactions but cannot change config or roles. Collector can create batch deposits.',
            'Review this page to understand who can perform which action before assigning roles to users.',
          ]}
          note="Permissions are enforced server-side via Row Level Security (RLS) policies — changing this display does not change database access."
        />
        {/* Info banner */}
        <div className="flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
          <svg
            className="mt-0.5 h-5 w-5 flex-shrink-0 text-blue-500"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z"
              clipRule="evenodd"
            />
          </svg>
          <p className="text-sm text-blue-800">
            Changes take effect immediately. Admin always has full access regardless of these settings.
          </p>
        </div>

        {/* Staff Permissions */}
        <Card>
          <CardHeader>
            <h3 className="text-base font-semibold text-gray-900">Staff Permissions</h3>
          </CardHeader>
          <CardBody>
            {STAFF_PERMISSIONS.map((key) => (
              <PermissionRow
                key={key}
                permissionKey={key}
                role="staff"
                enabled={map.get(`staff:${key}`) ?? true}
                disabled={isPending}
                onToggle={handleToggle}
              />
            ))}
          </CardBody>
        </Card>

        {/* Member Permissions */}
        <Card>
          <CardHeader>
            <h3 className="text-base font-semibold text-gray-900">Member Permissions</h3>
          </CardHeader>
          <CardBody>
            {MEMBER_PERMISSIONS.map((key) => (
              <PermissionRow
                key={key}
                permissionKey={key}
                role="member"
                enabled={map.get(`member:${key}`) ?? true}
                disabled={isPending}
                onToggle={handleToggle}
              />
            ))}
          </CardBody>
        </Card>
      </div>
    </div>
  )
}
