import { useState, useEffect } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useAuth } from '../../context/AuthContext'
import { Button } from '../../components/ui/Button'
import { useAppBranding } from '../../hooks/useAppBranding'
import { supabase } from '../../lib/supabase'

// ── Schemas ────────────────────────────────────────────────
const loginSchema = z.object({
  identifier: z.string().min(1, 'Email or Employee ID is required'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
})
const setupSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  confirmPassword: z.string(),
}).refine(d => d.password === d.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
})

type LoginValues = z.infer<typeof loginSchema>
type SetupValues = z.infer<typeof setupSchema>

// ── Rate limiting ──────────────────────────────────────────
const ATTEMPTS_KEY = 'login_attempts'
const MAX_ATTEMPTS = 5
const WINDOW_MS = 15 * 60 * 1000

function getAttempts(): number[] {
  try { return JSON.parse(sessionStorage.getItem(ATTEMPTS_KEY) ?? '[]') }
  catch { return [] }
}
function recordAttempt() {
  const now = Date.now()
  const attempts = getAttempts().filter(t => now - t < WINDOW_MS)
  attempts.push(now)
  sessionStorage.setItem(ATTEMPTS_KEY, JSON.stringify(attempts))
}
function isLockedOut(): { locked: boolean; remaining: number } {
  const now = Date.now()
  const attempts = getAttempts().filter(t => now - t < WINDOW_MS)
  if (attempts.length >= MAX_ATTEMPTS) {
    const oldest = Math.min(...attempts)
    const remaining = Math.ceil((WINDOW_MS - (now - oldest)) / 60000)
    return { locked: true, remaining }
  }
  return { locked: false, remaining: 0 }
}
function clearAttempts() { sessionStorage.removeItem(ATTEMPTS_KEY) }

// ── Eye icons ──────────────────────────────────────────────
const EyeOpen = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
  </svg>
)
const EyeOff = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
  </svg>
)

// ── Component ──────────────────────────────────────────────
export function LoginPage() {
  const { user, profile, signIn, refreshProfile, loading } = useAuth()
  const navigate = useNavigate()
  const { data: branding, isPending: brandingPending } = useAppBranding()

  const [step, setStep] = useState<'login' | 'setup'>('login')
  const [setupName, setSetupName] = useState('')
  const [serverError, setServerError] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [lockInfo, setLockInfo] = useState<{ locked: boolean; remaining: number }>({ locked: false, remaining: 0 })

  useEffect(() => {
    setLockInfo(isLockedOut())
    const interval = setInterval(() => setLockInfo(isLockedOut()), 30000)
    return () => clearInterval(interval)
  }, [])

  // If already logged in with requires_onboarding, show setup step inline
  useEffect(() => {
    if (!loading && user && profile?.requires_onboarding && step !== 'setup') {
      const raw = profile.first_name || (profile.full_name || '').split(' ')[0]
      const titled = raw.toLowerCase().replace(/\b\w/g, (c: string) => c.toUpperCase())
      setSetupName(titled)
      setStep('setup')
    }
  }, [loading, user, profile, step])

  const loginForm = useForm<LoginValues>({ resolver: zodResolver(loginSchema) })
  const setupForm = useForm<SetupValues>({ resolver: zodResolver(setupSchema) })

  // Already logged in and onboarding not needed — redirect away
  if (!loading && user && profile && !profile.requires_onboarding) {
    return <Navigate to="/" replace />
  }

  const onLoginSubmit = async (values: LoginValues) => {
    const currentLock = isLockedOut()
    if (currentLock.locked) { setLockInfo(currentLock); return }
    setServerError(null)

    const email = values.identifier.includes('@')
      ? values.identifier
      : `${values.identifier.toLowerCase()}@onboarding.temp`

    const { error } = await signIn(email, values.password)
    if (error) {
      recordAttempt()
      setLockInfo(isLockedOut())
      setServerError(error.message ?? 'Invalid email or password')
      return
    }

    clearAttempts()

    // Check if this account needs onboarding
    const { data: { user: authUser } } = await supabase.auth.getUser()
    if (!authUser) { navigate('/'); return }

    const { data: prof } = await supabase
      .from('profiles')
      .select('first_name, full_name, requires_onboarding')
      .eq('id', authUser.id)
      .single()

    if (prof?.requires_onboarding) {
      const raw = (prof as any).first_name || ((prof.full_name || '').split(' ')[0])
      const titled = raw.toLowerCase().replace(/\b\w/g, (c: string) => c.toUpperCase())
      setSetupName(titled)
      setStep('setup')
    } else {
      navigate('/')
    }
  }

  const onSetupSubmit = async (values: SetupValues) => {
    setServerError(null)
    const { data, error } = await supabase.functions.invoke('complete-onboarding', {
      body: { new_email: values.email, new_password: values.password },
    })
    if (error || data?.error) {
      setServerError(data?.error ?? error?.message ?? 'Something went wrong. Please try again.')
      return
    }
    await refreshProfile()
    navigate('/')
  }

  const appName = branding?.name || 'CoopFinance'
  const isSetup = step === 'setup'

  return (
    <div className="min-h-screen flex flex-col lg:flex-row">
      {/* ── Mobile gradient header ── */}
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
          {brandingPending
            ? <div className="h-5 w-32 bg-white/20 rounded animate-pulse" />
            : <span className="text-white font-bold text-base">{appName}</span>
          }
        </div>
        <div className="relative z-10">
          <h2 className="text-2xl font-bold text-white">{isSetup ? 'Set up your account' : 'Welcome back'}</h2>
          <p className="text-blue-100 text-sm mt-1">
            {isSetup ? 'Choose your email and a secure password.' : 'Sign in to your account to continue'}
          </p>
        </div>
      </div>

      {/* ── Desktop branding panel ── */}
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
          {brandingPending
            ? <div className="h-7 w-40 mt-4 bg-white/20 rounded-lg animate-pulse" />
            : <p className="mt-4 text-white font-bold text-xl tracking-tight">{appName}</p>
          }
        </div>
        <div className="relative z-10 space-y-6">
          <div>
            <h2 className="text-2xl sm:text-3xl xl:text-4xl font-bold text-white leading-tight">
              {isSetup ? 'Welcome to the\ncooperative.' : 'Your cooperative,\nall in one place.'}
            </h2>
            <p className="mt-3 text-blue-100 text-base leading-relaxed">
              {isSetup
                ? 'Your account was created by an administrator. Set your email and password to get started.'
                : 'Manage equity shares, loan applications, and your membership — securely and transparently.'}
            </p>
          </div>
          <ul className="space-y-3">
            {(isSetup
              ? ['Set your personal email address', 'Choose a secure password', 'Access your cooperative account']
              : ['Track your equity contributions', 'Apply for and manage loans', 'Monitor membership status']
            ).map(text => (
              <li key={text} className="flex items-center gap-3 text-blue-100 text-sm">
                <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {text}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative z-10 text-blue-200 text-xs">Employees only · Secure cooperative platform</p>
      </div>

      {/* ── Right panel ── */}
      <div className="flex-1 flex flex-col justify-start lg:justify-center px-6 pt-6 pb-4 lg:py-10 sm:px-12 lg:px-16 xl:px-24 bg-white">
        <div className="w-full max-w-sm mx-auto lg:border lg:border-gray-200 lg:rounded-2xl lg:p-8 lg:shadow-sm">

          {/* ── Step 1: Login ── */}
          {!isSetup && (
            <>
              <div className="hidden lg:block mb-8">
                <h1 className="text-2xl font-bold text-gray-900">Welcome back</h1>
                <p className="mt-1 text-sm text-gray-500">Sign in to your account to continue</p>
              </div>

              <form onSubmit={loginForm.handleSubmit(onLoginSubmit)} className="space-y-5">
                {lockInfo.locked && (
                  <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 rounded-xl p-3.5 text-sm text-red-700">
                    <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /></svg>
                    Too many failed attempts. Try again in {lockInfo.remaining} minute(s).
                  </div>
                )}
                {serverError && !lockInfo.locked && (
                  <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 rounded-xl p-3.5 text-sm text-red-700">
                    <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /></svg>
                    {serverError}
                  </div>
                )}

                <div className="space-y-1.5">
                  <label className="block text-sm font-medium text-gray-700">Email or Employee ID</label>
                  <div className="relative">
                    <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5">
                      <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M16 12a4 4 0 10-8 0 4 4 0 008 0zm0 0v1.5a2.5 2.5 0 005 0V12a9 9 0 10-9 9m4.5-1.206a8.959 8.959 0 01-4.5 1.207" /></svg>
                    </div>
                    <input
                      type="text"
                      placeholder="you@gmail.com or EMP-04-03-..."
                      autoComplete="username"
                      {...loginForm.register('identifier')}
                      className={`block w-full pl-10 pr-3.5 py-2.5 text-sm rounded-xl border transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${loginForm.formState.errors.identifier ? 'border-red-300 bg-red-50' : 'border-gray-200 bg-gray-50 hover:border-gray-300'}`}
                    />
                  </div>
                  {loginForm.formState.errors.identifier && <p className="text-xs text-red-600">{loginForm.formState.errors.identifier.message}</p>}
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="block text-sm font-medium text-gray-700">Password</label>
                    <Link to="/forgot-password" className="text-xs text-blue-600 hover:text-blue-700 hover:underline">Forgot password?</Link>
                  </div>
                  <div className="relative">
                    <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5">
                      <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
                    </div>
                    <input
                      type={showPassword ? 'text' : 'password'}
                      placeholder="••••••••"
                      autoComplete="current-password"
                      {...loginForm.register('password')}
                      className={`block w-full pl-10 pr-10 py-2.5 text-sm rounded-xl border transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${loginForm.formState.errors.password ? 'border-red-300 bg-red-50' : 'border-gray-200 bg-gray-50 hover:border-gray-300'}`}
                    />
                    <button type="button" onClick={() => setShowPassword(v => !v)} className="absolute inset-y-0 right-0 flex items-center pr-3.5 text-gray-400 hover:text-gray-600" tabIndex={-1}>
                      {showPassword ? <EyeOff /> : <EyeOpen />}
                    </button>
                  </div>
                  {loginForm.formState.errors.password && <p className="text-xs text-red-600">{loginForm.formState.errors.password.message}</p>}
                </div>

                <Button type="submit" loading={loginForm.formState.isSubmitting} disabled={loginForm.formState.isSubmitting || lockInfo.locked} className="w-full" size="lg">
                  Sign In
                </Button>
              </form>

              <p className="mt-6 text-center text-sm text-gray-500">
                Don't have an account?{' '}
                <Link to="/register" className="font-medium text-blue-600 hover:text-blue-700 hover:underline">Create one</Link>
              </p>
            </>
          )}

          {/* ── Step 2: Account setup ── */}
          {isSetup && (
            <>
              <div className="hidden lg:block mb-6">
                <h1 className="text-2xl font-bold text-gray-900">Set up your account</h1>
                <p className="mt-1 text-sm text-gray-500">Choose your email and a secure password to get started.</p>
              </div>

              {setupName && (
                <div className="mb-5 p-3.5 bg-blue-50 border border-blue-100 rounded-xl">
                  <p className="text-sm text-blue-700">
                    Welcome, <strong>{setupName}</strong>. Your account was created by an administrator.
                  </p>
                </div>
              )}

              <form onSubmit={setupForm.handleSubmit(onSetupSubmit)} className="space-y-5">
                {serverError && (
                  <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 rounded-xl p-3.5 text-sm text-red-700">
                    <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /></svg>
                    {serverError}
                  </div>
                )}

                <div className="space-y-1.5">
                  <label className="block text-sm font-medium text-gray-700">Your email address</label>
                  <div className="relative">
                    <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5">
                      <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M16 12a4 4 0 10-8 0 4 4 0 008 0zm0 0v1.5a2.5 2.5 0 005 0V12a9 9 0 10-9 9m4.5-1.206a8.959 8.959 0 01-4.5 1.207" /></svg>
                    </div>
                    <input
                      type="email"
                      placeholder="you@gmail.com"
                      autoComplete="email"
                      {...setupForm.register('email')}
                      className={`block w-full pl-10 pr-3.5 py-2.5 text-sm rounded-xl border transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${setupForm.formState.errors.email ? 'border-red-300 bg-red-50' : 'border-gray-200 bg-gray-50 hover:border-gray-300'}`}
                    />
                  </div>
                  {setupForm.formState.errors.email && <p className="text-xs text-red-600">{setupForm.formState.errors.email.message}</p>}
                </div>

                <div className="space-y-1.5">
                  <label className="block text-sm font-medium text-gray-700">New password</label>
                  <div className="relative">
                    <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5">
                      <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
                    </div>
                    <input
                      type={showNewPassword ? 'text' : 'password'}
                      placeholder="Min. 8 characters"
                      autoComplete="new-password"
                      {...setupForm.register('password')}
                      className={`block w-full pl-10 pr-10 py-2.5 text-sm rounded-xl border transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${setupForm.formState.errors.password ? 'border-red-300 bg-red-50' : 'border-gray-200 bg-gray-50 hover:border-gray-300'}`}
                    />
                    <button type="button" onClick={() => setShowNewPassword(v => !v)} className="absolute inset-y-0 right-0 flex items-center pr-3.5 text-gray-400 hover:text-gray-600" tabIndex={-1}>
                      {showNewPassword ? <EyeOff /> : <EyeOpen />}
                    </button>
                  </div>
                  {setupForm.formState.errors.password && <p className="text-xs text-red-600">{setupForm.formState.errors.password.message}</p>}
                </div>

                <div className="space-y-1.5">
                  <label className="block text-sm font-medium text-gray-700">Confirm password</label>
                  <div className="relative">
                    <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5">
                      <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
                    </div>
                    <input
                      type={showConfirm ? 'text' : 'password'}
                      placeholder="Repeat your password"
                      autoComplete="new-password"
                      {...setupForm.register('confirmPassword')}
                      className={`block w-full pl-10 pr-10 py-2.5 text-sm rounded-xl border transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${setupForm.formState.errors.confirmPassword ? 'border-red-300 bg-red-50' : 'border-gray-200 bg-gray-50 hover:border-gray-300'}`}
                    />
                    <button type="button" onClick={() => setShowConfirm(v => !v)} className="absolute inset-y-0 right-0 flex items-center pr-3.5 text-gray-400 hover:text-gray-600" tabIndex={-1}>
                      {showConfirm ? <EyeOff /> : <EyeOpen />}
                    </button>
                  </div>
                  {setupForm.formState.errors.confirmPassword && <p className="text-xs text-red-600">{setupForm.formState.errors.confirmPassword.message}</p>}
                </div>

                <Button type="submit" loading={setupForm.formState.isSubmitting} disabled={setupForm.formState.isSubmitting} className="w-full" size="lg">
                  Complete Setup
                </Button>
              </form>
            </>
          )}
        </div>

        {/* Mobile footer */}
        <div className="lg:hidden mt-auto pt-4 border-t border-gray-100 space-y-1.5">
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
  )
}
