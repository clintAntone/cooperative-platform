import { useState, useRef } from 'react'
import { useNavigate, Navigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'
import { Button } from '../../components/ui/Button'
import { useAppBranding } from '../../hooks/useAppBranding'
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

export function ProfileCompletionPage() {
  const { user, profile, refreshProfile } = useAuth()
  const navigate = useNavigate()
  const { data: branding } = useAppBranding()

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

      // Upload avatar if selected
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
      navigate('/dashboard', { replace: true })
    } catch (err: any) {
      setServerError(err.message ?? 'Something went wrong. Please try again.')
    }
  }

  // Not logged in → login page
  if (!user) return <Navigate to="/login" replace />
  // Already completed or not a member → dashboard
  if (profile && (profile.profile_completed_at || profile.role !== 'member')) {
    return <Navigate to="/dashboard" replace />
  }

  const appName = branding?.name || 'CoopFinance'

  return (
    <div className="min-h-screen flex flex-col lg:flex-row">
      {/* Mobile header */}
      <div className="lg:hidden bg-gradient-to-br from-slate-700 via-slate-800 to-slate-900 px-6 pt-10 pb-8 relative overflow-hidden">
        <div className="absolute -top-10 -right-10 w-40 h-40 bg-white/10 rounded-full" />
        <div className="absolute bottom-0 left-1/2 w-56 h-56 bg-white/5 rounded-full -translate-x-1/2 translate-y-1/2" />
        <div className="relative z-10 flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center overflow-hidden backdrop-blur-sm flex-shrink-0">
            {branding?.logoUrl
              ? <img src={branding.logoUrl} alt="Logo" className="w-full h-full object-contain" />
              : <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
            }
          </div>
          <span className="text-white font-bold text-base">{appName}</span>
        </div>
        <div className="relative z-10">
          <h2 className="text-2xl font-bold text-white">Complete your profile</h2>
          <p className="text-blue-100 text-sm mt-1">We need a few more details before you can get started</p>
        </div>
      </div>

      {/* Desktop branding panel */}
      <div className="hidden lg:flex lg:w-[40%] xl:w-[38%] flex-col justify-between bg-gradient-to-br from-slate-700 via-slate-800 to-slate-900 p-12 relative overflow-hidden">
        <div className="absolute -top-24 -left-24 w-96 h-96 bg-white/5 rounded-full" />
        <div className="absolute -bottom-32 -right-16 w-[28rem] h-[28rem] bg-white/5 rounded-full" />
        <div className="absolute top-1/2 left-1/3 w-64 h-64 bg-white/5 rounded-full -translate-y-1/2" />
        <div className="relative z-10">
          <div className="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center overflow-hidden backdrop-blur-sm">
            {branding?.logoUrl
              ? <img src={branding.logoUrl} alt="Logo" className="w-full h-full object-contain" />
              : <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
            }
          </div>
          <p className="mt-4 text-white font-bold text-xl tracking-tight">{appName}</p>
        </div>
        <div className="relative z-10 space-y-4">
          <h2 className="text-2xl xl:text-3xl font-bold text-white leading-tight">
            One last step<br />before you begin.
          </h2>
          <p className="text-blue-100 text-sm leading-relaxed">
            To keep your account secure and ensure we can contact you in an emergency, we need a few additional details.
          </p>
          <ul className="space-y-2.5 mt-2">
            {[
              'Identity verification photo',
              'Personal information',
              'Emergency contact',
            ].map(item => (
              <li key={item} className="flex items-center gap-2.5 text-blue-100 text-sm">
                <svg className="w-4 h-4 flex-shrink-0 text-blue-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {item}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative z-10 text-blue-200 text-xs">Employees only · Secure cooperative platform</p>
      </div>

      {/* Right panel: form */}
      <div className="flex-1 flex flex-col justify-start lg:justify-center px-6 pt-6 pb-8 lg:py-10 sm:px-12 lg:px-16 xl:px-24 bg-white overflow-y-auto">
        <div className="w-full max-w-sm mx-auto lg:border lg:border-gray-200 lg:rounded-2xl lg:p-8 lg:shadow-sm">
          <div className="hidden lg:block mb-8">
            <h1 className="text-2xl font-bold text-gray-900">Complete your profile</h1>
            <p className="mt-1 text-sm text-gray-500">We need a few more details before you can get started</p>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            {serverError && (
              <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 rounded-xl p-3.5 text-sm text-red-700">
                <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                </svg>
                {serverError}
              </div>
            )}

            {/* Avatar upload */}
            <div className="flex flex-col items-center gap-3">
              <div
                onClick={() => fileInputRef.current?.click()}
                className="relative w-24 h-24 rounded-full bg-gray-100 border-2 border-dashed border-gray-300 flex items-center justify-center cursor-pointer hover:border-blue-400 transition-colors overflow-hidden group"
              >
                {avatarPreview ? (
                  <>
                    <img src={avatarPreview} alt="Avatar preview" className="w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity rounded-full">
                      <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                    </div>
                  </>
                ) : (
                  <div className="flex flex-col items-center gap-1 text-gray-400">
                    <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                    <span className="text-[10px]">Add photo</span>
                  </div>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileChange}
              />
              <p className="text-xs text-gray-400 text-center">
                Upload a clear photo of yourself for identity verification
              </p>
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

            <Button
              type="submit"
              loading={isSubmitting}
              disabled={isSubmitting}
              className="w-full"
              size="lg"
            >
              Complete Profile
            </Button>
          </form>

          {/* Mobile footer */}
          <div className="lg:hidden mt-6 pt-4 border-t border-gray-100 space-y-1.5">
            <div className="flex items-center justify-center gap-1.5">
              <svg className="w-3.5 h-3.5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
              <span className="text-xs font-medium text-gray-500">Employees only · Secure platform</span>
            </div>
            <p className="text-center text-xs text-gray-300">{appName} © {new Date().getFullYear()}</p>
          </div>
        </div>
      </div>
    </div>
  )
}
