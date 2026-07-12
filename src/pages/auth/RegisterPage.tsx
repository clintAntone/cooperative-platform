import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useAuth } from '../../context/AuthContext'
import { Button } from '../../components/ui/Button'
import { useAppBranding } from '../../hooks/useAppBranding'
import { supabase } from '../../lib/supabase'

const EMPLOYEE_API_URL = import.meta.env.DEV
  ? `/api/pos/employees`
  : `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/pos-employees`

interface PosEmployee {
  employee_id: string
  first_name: string
  middle_name: string | null
  last_name: string
}

function buildFullName(emp: PosEmployee) {
  return [emp.first_name, emp.middle_name, emp.last_name].filter(Boolean).join(' ')
}

const registrationSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  phone: z.string().optional(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  confirm_password: z.string(),
}).refine(data => data.password === data.confirm_password, {
  message: 'Passwords do not match',
  path: ['confirm_password'],
})

type RegistrationValues = z.infer<typeof registrationSchema>

export function RegisterPage() {
  const { user, signUp, loading } = useAuth()
  const navigate = useNavigate()
  const { data: branding, isPending: brandingPending } = useAppBranding()

  const [employeeId, setEmployeeId] = useState('')
  const [lookupLoading, setLookupLoading] = useState(false)
  const [lookupError, setLookupError] = useState<string | null>(null)
  const [matches, setMatches] = useState<PosEmployee[] | null>(null)
  const [verifiedEmployee, setVerifiedEmployee] = useState<PosEmployee | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<RegistrationValues>({
    resolver: zodResolver(registrationSchema),
  })

  if (!loading && user) return <Navigate to="/dashboard" replace />

  const handleLookup = async () => {
    const trimmed = employeeId.trim().toUpperCase()
    if (!trimmed) { setLookupError('Please enter your Employee ID or unique code.'); return }
    setLookupLoading(true)
    setLookupError(null)
    setMatches(null)
    try {
      const headers: Record<string, string> = {}
      if (!import.meta.env.DEV) {
        const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
        headers['apikey'] = anonKey
        headers['Authorization'] = `Bearer ${anonKey}`
      }
      const res = await fetch(EMPLOYEE_API_URL, { headers })
      if (!res.ok) throw new Error('Could not reach the employee directory. Please try again.')
      const raw = await res.json()
      // POS API may return a plain array or a wrapped object like { data: [...] }
      const employees: PosEmployee[] = Array.isArray(raw)
        ? raw
        : (raw.data ?? raw.employees ?? raw.items ?? [])
      // Match against full ID or any segment (e.g. just the unique code "LMDYZVCFN")
      const found = employees.filter(e => e.employee_id.includes(trimmed))
      if (found.length === 0) {
        setLookupError('No employee found. Please check your ID or unique code and try again.')
        return
      }
      if (found.length === 1) {
        await selectEmployee(found[0])
      } else {
        setMatches(found)
      }
    } catch (err: any) {
      setLookupError(err.message ?? 'Something went wrong. Please try again.')
    } finally {
      setLookupLoading(false)
    }
  }

  const selectEmployee = async (emp: PosEmployee) => {
    const { data: available, error: availErr } = await supabase
      .rpc('is_employee_id_available', { p_employee_id: emp.employee_id })
    if (availErr) throw new Error('Could not verify employee ID. Please try again.')
    if (!available) {
      setLookupError('An account already exists for this Employee ID. Please sign in instead.')
      setMatches(null)
      return
    }
    setMatches(null)
    setVerifiedEmployee(emp)
  }

  const onSubmit = async (values: RegistrationValues) => {
    if (!verifiedEmployee) return
    setServerError(null)
    const { error } = await signUp(
      values.email, values.password,
      buildFullName(verifiedEmployee), values.phone,
      verifiedEmployee.employee_id,
    )
    if (error) {
      setServerError(error.message ?? 'Registration failed. Please try again.')
    } else {
      setSuccess(true)
      setTimeout(() => navigate('/login'), 4000)
    }
  }

  const appName = branding?.name || 'CoopFinance'

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="max-w-md w-full text-center space-y-4">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto">
            <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-gray-900">Account created!</h2>
          <p className="text-sm text-gray-500">
            Check your email to confirm your account. You'll be redirected to login shortly.
          </p>
        </div>
      </div>
    )
  }

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
          <h2 className="text-2xl font-bold text-white">Create your account</h2>
          <p className="text-blue-100 text-sm mt-1">Employees only — verify your ID to continue</p>
        </div>
      </div>

      {/* ── Desktop branding panel (left side only) ── */}
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
              Join your<br />cooperative today.
            </h2>
            <p className="mt-3 text-blue-100 text-base leading-relaxed">
              Registration is open to verified employees only. Your Employee ID will be checked against the company directory.
            </p>
          </div>
          <ul className="space-y-3">
            {[
              { icon: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z', text: 'Verified employee-only access' },
              { icon: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z', text: 'Start building equity shares' },
              { icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z', text: 'Track contributions over time' },
            ].map(item => (
              <li key={item.text} className="flex items-center gap-3 text-blue-100 text-sm">
                <span className="flex-shrink-0 w-5 h-5">
                  <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
                  </svg>
                </span>
                {item.text}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative z-10 text-blue-200 text-xs">Employees only · Secure cooperative platform</p>
      </div>

      {/* ── Right panel (form) ── */}
      <div className="flex-1 flex flex-col justify-start lg:justify-center px-6 pt-6 pb-4 lg:py-10 sm:px-12 lg:px-16 xl:px-24 bg-white overflow-y-auto">

        <div className="w-full max-w-sm mx-auto lg:border lg:border-gray-200 lg:rounded-2xl lg:p-8 lg:shadow-sm">
          <div className="hidden lg:block mb-8">
            <h1 className="text-2xl font-bold text-gray-900">Create your account</h1>
            <p className="mt-1 text-sm text-gray-500">Employees only — verify your ID to continue</p>
          </div>

          {/* ── Step 1: Employee ID ── */}
          {!verifiedEmployee ? (
            <div className="space-y-5">
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-gray-700">
                  Employee ID <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5">
                    <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0m-5 8a2 2 0 100-4 2 2 0 000 4zm0 0c1.306 0 2.417.835 2.83 2M9 14a3.001 3.001 0 00-2.83 2M15 11h3m-3 4h2" />
                    </svg>
                  </div>
                  <input
                    type="text"
                    value={employeeId}
                    onChange={e => { setEmployeeId(e.target.value); setLookupError(null); setMatches(null) }}
                    onKeyDown={e => e.key === 'Enter' && handleLookup()}
                    placeholder="Full ID or unique code (e.g. ZAPQ1IPHG)"
                    className={`block w-full pl-10 pr-3.5 py-2.5 text-sm rounded-xl border transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${lookupError ? 'border-red-300 bg-red-50' : 'border-gray-200 bg-gray-50 hover:border-gray-300'}`}
                  />
                </div>
                {lookupError
                  ? <p className="text-xs text-red-600">{lookupError}</p>
                  : <p className="text-xs text-gray-400">Enter your full ID or just the unique code from your ID card</p>
                }
              </div>

              {/* Matches list */}
              {matches && matches.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-gray-600">{matches.length} employee{matches.length > 1 ? 's' : ''} found — select yours:</p>
                  <div className="divide-y divide-gray-100 rounded-xl border border-gray-200 overflow-hidden">
                    {matches.map(emp => (
                      <button
                        key={emp.employee_id}
                        type="button"
                        onClick={() => selectEmployee(emp)}
                        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-blue-50 transition-colors"
                      >
                        <div>
                          <p className="text-sm font-medium text-gray-900">{buildFullName(emp)}</p>
                          <p className="text-xs text-gray-400 font-mono mt-0.5">{emp.employee_id}</p>
                        </div>
                        <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                        </svg>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <Button className="w-full" size="lg" onClick={handleLookup} loading={lookupLoading}>
                Search Employee
              </Button>

              <p className="text-center text-sm text-gray-500">
                Already have an account?{' '}
                <Link to="/login" className="font-medium text-blue-600 hover:text-blue-700 hover:underline">Sign in</Link>
              </p>
            </div>

          ) : (

          /* ── Step 2: Registration form ── */
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
              {/* Verified banner */}
              <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-xl px-4 py-3">
                <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0">
                  <svg className="w-4 h-4 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-green-900 truncate">{buildFullName(verifiedEmployee)}</p>
                  <p className="text-xs text-green-600 font-mono">{verifiedEmployee.employee_id}</p>
                </div>
                <button
                  type="button"
                  onClick={() => { setVerifiedEmployee(null); setEmployeeId('') }}
                  className="ml-auto text-xs text-green-700 hover:text-green-900 underline flex-shrink-0"
                >
                  Change
                </button>
              </div>

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
                <label className="block text-sm font-medium text-gray-700">Email address <span className="text-red-500">*</span></label>
                <div className="relative">
                  <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5">
                    <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16 12a4 4 0 10-8 0 4 4 0 008 0zm0 0v1.5a2.5 2.5 0 005 0V12a9 9 0 10-9 9m4.5-1.206a8.959 8.959 0 01-4.5 1.207" />
                    </svg>
                  </div>
                  <input type="email" placeholder="you@gmail.com" autoComplete="email" {...register('email')}
                    className={`block w-full pl-10 pr-3.5 py-2.5 text-sm rounded-xl border transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${errors.email ? 'border-red-300 bg-red-50' : 'border-gray-200 bg-gray-50 hover:border-gray-300'}`} />
                </div>
                {errors.email && <p className="text-xs text-red-600">{errors.email.message}</p>}
              </div>

              {/* Phone */}
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-gray-700">Phone number</label>
                <div className="relative">
                  <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5">
                    <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                    </svg>
                  </div>
                  <input type="tel" placeholder="09XXXXXXXXX" autoComplete="tel" {...register('phone')}
                    className="block w-full pl-10 pr-3.5 py-2.5 text-sm rounded-xl border border-gray-200 bg-gray-50 hover:border-gray-300 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
                </div>
                <p className="text-xs text-gray-400">Optional — used for account recovery</p>
              </div>

              {/* Password */}
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-gray-700">Password <span className="text-red-500">*</span></label>
                <div className="relative">
                  <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5">
                    <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                  </div>
                  <input type={showPassword ? 'text' : 'password'} placeholder="Min. 8 characters" autoComplete="new-password" {...register('password')}
                    className={`block w-full pl-10 pr-10 py-2.5 text-sm rounded-xl border transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${errors.password ? 'border-red-300 bg-red-50' : 'border-gray-200 bg-gray-50 hover:border-gray-300'}`} />
                  <button type="button" tabIndex={-1} onClick={() => setShowPassword(v => !v)} className="absolute inset-y-0 right-0 flex items-center pr-3.5 text-gray-400 hover:text-gray-600">
                    {showPassword
                      ? <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>
                      : <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                    }
                  </button>
                </div>
                {errors.password && <p className="text-xs text-red-600">{errors.password.message}</p>}
              </div>

              {/* Confirm Password */}
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-gray-700">Confirm password <span className="text-red-500">*</span></label>
                <div className="relative">
                  <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5">
                    <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                  </div>
                  <input type={showConfirm ? 'text' : 'password'} placeholder="Repeat password" autoComplete="new-password" {...register('confirm_password')}
                    className={`block w-full pl-10 pr-10 py-2.5 text-sm rounded-xl border transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${errors.confirm_password ? 'border-red-300 bg-red-50' : 'border-gray-200 bg-gray-50 hover:border-gray-300'}`} />
                  <button type="button" tabIndex={-1} onClick={() => setShowConfirm(v => !v)} className="absolute inset-y-0 right-0 flex items-center pr-3.5 text-gray-400 hover:text-gray-600">
                    {showConfirm
                      ? <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>
                      : <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                    }
                  </button>
                </div>
                {errors.confirm_password && <p className="text-xs text-red-600">{errors.confirm_password.message}</p>}
              </div>

              <Button type="submit" loading={isSubmitting} className="w-full" size="lg">
                Create Account
              </Button>

              <p className="text-center text-sm text-gray-500">
                Already have an account?{' '}
                <Link to="/login" className="font-medium text-blue-600 hover:text-blue-700 hover:underline">Sign in</Link>
              </p>
            </form>
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
