import { useState, useRef, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { createPortal } from 'react-dom'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'
import { Button } from '../ui/Button'
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

export function ProfileCompletionModal() {
  const { user, profile, refreshProfile } = useAuth()
  const [dismissed, setDismissed] = useState(false)

  // Allow external triggers (e.g. "Complete your profile" links) to re-open the modal
  useEffect(() => {
    const handler = () => setDismissed(false)
    window.addEventListener('open-profile-completion', handler)
    return () => window.removeEventListener('open-profile-completion', handler)
  }, [])

  const [avatarPreview, setAvatarPreview] = useState<string | null>(profile?.avatar_url ?? null)
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormValues>({
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

  const onSubmit = async (values: FormValues) => {
    setServerError(null)
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

      const { error } = await supabase
        .from('profiles')
        .update({
          avatar_url: avatarUrl,
          date_of_birth: values.date_of_birth,
          address: values.address,
          civil_status: values.civil_status,
          emergency_contact_name: values.emergency_contact_name,
          emergency_contact_phone: values.emergency_contact_phone,
          profile_completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', user!.id)

      if (error) throw error
      await refreshProfile()
    } catch (err: any) {
      setServerError(err.message ?? 'Something went wrong. Please try again.')
    }
  }

  if (dismissed) return null

  return createPortal(
    <div className="fixed inset-0 z-[250] flex items-end sm:items-center justify-center">
      {/* Backdrop — not clickable */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Modal card — slides up from bottom on mobile, centered on desktop */}
      <div className="relative w-full sm:max-w-lg mx-4 sm:mx-0 bg-white rounded-2xl shadow-2xl max-h-[92dvh] flex flex-col">
        {/* Header */}
        <div className="flex-shrink-0 px-6 pt-6 pb-4 border-b border-gray-100">
          <div className="flex items-start justify-between">
            <h2 className="text-xl font-bold text-gray-900">Complete your profile</h2>
            <button
              onClick={() => setDismissed(true)}
              className="ml-4 flex-shrink-0 text-gray-400 hover:text-gray-600 transition-colors"
              aria-label="Close"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <p className="mt-1 text-sm text-gray-500">
            Fill in your details before you can use the platform.
          </p>
        </div>

        {/* Scrollable form body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          <form id="profile-completion-form" onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            {serverError && (
              <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 rounded-xl p-3.5 text-sm text-red-700">
                <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                </svg>
                {serverError}
              </div>
            )}

            {/* Avatar */}
            <div className="flex flex-col items-center gap-3">
              <div
                onClick={() => fileInputRef.current?.click()}
                className="relative w-20 h-20 rounded-full bg-gray-100 border-2 border-dashed border-gray-300 flex items-center justify-center cursor-pointer hover:border-blue-400 transition-colors overflow-hidden group"
              >
                {avatarPreview ? (
                  <>
                    <img src={avatarPreview} alt="Avatar preview" className="w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity rounded-full">
                      <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                    </div>
                  </>
                ) : (
                  <div className="flex flex-col items-center gap-1 text-gray-400">
                    <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                    <span className="text-[10px]">Add photo</span>
                  </div>
                )}
              </div>
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
              <p className="text-xs text-gray-400 text-center">Upload a clear photo for identity verification</p>
            </div>

            {/* Date of birth */}
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-gray-700">Date of Birth <span className="text-red-500">*</span></label>
              <input
                type="date"
                max={new Date(Date.now() - 18 * 365.25 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]}
                {...register('date_of_birth')}
                className={`block w-full px-3.5 py-2.5 text-sm rounded-xl border transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${errors.date_of_birth ? 'border-red-300 bg-red-50' : 'border-gray-200 bg-gray-50 hover:border-gray-300'}`}
              />
              {errors.date_of_birth && <p className="text-xs text-red-600">{errors.date_of_birth.message}</p>}
            </div>

            {/* Civil status */}
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-gray-700">Civil Status <span className="text-red-500">*</span></label>
              <select
                {...register('civil_status')}
                className={`block w-full px-3.5 py-2.5 text-sm rounded-xl border transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-gray-50 ${errors.civil_status ? 'border-red-300 bg-red-50' : 'border-gray-200 hover:border-gray-300'}`}
              >
                <option value="">Select status</option>
                <option value="single">Single</option>
                <option value="married">Married</option>
                <option value="widowed">Widowed</option>
                <option value="separated">Separated</option>
                <option value="divorced">Divorced</option>
              </select>
              {errors.civil_status && <p className="text-xs text-red-600">{errors.civil_status.message}</p>}
            </div>

            {/* Address */}
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-gray-700">Home Address <span className="text-red-500">*</span></label>
              <textarea
                rows={2}
                placeholder="Street, Barangay, City/Municipality, Province"
                {...register('address')}
                className={`block w-full px-3.5 py-2.5 text-sm rounded-xl border transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none ${errors.address ? 'border-red-300 bg-red-50' : 'border-gray-200 bg-gray-50 hover:border-gray-300'}`}
              />
              {errors.address && <p className="text-xs text-red-600">{errors.address.message}</p>}
            </div>

            {/* Emergency contact */}
            <div className="space-y-3">
              <p className="text-sm font-medium text-gray-700">Emergency Contact <span className="text-red-500">*</span></p>
              <div className="space-y-1.5">
                <label className="block text-xs text-gray-500">Full Name</label>
                <input
                  type="text"
                  placeholder="Contact's full name"
                  {...register('emergency_contact_name')}
                  className={`block w-full px-3.5 py-2.5 text-sm rounded-xl border transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${errors.emergency_contact_name ? 'border-red-300 bg-red-50' : 'border-gray-200 bg-gray-50 hover:border-gray-300'}`}
                />
                {errors.emergency_contact_name && <p className="text-xs text-red-600">{errors.emergency_contact_name.message}</p>}
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs text-gray-500">Phone Number</label>
                <input
                  type="tel"
                  placeholder="09XX XXX XXXX"
                  {...register('emergency_contact_phone')}
                  className={`block w-full px-3.5 py-2.5 text-sm rounded-xl border transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${errors.emergency_contact_phone ? 'border-red-300 bg-red-50' : 'border-gray-200 bg-gray-50 hover:border-gray-300'}`}
                />
                {errors.emergency_contact_phone && <p className="text-xs text-red-600">{errors.emergency_contact_phone.message}</p>}
              </div>
            </div>
          </form>
        </div>

        {/* Sticky footer with submit */}
        <div className="flex-shrink-0 px-6 py-4 border-t border-gray-100 bg-white sm:rounded-b-2xl">
          <Button
            type="submit"
            form="profile-completion-form"
            loading={isSubmitting}
            disabled={isSubmitting}
            className="w-full"
            size="lg"
          >
            Complete Profile
          </Button>
        </div>
      </div>
    </div>,
    document.body
  )
}
