import { Header } from '../../components/layout/Header'
import { Card, CardHeader, CardBody } from '../../components/ui/Card'
import { useRolePermissions, useUpdateRolePermission, useAllCustomRolePermissions, useUpdateCustomRolePermission } from '../../hooks/useRolePermissions'
import { useCustomRoles } from '../../hooks/useCustomRoles'
import { MEMBER_PERMISSIONS, PERMISSION_LABELS, CUSTOM_ROLE_PERMISSION_GROUPS } from '../../lib/permissions'
import { SkeletonPage } from '../../components/shared/Skeleton'
import type { PermissionKey } from '../../lib/permissions'
import type { CustomRole } from '../../hooks/useCustomRoles'
import { useNavigate } from 'react-router-dom'

// ─── Shared primitives ────────────────────────────────────────────────────────

function Toggle({ enabled, onChange, disabled }: {
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
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-6' : 'translate-x-1'}`} />
    </button>
  )
}

function PermRow({
  label, enabled, disabled, onChange,
}: {
  label: string
  enabled: boolean
  disabled: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-gray-100 last:border-0">
      <span className="text-sm text-gray-800">{label}</span>
      <Toggle enabled={enabled} onChange={onChange} disabled={disabled} />
    </div>
  )
}

function ColorDot({ color }: { color: string }) {
  const dotColors: Record<string, string> = {
    gray: 'bg-gray-400',
    blue: 'bg-blue-500',
    green: 'bg-green-500',
    purple: 'bg-purple-500',
    red: 'bg-red-500',
    yellow: 'bg-yellow-400',
    orange: 'bg-orange-500',
    pink: 'bg-pink-500',
  }
  return (
    <span className={`inline-block w-2.5 h-2.5 rounded-full flex-shrink-0 ${dotColors[color] ?? 'bg-gray-400'}`} />
  )
}

// ─── Admin card (fixed) ───────────────────────────────────────────────────────

function AdminCard() {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2.5">
          <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-purple-100 text-purple-800">Admin</span>
          <span className="text-xs text-gray-400 font-normal">Built-in · Cannot be restricted</span>
        </div>
        <p className="mt-1 text-xs text-gray-500">Admins have full access to every feature including config, user management, dividends, and rebates.</p>
      </CardHeader>
      <CardBody>
        <div className="flex items-center gap-2 py-3 text-sm text-gray-500">
          <svg className="w-4 h-4 text-green-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
          </svg>
          All permissions enabled — no toggles available for this role.
        </div>
      </CardBody>
    </Card>
  )
}

// ─── Member card ──────────────────────────────────────────────────────────────

function MemberCard({ permMap, isPending, onToggle }: {
  permMap: Map<string, boolean>
  isPending: boolean
  onToggle: (key: PermissionKey, value: boolean) => void
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2.5">
          <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-gray-100 text-gray-800">Member</span>
          <span className="text-xs text-gray-400 font-normal">Built-in · Standard cooperative member</span>
        </div>
        <p className="mt-1 text-xs text-gray-500">Self-service actions that members can perform from their own account.</p>
      </CardHeader>
      <CardBody>
        {MEMBER_PERMISSIONS.map(key => (
          <PermRow
            key={key}
            label={PERMISSION_LABELS[key]}
            enabled={permMap.get(`member:${key}`) ?? true}
            disabled={isPending}
            onChange={v => onToggle(key, v)}
          />
        ))}
      </CardBody>
    </Card>
  )
}

// ─── Custom role card ─────────────────────────────────────────────────────────

function CustomRoleCard({ role, permMap, isPending, onToggle }: {
  role: CustomRole
  permMap: Map<string, boolean>
  isPending: boolean
  onToggle: (roleId: string, key: PermissionKey, value: boolean) => void
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2.5">
          <ColorDot color={role.color} />
          <span className="text-sm font-semibold text-gray-900">{role.name}</span>
          {role.description && (
            <span className="text-xs text-gray-400 font-normal truncate">{role.description}</span>
          )}
        </div>
      </CardHeader>
      <CardBody>
        {CUSTOM_ROLE_PERMISSION_GROUPS.map(group => (
          <div key={group.label} className="mb-4 last:mb-0">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">{group.label}</p>
            {group.keys.map(key => (
              <PermRow
                key={key}
                label={PERMISSION_LABELS[key]}
                enabled={permMap.get(`${role.id}:${key}`) ?? false}
                disabled={isPending}
                onChange={v => onToggle(role.id, key, v)}
              />
            ))}
          </div>
        ))}
      </CardBody>
    </Card>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function PermissionsPage() {
  const navigate = useNavigate()
  const { data: permissions = [], isLoading: permLoading } = useRolePermissions()
  const { data: customRolePerms = [], isLoading: crpLoading } = useAllCustomRolePermissions()
  const { data: customRoles = [], isLoading: rolesLoading } = useCustomRoles()
  const updatePermission = useUpdateRolePermission()
  const updateCustomPerm = useUpdateCustomRolePermission()

  const isLoading = permLoading || crpLoading || rolesLoading

  if (isLoading) return <SkeletonPage />

  // Map for system role permissions: "member:permission_key" → enabled
  const memberMap = new Map(
    permissions.map(p => [`${p.role}:${p.permission_key}`, p.enabled])
  )

  // Map for custom role permissions: "role_id:permission_key" → enabled
  const customMap = new Map(
    customRolePerms.map(p => [`${p.custom_role_id}:${p.permission_key}`, p.enabled])
  )

  const isPending = updatePermission.isPending || updateCustomPerm.isPending

  return (
    <div>
      <Header title="Permissions" subtitle="Configure what each role can access" />

      <div className="p-4 sm:p-6 space-y-6">

        {/* Info banner */}
        <div className="flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
          <svg className="mt-0.5 h-5 w-5 flex-shrink-0 text-blue-500" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z" clipRule="evenodd" />
          </svg>
          <p className="text-sm text-blue-800">
            Changes take effect immediately. Admin always has full access regardless of these settings.
            Permissions here are UI-level — database Row Level Security policies are the final authority.
          </p>
        </div>

        {/* Admin card — always first, fixed */}
        <AdminCard />

        {/* Member card — always second */}
        <MemberCard
          permMap={memberMap}
          isPending={isPending}
          onToggle={(key, value) => updatePermission.mutate({ role: 'member', permission_key: key, enabled: value })}
        />

        {/* Custom role cards */}
        {customRoles.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-6 py-10 text-center">
            <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3">
              <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <p className="text-sm font-medium text-gray-700 mb-1">No custom roles yet</p>
            <p className="text-xs text-gray-500 mb-4">
              Create roles like "Loan Officer", "Treasurer", or "Board Member" to configure their permissions here.
            </p>
            <button
              onClick={() => navigate('/admin/roles')}
              className="inline-flex items-center gap-2 text-sm font-medium text-blue-600 hover:text-blue-700"
            >
              Go to Custom Roles
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-gray-700">Custom Roles ({customRoles.length})</p>
              <button
                onClick={() => navigate('/admin/roles')}
                className="text-xs text-blue-600 hover:text-blue-700 font-medium"
              >
                Manage Roles →
              </button>
            </div>
            {customRoles.map(role => (
              <CustomRoleCard
                key={role.id}
                role={role}
                permMap={customMap}
                isPending={isPending}
                onToggle={(roleId, key, value) =>
                  updateCustomPerm.mutate({ custom_role_id: roleId, permission_key: key, enabled: value })
                }
              />
            ))}
          </>
        )}
      </div>
    </div>
  )
}
