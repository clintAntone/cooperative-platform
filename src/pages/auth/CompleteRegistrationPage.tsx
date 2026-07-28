import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useAuth } from '../../context/AuthContext'
import { Button } from '../../components/ui/Button'
import { supabase } from '../../lib/supabase'
import { useAppBranding } from '../../hooks/useAppBranding'

const schema = z.object({
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  confirmPassword: z.string(),
}).refine(d => d.password === d.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
})

type FormValues = z.infer<typeof schema>

export function CompleteRegistrationPage() {
  const { user, profile, loading, refreshProfile } = useAuth()
  const navigate = useNavigate()
  const { data: branding } = useAppBranding()
  const [serverError, setServerError] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
  })

  if (loading) return null
  if (!user) return <Navigate to="/login" replace />
  if (profile && !profile.requires_onboarding) return <Navigate to="/" replace />

  const onSubmit = async (values: FormValues) => {
    setServerError(null)
    const { data, error } = await supabase.functions.invoke('complete-onboarding', {
      body: { new_email: values.email, new_password: values.password },
    })
    if (error || data?.error) {
      setServerError(data?.error ?? error?.message ?? 'Something went wrong. Please try again.')
      return
    }
    await refreshProfile()
    navigate('/', { replace: true })
  }

  const appName = branding?.name || 'CoopFinance'

  const eyeOpen = (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
    </svg>
  )
  const eyeOff = (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
    </svg>
  )

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
          <h2 className="text-2xl font-bold text-white">Complete your registration</h2>
          <p className="text-blue-100 text-sm mt-1">Set your email and password to finish setting up your account.</p>
        </div>
      </div>

      {/* Desktop branding panel */}
      <div className="hidden lg:flex lg:w-[45%] xl:w-1/2 flex-col justify-between bg-gradient-to-br from-slate-700 via-slate-800 to-slate-900 p-12 relative overflow-hidden">
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
        <div className="relative z-10 space-y-6">
          <div>
            <h2 className="text-2xl sm:text-3xl xl:text-4xl font-bold text-white leading-tight">
              Welcome to the<br />cooperative.
            </h2>
            <p className="mt-3 text-blue-100 text-base leading-relaxed">
              Your account was created by an administrator. Set your email and password to get started.
            </p>
          </div>
          <div className="bg-white/10 rounded-xl p-4 space-y-2">
            <p className="text-white text-sm font-medium">What happens next?</p>
            <ul className="space-y-1.5">
              {['Set your personal email address', 'Choose a secure password', 'Access your cooperative account'].map(item => (
                <li key={item} className="flex items-center gap-2 text-blue-100 text-sm">
                  <svg className="w-4 h-4 text-green-300 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
        <p className="relative z-10 text-blue-200 text-xs">Employees only · Secure cooperative platform</p>
      </div>

      {/* Form panel */}
      <div className="flex-1 flex flex-col justify-start lg:justify-center px-6 pt-6 pb-4 lg:py-10 sm:px-12 lg:px-16 xl:px-24 bg-white">
        <div className="w-full max-w-sm mx-auto lg:border lg:border-gray-200 lg:rounded-2xl lg:p-8 lg:shadow-sm">
          <div className="hidden lg:block mb-8">
            <h1 className="text-2xl font-bold text-gray-900">Complete your registration</h1>
            <p className="mt-1 text-sm text-gray-500">Set your email and a secure password to finish setting up your account.</p>
          </div>

          {profile?.full_name && (
            <div className="mb-5 p-3.5 bg-blue-50 border border-blue-100 rounded-xl">
              <p className="text-sm text-blue-700">
                Welcome, <strong>{profile.full_name}</strong>. Your account was created by an administrator.
              </p>
            </div>
          )}

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            {serverError && (
              <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 rounded-xl p-3.5 text-sm text-red-700">
                <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                </svg>
                {serverError}
              </div>
            )}

            {/* Email */}
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-gray-700">Your email address</label>
              <div className="relative">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5">
                  <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16 12a4 4 0 10-8 0 4 4 0 008 0zm0 0v1.5a2.5 2.5 0 005 0V12a9 9 0 10-9 9m4.5-1.206a8.959 8.959 0 01-4.5 1.207" />
                  </svg>
                </div>
                <input
                  type="email"
                  placeholder="you@gmail.com"
                  autoComplete="email"
                  {...register('email')}
                  className={`block w-full pl-10 pr-3.5 py-2.5 text-sm rounded-xl border transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${errors.email ? 'border-red-300 bg-red-50' : 'border-gray-200 bg-gray-50 hover:border-gray-300'}`}
                />
              </div>
              {errors.email && <p className="text-xs text-red-600">{errors.email.message}</p>}
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-gray-700">New password</label>
              <div className="relative">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5">
                  <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                </div>
                <input
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Min. 8 characters"
                  autoComplete="new-password"
                  {...register('password')}
                  className={`block w-full pl-10 pr-10 py-2.5 text-sm rounded-xl border transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${errors.password ? 'border-red-300 bg-red-50' : 'border-gray-200 bg-gray-50 hover:border-gray-300'}`}
                />
                <button type="button" onClick={() => setShowPassword(v => !v)} className="absolute inset-y-0 right-0 flex items-center pr-3.5 text-gray-400 hover:text-gray-600" tabIndex={-1}>
                  {showPassword ? eyeOff : eyeOpen}
                </button>
              </div>
              {errors.password && <p className="text-xs text-red-600">{errors.password.message}</p>}
            </div>

            {/* Confirm Password */}
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-gray-700">Confirm password</label>
              <div className="relative">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5">
                  <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                </div>
                <input
                  type={showConfirm ? 'text' : 'password'}
                  placeholder="Repeat your password"
                  autoComplete="new-password"
                  {...register('confirmPassword')}
                  className={`block w-full pl-10 pr-10 py-2.5 text-sm rounded-xl border transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${errors.confirmPassword ? 'border-red-300 bg-red-50' : 'border-gray-200 bg-gray-50 hover:border-gray-300'}`}
                />
                <button type="button" onClick={() => setShowConfirm(v => !v)} className="absolute inset-y-0 right-0 flex items-center pr-3.5 text-gray-400 hover:text-gray-600" tabIndex={-1}>
                  {showConfirm ? eyeOff : eyeOpen}
                </button>
              </div>
              {errors.confirmPassword && <p className="text-xs text-red-600">{errors.confirmPassword.message}</p>}
            </div>

            <Button type="submit" loading={isSubmitting} disabled={isSubmitting} className="w-full" size="lg">
              Complete Registration
            </Button>
          </form>
        </div>
      </div>
    </div>
  )
}
