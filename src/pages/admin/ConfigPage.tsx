import { useState } from 'react'
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

function useSystemConfig() {
  return useQuery({
    queryKey: ['system_config'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('system_config')
        .select('*')
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

export function ConfigPage() {
  const { data: configs, isLoading: configsLoading } = useSystemConfig()
  const { data: history, isLoading: historyLoading } = useConfigHistory()
  const updateConfig = useUpdateConfig()
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [saveError, setSaveError] = useState<string | null>(null)

  if (configsLoading || historyLoading) return <PageLoader />

  const handleEdit = (config: SystemConfig) => {
    setEditingKey(config.config_key)
    setEditValue(config.config_value)
    setSaveError(null)
  }

  const handleCancel = () => {
    setEditingKey(null)
    setEditValue('')
    setSaveError(null)
  }

  const handleSave = async (config: SystemConfig) => {
    if (editValue === config.config_value) {
      handleCancel()
      return
    }

    setSaveError(null)
    try {
      await updateConfig.mutateAsync({
        config_key: config.config_key,
        old_value: config.config_value,
        new_value: editValue,
      })
      setEditingKey(null)
    } catch (err) {
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
                      ) : (
                        <span className="font-medium text-gray-900">{config.config_value}</span>
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
                          <Button
                            size="sm"
                            loading={updateConfig.isPending}
                            onClick={() => handleSave(config)}
                          >
                            Save
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={handleCancel}
                          >
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleEdit(config)}
                        >
                          Edit
                        </Button>
                      )}
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
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
                      <Td>
                        <span className="text-gray-400 line-through">{entry.old_value ?? '—'}</span>
                      </Td>
                      <Td>
                        <span className="font-medium text-gray-900">{entry.new_value}</span>
                      </Td>
                      <Td>
                        <span className="text-xs text-gray-400">{formatDateTime(entry.changed_at)}</span>
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  )
}
