import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Header } from '../../components/layout/Header'
import { Card, CardHeader, CardBody } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { PageLoader } from '../../components/shared/LoadingSpinner'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

const BRANDING_KEYS = ['app_name', 'app_vision', 'app_mission', 'app_logo_url'] as const

function useBrandingConfig() {
  return useQuery({
    queryKey: ['branding_config'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('system_config')
        .select('config_key, config_value')
        .in('config_key', [...BRANDING_KEYS])
      if (error) throw error
      return Object.fromEntries((data ?? []).map(r => [r.config_key, r.config_value])) as Record<string, string>
    },
  })
}

function useUpsertConfig() {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  return useMutation({
    mutationFn: async (updates: Record<string, string>) => {
      for (const [key, value] of Object.entries(updates)) {
        await supabase.from('system_config_history').insert({
          config_key: key,
          new_value: value,
          changed_by: user!.id,
        })
        const { error } = await supabase
          .from('system_config')
          .update({ config_value: value, updated_by: user!.id, updated_at: new Date().toISOString() })
          .eq('config_key', key)
        if (error) throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['branding_config'] })
      queryClient.invalidateQueries({ queryKey: ['system_config'] })
    },
  })
}

export function AppSettingsPage() {
  const { data: config, isLoading } = useBrandingConfig()
  const upsertConfig = useUpsertConfig()
  const [form, setForm] = useState<Record<string, string>>({})
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [logoPreview, setLogoPreview] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Populate form once config loads
  const values = config ?? {}
  const get = (key: string) => (key in form ? form[key] : (values[key] ?? ''))

  const set = (key: string, value: string) => {
    setForm(f => ({ ...f, [key]: value }))
    setSaveSuccess(false)
  }

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setLogoFile(file)
    setLogoPreview(URL.createObjectURL(file))
    setUploadError(null)
    setSaveSuccess(false)
  }

  const handleSave = async () => {
    setUploadError(null)
    setSaveSuccess(false)

    const updates: Record<string, string> = {}

    // Collect text field changes
    for (const key of ['app_name', 'app_vision', 'app_mission']) {
      const current = get(key)
      if (current !== (values[key] ?? '')) {
        updates[key] = current
      }
    }

    // Upload logo if changed
    if (logoFile) {
      const ext = logoFile.name.split('.').pop()
      const path = `logo.${ext}`
      const { error: uploadErr } = await supabase.storage
        .from('branding')
        .upload(path, logoFile, { upsert: true, contentType: logoFile.type })
      if (uploadErr) {
        setUploadError(uploadErr.message)
        return
      }
      const { data: urlData } = supabase.storage.from('branding').getPublicUrl(path)
      updates['app_logo_url'] = urlData.publicUrl
      setLogoFile(null)
    }

    if (Object.keys(updates).length === 0) {
      setSaveSuccess(true)
      return
    }

    try {
      await upsertConfig.mutateAsync(updates)
      setSaveSuccess(true)
      setForm({})
    } catch (err) {
      setUploadError((err as Error).message ?? 'Failed to save settings')
    }
  }

  if (isLoading) return <PageLoader />

  const logoUrl = logoPreview ?? get('app_logo_url') ?? null

  return (
    <div>
      <Header
        title="App Settings"
        subtitle="Customize your cooperative's branding and identity"
      />

      <div className="p-6 space-y-6 max-w-2xl">
        {/* Branding */}
        <Card>
          <CardHeader>
            <h3 className="text-base font-semibold text-gray-900">Branding</h3>
          </CardHeader>
          <CardBody className="space-y-5">
            {/* Logo */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Logo</label>
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-xl border border-gray-200 bg-gray-50 flex items-center justify-center overflow-hidden flex-shrink-0">
                  {logoUrl ? (
                    <img src={logoUrl} alt="Logo" className="w-full h-full object-contain" />
                  ) : (
                    <svg className="w-8 h-8 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                        d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  )}
                </div>
                <div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleLogoChange}
                  />
                  <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()}>
                    {logoUrl ? 'Change Logo' : 'Upload Logo'}
                  </Button>
                  <p className="text-xs text-gray-400 mt-1">PNG, JPG, SVG up to 2MB</p>
                </div>
              </div>
            </div>

            {/* App Name */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">App Name</label>
              <input
                type="text"
                value={get('app_name')}
                onChange={e => set('app_name', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g. CoopFinance"
              />
              <p className="text-xs text-gray-400 mt-1">Shown in the sidebar and browser tab</p>
            </div>
          </CardBody>
        </Card>

        {/* Identity */}
        <Card>
          <CardHeader>
            <h3 className="text-base font-semibold text-gray-900">Identity</h3>
          </CardHeader>
          <CardBody className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Vision</label>
              <textarea
                rows={3}
                value={get('app_vision')}
                onChange={e => set('app_vision', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                placeholder="Our vision is..."
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Mission</label>
              <textarea
                rows={3}
                value={get('app_mission')}
                onChange={e => set('app_mission', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                placeholder="Our mission is..."
              />
            </div>
          </CardBody>
        </Card>

        {/* Save */}
        <div className="flex items-center gap-3">
          <Button
            onClick={handleSave}
            loading={upsertConfig.isPending}
            disabled={upsertConfig.isPending}
          >
            Save Settings
          </Button>
          {saveSuccess && (
            <span className="text-sm text-green-600 font-medium">Settings saved</span>
          )}
          {uploadError && (
            <span className="text-sm text-red-600">{uploadError}</span>
          )}
        </div>
      </div>
    </div>
  )
}
