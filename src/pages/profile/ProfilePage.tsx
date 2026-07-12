import { useState, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'
import { Header } from '../../components/layout/Header'
import { Card, CardHeader, CardBody } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { toast } from '../../lib/toast'
import { formatDate } from '../../lib/utils'
import { useMyDocuments, useUploadDocument, useDeleteDocument, DOCUMENT_TYPE_LABELS } from '../../hooks/useMemberDocuments'
import type { DocumentType } from '../../hooks/useMemberDocuments'
import type { CivilStatus } from '../../types'

const schema = z.object({
  date_of_birth: z.string().min(1, 'Date of birth is required'),
  address: z.string().min(5, 'Please enter your full address'),
  civil_status: z.enum(['single', 'married', 'widowed', 'separated', 'divorced'], {
    required_error: 'Civil status is required',
  }),
  emergency_contact_name: z.string().min(2, 'Emergency contact name is required'),
  emergency_contact_phone: z.string().min(7, 'Emergency contact phone is required'),
})

type FormValues = z.infer<typeof schema>

const civilStatusLabels: Record<CivilStatus, string> = {
  single: 'Single',
  married: 'Married',
  widowed: 'Widowed',
  separated: 'Separated',
  divorced: 'Divorced',
}

export function ProfilePage() {
  const { user, profile, refreshProfile } = useAuth()
  const [editing, setEditing] = useState(false)
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null)
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      date_of_birth: profile?.date_of_birth ?? '',
      address: profile?.address ?? '',
      civil_status: (profile?.civil_status as CivilStatus) ?? undefined,
      emergency_contact_name: profile?.emergency_contact_name ?? '',
      emergency_contact_phone: profile?.emergency_contact_phone ?? '',
    },
  })

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setAvatarFile(file)
    const reader = new FileReader()
    reader.onload = () => setAvatarPreview(reader.result as string)
    reader.readAsDataURL(file)
  }

  const handleCancel = () => {
    setEditing(false)
    setAvatarFile(null)
    setAvatarPreview(null)
    reset({
      date_of_birth: profile?.date_of_birth ?? '',
      address: profile?.address ?? '',
      civil_status: (profile?.civil_status as CivilStatus) ?? undefined,
      emergency_contact_name: profile?.emergency_contact_name ?? '',
      emergency_contact_phone: profile?.emergency_contact_phone ?? '',
    })
  }

  const onSubmit = async (values: FormValues) => {
    try {
      let avatarUrl = profile?.avatar_url ?? null

      if (avatarFile && user) {
        const ext = avatarFile.name.split('.').pop()
        const path = `${user.id}/avatar.${ext}`
        const { error: uploadError } = await supabase.storage
          .from('avatars')
          .upload(path, avatarFile, { upsert: true })
        if (uploadError) throw uploadError
        const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path)
        avatarUrl = urlData.publicUrl
      }

      const now = new Date().toISOString()
      const { error } = await supabase
        .from('profiles')
        .update({
          avatar_url: avatarUrl,
          date_of_birth: values.date_of_birth,
          address: values.address,
          civil_status: values.civil_status,
          emergency_contact_name: values.emergency_contact_name,
          emergency_contact_phone: values.emergency_contact_phone,
          // Mark complete if not yet done
          profile_completed_at: profile?.profile_completed_at ?? now,
          updated_at: now,
        })
        .eq('id', user!.id)

      if (error) throw error

      await refreshProfile()
      setEditing(false)
      setAvatarFile(null)
      setAvatarPreview(null)
      toast({ title: 'Profile updated successfully', variant: 'success' })
    } catch (err: any) {
      toast({ title: err.message ?? 'Failed to update profile', variant: 'error' })
    }
  }

  const { data: myDocuments = [] } = useMyDocuments()
  const uploadDocument = useUploadDocument()
  const deleteDocument = useDeleteDocument()
  const docInputRef = useRef<HTMLInputElement>(null)
  const [pendingDocType, setPendingDocType] = useState<DocumentType | null>(null)

  const handleDocFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !pendingDocType) return
    uploadDocument.mutate({ file, documentType: pendingDocType })
    e.target.value = ''
    setPendingDocType(null)
  }

  const currentAvatar = avatarPreview ?? profile?.avatar_url ?? null
  const isComplete = !!profile?.profile_completed_at
  const isMemberRole = profile?.role === 'member' || profile?.role === 'collector'

  return (
    <div>
      <Header
        title="My Profile"
        subtitle="Your personal information and contact details"
        actions={
          !editing ? (
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              Edit Profile
            </Button>
          ) : null
        }
      />

      <div className="p-4 sm:p-6 space-y-6">
        {/* Incomplete banner — members/collectors only */}
        {isMemberRole && !isComplete && (
          <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4">
            <svg className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
            <div>
              <p className="text-sm font-semibold text-amber-800">Profile incomplete</p>
              <p className="text-xs text-amber-700 mt-0.5">Fill in your details below to enable deposit requests and loan applications.</p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
          {/* Avatar + basic info */}
          <Card>
            <CardBody>
              <div className="flex items-start gap-5">
                {/* Avatar */}
                <div className="flex-shrink-0">
                  <div
                    className={`relative w-20 h-20 rounded-full overflow-hidden border-2 ${editing ? 'border-blue-300 cursor-pointer group' : 'border-gray-200'}`}
                    onClick={() => editing && fileInputRef.current?.click()}
                  >
                    {currentAvatar ? (
                      <img src={currentAvatar} alt="Avatar" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full bg-gray-100 flex items-center justify-center">
                        <svg className="w-10 h-10 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                        </svg>
                      </div>
                    )}
                    {editing && (
                      <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                      </div>
                    )}
                  </div>
                  <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
                  {editing && (
                    <p className="text-xs text-gray-400 text-center mt-1.5">Click to change</p>
                  )}
                </div>

                {/* Name + status */}
                <div className="flex-1 min-w-0 pt-1">
                  <p className="font-bold text-lg text-gray-900 leading-tight">{profile?.full_name}</p>
                  <p className="text-sm text-gray-500 mt-0.5 capitalize">{profile?.role}</p>
                  <div className="flex items-center gap-2 mt-2">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${isComplete ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}`}>
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        {isComplete
                          ? <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          : <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01" />
                        }
                      </svg>
                      {isComplete ? 'Profile complete' : 'Incomplete'}
                    </span>
                  </div>
                </div>
              </div>
            </CardBody>
          </Card>

          {/* Personal information */}
          <Card>
            <CardHeader>
              <h3 className="text-sm font-semibold text-gray-900">Personal Information</h3>
            </CardHeader>
            <CardBody>
              {editing ? (
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="block text-sm font-medium text-gray-700">Date of Birth <span className="text-red-500">*</span></label>
                    <input
                      type="date"
                      max={new Date(Date.now() - 18 * 365.25 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]}
                      {...register('date_of_birth')}
                      className={`block w-full px-3.5 py-2.5 text-sm rounded-xl border focus:outline-none focus:ring-2 focus:ring-blue-500 ${errors.date_of_birth ? 'border-red-300 bg-red-50' : 'border-gray-200 bg-gray-50'}`}
                    />
                    {errors.date_of_birth && <p className="text-xs text-red-600">{errors.date_of_birth.message}</p>}
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-sm font-medium text-gray-700">Civil Status <span className="text-red-500">*</span></label>
                    <select
                      {...register('civil_status')}
                      className={`block w-full px-3.5 py-2.5 text-sm rounded-xl border focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50 ${errors.civil_status ? 'border-red-300 bg-red-50' : 'border-gray-200'}`}
                    >
                      <option value="">Select status</option>
                      {(Object.entries(civilStatusLabels) as [CivilStatus, string][]).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                    {errors.civil_status && <p className="text-xs text-red-600">{errors.civil_status.message}</p>}
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-sm font-medium text-gray-700">Home Address <span className="text-red-500">*</span></label>
                    <textarea
                      rows={2}
                      placeholder="Street, Barangay, City/Municipality, Province"
                      {...register('address')}
                      className={`block w-full px-3.5 py-2.5 text-sm rounded-xl border focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none ${errors.address ? 'border-red-300 bg-red-50' : 'border-gray-200 bg-gray-50'}`}
                    />
                    {errors.address && <p className="text-xs text-red-600">{errors.address.message}</p>}
                  </div>
                </div>
              ) : (
                <dl className="space-y-3">
                  {[
                    { label: 'Date of Birth', value: profile?.date_of_birth ? new Date(profile.date_of_birth).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' }) : null },
                    { label: 'Civil Status', value: profile?.civil_status ? civilStatusLabels[profile.civil_status as CivilStatus] : null },
                    { label: 'Home Address', value: profile?.address },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex gap-3 py-2 border-b border-gray-100 last:border-0">
                      <dt className="text-sm text-gray-500 min-w-[140px] flex-shrink-0">{label}</dt>
                      <dd className="text-sm text-gray-900 font-medium">{value ?? <span className="text-gray-400 font-normal">—</span>}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </CardBody>
          </Card>

          {/* Emergency contact */}
          <Card>
            <CardHeader>
              <h3 className="text-sm font-semibold text-gray-900">Emergency Contact</h3>
            </CardHeader>
            <CardBody>
              {editing ? (
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="block text-sm font-medium text-gray-700">Full Name <span className="text-red-500">*</span></label>
                    <input
                      type="text"
                      placeholder="Contact's full name"
                      {...register('emergency_contact_name')}
                      className={`block w-full px-3.5 py-2.5 text-sm rounded-xl border focus:outline-none focus:ring-2 focus:ring-blue-500 ${errors.emergency_contact_name ? 'border-red-300 bg-red-50' : 'border-gray-200 bg-gray-50'}`}
                    />
                    {errors.emergency_contact_name && <p className="text-xs text-red-600">{errors.emergency_contact_name.message}</p>}
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-sm font-medium text-gray-700">Phone Number <span className="text-red-500">*</span></label>
                    <input
                      type="tel"
                      placeholder="09XX XXX XXXX"
                      {...register('emergency_contact_phone')}
                      className={`block w-full px-3.5 py-2.5 text-sm rounded-xl border focus:outline-none focus:ring-2 focus:ring-blue-500 ${errors.emergency_contact_phone ? 'border-red-300 bg-red-50' : 'border-gray-200 bg-gray-50'}`}
                    />
                    {errors.emergency_contact_phone && <p className="text-xs text-red-600">{errors.emergency_contact_phone.message}</p>}
                  </div>
                </div>
              ) : (
                <dl className="space-y-3">
                  {[
                    { label: 'Name', value: profile?.emergency_contact_name },
                    { label: 'Phone', value: profile?.emergency_contact_phone },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex gap-3 py-2 border-b border-gray-100 last:border-0">
                      <dt className="text-sm text-gray-500 min-w-[140px] flex-shrink-0">{label}</dt>
                      <dd className="text-sm text-gray-900 font-medium">{value ?? <span className="text-gray-400 font-normal">—</span>}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </CardBody>
          </Card>

          {/* Account info (read-only) */}
          <Card>
            <CardHeader>
              <h3 className="text-sm font-semibold text-gray-900">Account</h3>
            </CardHeader>
            <CardBody>
              <dl className="space-y-3">
                {[
                  { label: 'Phone', value: profile?.phone },
                  { label: 'Employee ID', value: profile?.employee_id },
                  { label: 'Account Status', value: profile?.account_status ? profile.account_status.charAt(0).toUpperCase() + profile.account_status.slice(1) : null },
                  { label: 'Member Since', value: profile?.created_at ? new Date(profile.created_at).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' }) : null },
                ].filter(r => r.value).map(({ label, value }) => (
                  <div key={label} className="flex gap-3 py-2 border-b border-gray-100 last:border-0">
                    <dt className="text-sm text-gray-500 min-w-[140px] flex-shrink-0">{label}</dt>
                    <dd className="text-sm text-gray-900 font-medium">{value}</dd>
                  </div>
                ))}
              </dl>
            </CardBody>
          </Card>

          {/* Edit actions */}
          {editing && (
            <div className="flex gap-3 pb-4">
              <Button type="button" variant="outline" className="flex-1" onClick={handleCancel}>
                Cancel
              </Button>
              <Button type="submit" className="flex-1" loading={isSubmitting}>
                Save Changes
              </Button>
            </div>
          )}
        </form>

        {/* Documents — members/collectors only */}
        {isMemberRole && <Card>
          <CardHeader>
            <h3 className="text-sm font-semibold text-gray-900">Documents</h3>
            <p className="text-xs text-gray-500 mt-0.5">Upload your government ID and proof of address for verification.</p>
          </CardHeader>
          <CardBody>
            <div className="space-y-3">
              {(['government_id', 'proof_of_address', 'other'] as DocumentType[]).map(docType => {
                const existing = myDocuments.filter(d => d.document_type === docType)
                return (
                  <div key={docType} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-medium text-gray-600">{DOCUMENT_TYPE_LABELS[docType]}</p>
                      <button
                        type="button"
                        onClick={() => { setPendingDocType(docType); docInputRef.current?.click() }}
                        disabled={uploadDocument.isPending}
                        className="text-xs text-blue-600 hover:text-blue-800 font-medium disabled:opacity-50"
                      >
                        + Upload
                      </button>
                    </div>
                    {existing.length === 0 ? (
                      <p className="text-xs text-gray-400 italic">None uploaded</p>
                    ) : (
                      <div className="space-y-1.5">
                        {existing.map(doc => (
                          <div key={doc.id} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2 gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                              </svg>
                              <div className="min-w-0">
                                <a href={doc.file_url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline truncate block">
                                  {doc.file_name}
                                </a>
                                <p className="text-[10px] text-gray-400">{formatDate(doc.uploaded_at)}</p>
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => deleteDocument.mutate(doc.id)}
                              className="text-gray-400 hover:text-red-600 flex-shrink-0 transition-colors"
                              title="Remove"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
            <input
              ref={docInputRef}
              type="file"
              accept="image/jpeg,image/png,application/pdf"
              className="hidden"
              onChange={handleDocFileChange}
            />
          </CardBody>
        </Card>}
        </div>
      </div>
    </div>
  )
}
