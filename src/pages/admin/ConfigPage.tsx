import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Header } from '../../components/layout/Header'

import { Button } from '../../components/ui/Button'
import { SkeletonFormPage } from '../../components/shared/Skeleton'
import { supabase } from '../../lib/supabase'
import { formatDateTime } from '../../lib/utils'
import { useAuth } from '../../context/AuthContext'
import type { SystemConfig, SystemConfigHistory } from '../../types'
import { PageGuide } from '../../components/shared/PageGuide'

// Keys managed in App Settings — exclude from System Config
const APP_SETTINGS_KEYS = ['app_name', 'app_vision', 'app_mission', 'app_logo_url']

// ─── Group definitions ────────────────────────────────────────────────────────

interface ConfigGroup {
  label: string
  description: string
  color: string        // Tailwind border-l color
  prefix: string[]     // key prefix(es) that belong here
}

const CONFIG_GROUPS: ConfigGroup[] = [
  {
    label: 'Currency',
    description: 'Display currency used across the platform',
    color: 'border-blue-400',
    prefix: ['currency_'],
  },
  {
    label: 'Equity & Shares',
    description: 'Share pricing, installments, and dividend settings',
    color: 'border-emerald-400',
    prefix: ['share_', 'equity_', 'min_installment', 'max_shares'],
  },
  {
    label: 'Loans',
    description: 'Interest rates, loan limits, co-maker rules, and default thresholds',
    color: 'border-violet-400',
    prefix: ['loan_', 'grace_', 'installment_', 'interest_calculation', 'max_loan'],
  },
  {
    label: 'Savings',
    description: 'Savings account rules, deposit caps, and interest schedule',
    color: 'border-yellow-400',
    prefix: ['savings_'],
  },
]

function getGroup(key: string): string {
  for (const g of CONFIG_GROUPS) {
    if (g.prefix.some(p => key.startsWith(p))) return g.label
  }
  return 'Other'
}

// ─── Human-readable labels ────────────────────────────────────────────────────

const CONFIG_LABELS: Record<string, string> = {
  currency_code:                    'Currency Code',
  currency_symbol:                  'Currency Symbol',

  share_price:                      'Share Price',
  max_shares_per_member:            'Max Shares per Member',
  min_installment_amount:           'Min Installment Amount',
  equity_dividend_rate:             'Dividend Rate (%)',
  equity_dividend_period_months:    'Dividend Period (months)',

  loan_interest_rate:               'Monthly Interest Rate (%)',
  loan_amount_formula:              'Loan Amount Formula',
  loan_min_co_makers:               'Min Co-Makers Required',
  loan_min_savings_balance:         'Min Savings Balance for Loan',
  loan_default_threshold_days:      'Default Threshold (days)',
  loan_ratio_new_member:            'Loan Ratio — New Member',
  loan_ratio_senior_member:         'Loan Ratio — Senior Member',
  loan_ratio_tenure_months:         'Senior Member Tenure (months)',
  grace_period_days:                'Grace Period (days)',
  installment_frequency:            'Installment Frequency',
  interest_calculation_method:      'Interest Calculation Method',
  max_loan_multiplier:              'Max Loan Multiplier',

  savings_interest_rate:            'Interest Rate (%)',
  savings_interest_period_months:   'Interest Period (months)',
  savings_interest_release_months:  'Release Months',
  savings_min_deposit:              'Minimum Deposit',
  savings_weekly_cap:               'Weekly Deposit Cap',
  savings_required_for_loan:        'Required for Loan',
  savings_min_balance:              'Min Balance After Withdrawal',
}

function readableLabel(key: string): string {
  return CONFIG_LABELS[key] ?? key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

// ─── Data hooks ───────────────────────────────────────────────────────────────

function useSystemConfig() {
  return useQuery({
    queryKey: ['system_config'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('system_config')
        .select('id, config_key, config_value, value_type, description, updated_by, updated_at')
        .not('config_key', 'in', `(${APP_SETTINGS_KEYS.join(',')})`)
        .order('config_key', { ascending: true })
      if (error) throw error
      return data as SystemConfig[]
    },
  })
}

function useConfigHistory() {
  return useQuery({
    queryKey: ['config_history'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('system_config_history')
        .select('id, config_key, old_value, new_value, changed_by, changed_at')
        .order('changed_at', { ascending: false })
        .limit(20)
      if (error) throw error
      return data as SystemConfigHistory[]
    },
  })
}

interface UpdateConfigInput {
  config_key: string
  old_value: string
  new_value: string
}

function useUpdateConfig() {
  const queryClient = useQueryClient()
  const { user } = useAuth()

  return useMutation({
    mutationFn: async (input: UpdateConfigInput) => {
      await supabase.from('system_config_history').insert({
        config_key: input.config_key,
        old_value: input.old_value,
        new_value: input.new_value,
        changed_by: user!.id,
      })
      const { data, error } = await supabase
        .from('system_config')
        .update({
          config_value: input.new_value,
          updated_by: user!.id,
          updated_at: new Date().toISOString(),
        })
        .eq('config_key', input.config_key)
        .select()
        .single()
      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['system_config'] })
      queryClient.invalidateQueries({ queryKey: ['config_history'] })
    },
  })
}

// ─── Row component ────────────────────────────────────────────────────────────

function ConfigRow({
  config,
  editingKey,
  editValue,
  setEditValue,
  onEdit,
  onSave,
  onCancel,
  isSaving,
  logoInputRef,
  logoFile,
  setLogoFile,
  logoPreview,
  setLogoPreview,
}: {
  config: SystemConfig
  editingKey: string | null
  editValue: string
  setEditValue: (v: string) => void
  onEdit: () => void
  onSave: () => void
  onCancel: () => void
  isSaving: boolean
  logoInputRef: React.RefObject<HTMLInputElement>
  logoFile: File | null
  setLogoFile: (f: File | null) => void
  logoPreview: string | null
  setLogoPreview: (u: string | null) => void
}) {
  const isEditing = editingKey === config.config_key
  const label = readableLabel(config.config_key)

  return (
    <div className={`grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 py-4 px-5 border-b border-gray-100 last:border-0 hover:bg-gray-50/50 transition-colors ${isEditing ? 'bg-blue-50/40' : ''}`}>
      {/* Left: label + key + description */}
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 mb-0.5">
          <span className="text-sm font-semibold text-gray-800">{label}</span>
          <code className="text-[10px] text-gray-400 font-mono bg-gray-100 px-1 py-0.5 rounded">
            {config.config_key}
          </code>
        </div>
        {config.description && (
          <p className="text-xs text-gray-400 leading-snug">{config.description}</p>
        )}
        <p className="text-xs text-gray-300 mt-0.5">Updated {config.updated_at ? formatDateTime(config.updated_at) : '—'}</p>
      </div>

      {/* Right: value + edit */}
      <div className="flex items-start gap-3 sm:min-w-[220px] sm:justify-end">
        {isEditing ? (
          <div className="flex items-center gap-2 flex-1 sm:flex-initial">
            {config.config_key === 'app_logo_url' ? (
              <div className="flex items-center gap-2">
                {logoPreview && <img src={logoPreview} alt="preview" className="h-8 w-8 object-contain rounded border border-gray-200" />}
                <input ref={logoInputRef} type="file" accept="image/*" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) { setLogoFile(f); setLogoPreview(URL.createObjectURL(f)) } }} />
                <button type="button" onClick={() => logoInputRef.current?.click()}
                  className="text-xs border border-dashed border-gray-300 rounded px-2 py-1 text-gray-500 hover:border-blue-400 hover:text-blue-600">
                  {logoFile ? logoFile.name : 'Choose file'}
                </button>
              </div>
            ) : (
              <input
                type={config.value_type === 'number' ? 'number' : 'text'}
                value={editValue}
                onChange={e => setEditValue(e.target.value)}
                className="border border-blue-400 rounded-lg px-2.5 py-1.5 text-sm w-36 focus:outline-none focus:ring-2 focus:ring-blue-500"
                autoFocus
                onKeyDown={e => {
                  if (e.key === 'Enter') onSave()
                  if (e.key === 'Escape') onCancel()
                }}
              />
            )}
            <Button size="sm" loading={isSaving} onClick={onSave}>Save</Button>
            <button onClick={onCancel} className="text-xs text-gray-400 hover:text-gray-600">Cancel</button>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <span className="text-sm font-bold text-gray-900 tabular-nums">
              {config.config_key === 'app_logo_url' && config.config_value
                ? <img src={config.config_value} alt="logo" className="h-8 w-8 object-contain rounded border border-gray-200" />
                : config.config_value || <span className="text-gray-300 font-normal italic text-xs">Not set</span>
              }
            </span>
            <button
              onClick={onEdit}
              className="text-xs text-blue-600 hover:text-blue-800 font-medium border border-blue-200 rounded-md px-2.5 py-1 hover:bg-blue-50 transition-colors whitespace-nowrap"
            >
              Edit
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function ConfigPage() {
  const { data: configs, isLoading: configsLoading } = useSystemConfig()
  const { data: history, isLoading: historyLoading } = useConfigHistory()
  const updateConfig = useUpdateConfig()
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [logoPreview, setLogoPreview] = useState<string | null>(null)
  const [logoUploading, setLogoUploading] = useState(false)
  const logoInputRef = useRef<HTMLInputElement>(null)

  if (configsLoading || historyLoading) return <SkeletonFormPage rows={8} />

  const handleEdit = (config: SystemConfig) => {
    setEditingKey(config.config_key)
    setEditValue(config.config_value)
    setLogoFile(null)
    setLogoPreview(config.config_key === 'app_logo_url' ? config.config_value || null : null)
    setSaveError(null)
  }

  const handleCancel = () => {
    setEditingKey(null)
    setEditValue('')
    setLogoFile(null)
    setLogoPreview(null)
    setSaveError(null)
  }

  const handleSave = async (config: SystemConfig) => {
    setSaveError(null)
    try {
      let newValue = editValue
      if (config.config_key === 'app_logo_url' && logoFile) {
        setLogoUploading(true)
        const ext = logoFile.name.split('.').pop()
        const path = `logo/app-logo.${ext}`
        const { error: uploadErr } = await supabase.storage
          .from('deposit-receipts')
          .upload(path, logoFile, { upsert: true })
        if (uploadErr) throw uploadErr
        const { data } = supabase.storage.from('deposit-receipts').getPublicUrl(path)
        newValue = data.publicUrl
        setLogoUploading(false)
      }
      if (newValue === config.config_value) { handleCancel(); return }
      await updateConfig.mutateAsync({
        config_key: config.config_key,
        old_value: config.config_value,
        new_value: newValue,
      })
      setEditingKey(null)
    } catch (err) {
      setLogoUploading(false)
      setSaveError((err as Error).message ?? 'Failed to save')
    }
  }

  // Group configs
  const grouped: Record<string, SystemConfig[]> = {}
  for (const cfg of configs ?? []) {
    const g = getGroup(cfg.config_key)
    if (!grouped[g]) grouped[g] = []
    grouped[g].push(cfg)
  }

  // Ordered group names: defined groups first, then "Other"
  const groupOrder = [...CONFIG_GROUPS.map(g => g.label), 'Other'].filter(g => grouped[g]?.length)

  return (
    <div>
      <Header
        title="System Configuration"
        subtitle="Manage platform-wide settings"
      />

      <div className="p-4 sm:p-6 space-y-6">
        <PageGuide
          storageKey="system-config"
          steps={[
            'System Config stores all cooperative-wide settings: share price, interest rates, minimum balances, etc.',
            'Click Edit next to any value to change it. Changes take effect immediately for all new transactions.',
            "All changes are logged with the editor's name and timestamp — see the History section below.",
          ]}
          note="Key values: share_price (cost per equity share), loan_interest_rate (monthly %), savings_interest_release_months (e.g. 6,12 = June & December)."
        />

        {saveError && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-600">{saveError}</div>
        )}

        {/* Grouped config sections */}
        {groupOrder.map(groupName => {
          const group = CONFIG_GROUPS.find(g => g.label === groupName)
          const rows = grouped[groupName] ?? []
          return (
            <div key={groupName} className={`bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden border-l-4 ${group?.color ?? 'border-gray-300'}`}>
              {/* Group header */}
              <div className="px-5 py-3 border-b border-gray-100 bg-gray-50/60">
                <h3 className="text-sm font-semibold text-gray-800">{groupName}</h3>
                {group?.description && (
                  <p className="text-xs text-gray-400 mt-0.5">{group.description}</p>
                )}
              </div>

              {/* Mobile cards */}
              <div className="sm:hidden divide-y divide-gray-100">
                {rows.map(config => (
                  <div key={config.id} className={`p-4 space-y-2 ${editingKey === config.config_key ? 'bg-blue-50/40' : ''}`}>
                    <div>
                      <p className="text-sm font-semibold text-gray-800">{readableLabel(config.config_key)}</p>
                      <code className="text-[10px] text-gray-400 font-mono">{config.config_key}</code>
                      {config.description && (
                        <p className="text-xs text-gray-400 mt-0.5">{config.description}</p>
                      )}
                    </div>
                    {editingKey === config.config_key ? (
                      <div className="space-y-2">
                        <input
                          type={config.value_type === 'number' ? 'number' : 'text'}
                          value={editValue}
                          onChange={e => setEditValue(e.target.value)}
                          className="w-full border border-blue-400 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          autoFocus
                          onKeyDown={e => {
                            if (e.key === 'Enter') handleSave(config)
                            if (e.key === 'Escape') handleCancel()
                          }}
                        />
                        <div className="flex gap-2">
                          <Button size="sm" loading={updateConfig.isPending || logoUploading} onClick={() => handleSave(config)}>Save</Button>
                          <Button size="sm" variant="ghost" onClick={handleCancel}>Cancel</Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm font-bold text-gray-900 break-all">
                          {config.config_value || <span className="text-gray-300 font-normal italic text-xs">Not set</span>}
                        </span>
                        <button
                          onClick={() => handleEdit(config)}
                          className="text-xs text-blue-600 hover:text-blue-800 font-medium border border-blue-200 rounded-md px-2.5 py-1 hover:bg-blue-50 transition-colors whitespace-nowrap flex-shrink-0"
                        >
                          Edit
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Desktop rows */}
              <div className="hidden sm:block">
                {rows.map(config => (
                  <ConfigRow
                    key={config.id}
                    config={config}
                    editingKey={editingKey}
                    editValue={editValue}
                    setEditValue={setEditValue}
                    onEdit={() => handleEdit(config)}
                    onSave={() => handleSave(config)}
                    onCancel={handleCancel}
                    isSaving={updateConfig.isPending || logoUploading}
                    logoInputRef={logoInputRef}
                    logoFile={logoFile}
                    setLogoFile={setLogoFile}
                    logoPreview={logoPreview}
                    setLogoPreview={setLogoPreview}
                  />
                ))}
              </div>
            </div>
          )
        })}

        {/* Change History */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 bg-gray-50/60">
            <h3 className="text-sm font-semibold text-gray-800">Change History</h3>
            <p className="text-xs text-gray-400 mt-0.5">Last 20 configuration edits</p>
          </div>
          {!history || history.length === 0 ? (
            <p className="text-sm text-gray-400 p-6 text-center">No changes recorded yet</p>
          ) : (
            <>
              {/* Mobile */}
              <div className="sm:hidden divide-y divide-gray-100">
                {history.map(entry => (
                  <div key={entry.id} className="p-4 space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-gray-800">{readableLabel(entry.config_key)}</p>
                        <code className="text-[10px] text-gray-400 font-mono">{entry.config_key}</code>
                      </div>
                      <span className="text-xs text-gray-400 flex-shrink-0">{formatDateTime(entry.changed_at)}</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-gray-400 line-through">{entry.old_value ?? '—'}</span>
                      <span className="text-gray-300">→</span>
                      <span className="font-semibold text-gray-900">{entry.new_value}</span>
                    </div>
                  </div>
                ))}
              </div>
              {/* Desktop */}
              <div className="hidden sm:block">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr>
                      <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Setting</th>
                      <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">From</th>
                      <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">To</th>
                      <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Changed At</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {history.map(entry => (
                      <tr key={entry.id} className="hover:bg-gray-50">
                        <td className="px-5 py-3">
                          <p className="font-medium text-gray-800">{readableLabel(entry.config_key)}</p>
                          <code className="text-[10px] text-gray-400 font-mono">{entry.config_key}</code>
                        </td>
                        <td className="px-5 py-3 text-gray-400 line-through">{entry.old_value ?? '—'}</td>
                        <td className="px-5 py-3 font-semibold text-gray-900">{entry.new_value}</td>
                        <td className="px-5 py-3 text-xs text-gray-400">{formatDateTime(entry.changed_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
