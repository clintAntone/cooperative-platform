import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Header } from '../../components/layout/Header'
import { Card, CardHeader, CardBody } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { PageLoader } from '../../components/shared/LoadingSpinner'
import { Table, Thead, Tbody, Th, Tr, Td } from '../../components/ui/Table'
import { supabase } from '../../lib/supabase'
import { formatDateTime } from '../../lib/utils'
import { useAuth } from '../../context/AuthContext'
import type { SystemConfig, SystemConfigHistory } from '../../types'

// Keys managed in App Settings — exclude from System Config
const APP_SETTINGS_KEYS = ['app_name', 'app_vision', 'app_mission', 'app_logo_url']

function useSystemConfig() {
  return useQuery({
    queryKey: ['system_config'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('system_config')
        .select('*')
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
        .select('*')
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
      // Insert history record
      await supabase.from('system_config_history').insert({
        config_key: input.config_key,
        old_value: input.old_value,
        new_value: input.new_value,
        changed_by: user!.id,
      })

      // Update config
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

const CONFIG_LABELS: Record<string, string> = {
  share_price:            'Share Price',
  max_shares_per_member:  'Max Shares per Member',
  min_installment_amount: 'Min Installment Amount',
  interest_rate:          'Interest Rate',
  loan_interest_rate:     'Loan Interest Rate',
  max_loan_multiplier:    'Max Loan Multiplier',
  currency_symbol:        'Currency Symbol',
}

function readableKey(key: string): string {
  return CONFIG_LABELS[key] ?? key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

async function uploadLogo(file: File): Promise<string> {
  const ext = file.name.split('.').pop()
  const path = `logo/app-logo.${ext}`
  const { error } = await supabase.storage
    .from('deposit-receipts')
    .upload(path, file, { upsert: true })
  if (error) throw error
  const { data } = supabase.storage.from('deposit-receipts').getPublicUrl(path)
  return data.publicUrl
}

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

  if (configsLoading || historyLoading) return <PageLoader />

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
        newValue = await uploadLogo(logoFile)
        setLogoUploading(false)
      }

      if (newValue === config.config_value) {
        handleCancel()
        return
      }

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

  return (
    <div>
      <Header
        title="Admin Configuration"
        subtitle="Manage platform-wide system settings"
      />

      <div className="p-4 sm:p-6 space-y-6">
        {/* Config Table */}
        <Card>
          <CardHeader>
            <h3 className="text-base font-semibold text-gray-900">System Configuration</h3>
          </CardHeader>
          <CardBody className="p-0">
            {/* Mobile cards */}
            <div className="sm:hidden divide-y divide-gray-100">
              {configs?.map(config => (
                <div key={config.id} className="p-4 space-y-1.5">
                  {/* Label + description */}
                  <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">
                    {readableKey(config.config_key)}
                  </p>
                  {config.description && (
                    <p className="text-xs text-gray-400">{config.description}</p>
                  )}

                  {editingKey === config.config_key ? (
                    <div className="space-y-2 pt-1">
                      {config.config_key === 'app_logo_url' ? (
                        <>
                          {logoPreview && (
                            <img src={logoPreview} alt="Logo preview" className="h-16 w-16 object-contain rounded-lg border border-gray-200 bg-gray-50" />
                          )}
                          <input
                            ref={logoInputRef}
                            type="file"
                            accept="image/png,image/jpeg,image/svg+xml,image/webp"
                            className="hidden"
                            onChange={e => {
                              const file = e.target.files?.[0]
                              if (!file) return
                              setLogoFile(file)
                              setLogoPreview(URL.createObjectURL(file))
                            }}
                          />
                          <button
                            type="button"
                            onClick={() => logoInputRef.current?.click()}
                            className="w-full border-2 border-dashed border-gray-300 rounded-lg px-4 py-3 text-sm text-gray-500 hover:border-blue-400 hover:text-blue-600 transition-colors text-center"
                          >
                            {logoFile ? logoFile.name : 'Tap to choose an image'}
                          </button>
                        </>
                      ) : (
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
                      )}
                      <div className="flex gap-2">
                        <Button size="sm" loading={updateConfig.isPending || logoUploading} onClick={() => handleSave(config)}>Save</Button>
                        <Button size="sm" variant="ghost" onClick={handleCancel}>Cancel</Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-semibold text-gray-900 break-all">
                        {config.config_value || <span className="text-gray-400 font-normal italic">Not set</span>}
                      </span>
                      <Button size="sm" variant="outline" onClick={() => handleEdit(config)}>Edit</Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
            {/* Desktop table */}
            <div className="hidden sm:block">
              <Table>
                <Thead>
                  <Tr>
                    <Th>Key</Th>
                    <Th>Value</Th>
                    <Th>Type</Th>
                    <Th>Description</Th>
                    <Th>Last Updated</Th>
                    <Th>Actions</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {configs?.map(config => (
                    <Tr key={config.id}>
                      <Td>
                        <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded font-mono text-gray-700">
                          {config.config_key}
                        </code>
                      </Td>
                      <Td>
                        {editingKey === config.config_key ? (
                          config.config_key === 'app_logo_url' ? (
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
                              className="border border-blue-400 rounded px-2 py-1 text-sm w-32 focus:outline-none focus:ring-1 focus:ring-blue-500"
                              autoFocus
                              onKeyDown={e => {
                                if (e.key === 'Enter') handleSave(config)
                                if (e.key === 'Escape') handleCancel()
                              }}
                            />
                          )
                        ) : (
                          config.config_key === 'app_logo_url' && config.config_value
                            ? <img src={config.config_value} alt="logo" className="h-8 w-8 object-contain rounded border border-gray-200" />
                            : <span className="font-medium text-gray-900">{config.config_value}</span>
                        )}
                      </Td>
                      <Td>
                        <span className="text-xs text-gray-500 capitalize">{config.value_type}</span>
                      </Td>
                      <Td className="max-w-xs">
                        <span className="text-xs text-gray-500 whitespace-normal">{config.description ?? '—'}</span>
                      </Td>
                      <Td>
                        <span className="text-xs text-gray-400">
                          {config.updated_at ? formatDateTime(config.updated_at) : '—'}
                        </span>
                      </Td>
                      <Td>
                        {editingKey === config.config_key ? (
                          <div className="flex items-center gap-2">
                            <Button size="sm" loading={updateConfig.isPending} onClick={() => handleSave(config)}>Save</Button>
                            <Button size="sm" variant="ghost" onClick={handleCancel}>Cancel</Button>
                          </div>
                        ) : (
                          <Button size="sm" variant="outline" onClick={() => handleEdit(config)}>Edit</Button>
                        )}
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            </div>
            {saveError && (
              <div className="px-4 py-2 bg-red-50 text-sm text-red-600">{saveError}</div>
            )}
          </CardBody>
        </Card>

        {/* Config History */}
        <Card>
          <CardHeader>
            <h3 className="text-base font-semibold text-gray-900">Change History</h3>
          </CardHeader>
          <CardBody className="p-0">
            {!history || history.length === 0 ? (
              <p className="text-sm text-gray-500 p-6 text-center">No changes recorded yet</p>
            ) : (
              <>
                {/* Mobile cards */}
                <div className="sm:hidden divide-y divide-gray-100">
                  {history.map(entry => (
                    <div key={entry.id} className="p-4 space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded font-mono text-gray-700 break-all">
                          {entry.config_key}
                        </code>
                        <span className="text-xs text-gray-400 flex-shrink-0">{formatDateTime(entry.changed_at)}</span>
                      </div>
                      <div className="flex items-center gap-2 text-sm">
                        <span className="text-gray-400 line-through">{entry.old_value ?? '—'}</span>
                        <span className="text-gray-400">→</span>
                        <span className="font-medium text-gray-900">{entry.new_value}</span>
                      </div>
                    </div>
                  ))}
                </div>
                {/* Desktop table */}
                <div className="hidden sm:block">
                  <Table>
                    <Thead>
                      <Tr>
                        <Th>Key</Th>
                        <Th>Old Value</Th>
                        <Th>New Value</Th>
                        <Th>Changed At</Th>
                      </Tr>
                    </Thead>
                    <Tbody>
                      {history.map(entry => (
                        <Tr key={entry.id}>
                          <Td>
                            <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded font-mono text-gray-700">
                              {entry.config_key}
                            </code>
                          </Td>
                          <Td><span className="text-gray-400 line-through">{entry.old_value ?? '—'}</span></Td>
                          <Td><span className="font-medium text-gray-900">{entry.new_value}</span></Td>
                          <Td><span className="text-xs text-gray-400">{formatDateTime(entry.changed_at)}</span></Td>
                        </Tr>
                      ))}
                    </Tbody>
                  </Table>
                </div>
              </>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  )
}
