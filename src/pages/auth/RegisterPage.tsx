import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useAuth } from '../../context/AuthContext'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
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

  // Step 1: employee lookup
  const [employeeId, setEmployeeId] = useState('')
  const [lookupLoading, setLookupLoading] = useState(false)
  const [lookupError, setLookupError] = useState<string | null>(null)
  const [verifiedEmployee, setVerifiedEmployee] = useState<PosEmployee | null>(null)

  // Step 2: registration
  const [serverError, setServerError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegistrationValues>({ resolver: zodResolver(registrationSchema) })

  if (!loading && user) return <Navigate to="/dashboard" replace />

  // Step 1: look up the employee ID against the POS API
  const handleLookup = async () => {
    const trimmed = employeeId.trim().toUpperCase()
    if (!trimmed) {
      setLookupError('Please enter your Employee ID.')
      return
    }

    setLookupLoading(true)
    setLookupError(null)

    try {
      const headers: Record<string, string> = {}
      if (!import.meta.env.DEV) {
        headers['apikey'] = import.meta.env.VITE_SUPABASE_ANON_KEY
      }
      const res = await fetch(EMPLOYEE_API_URL, { headers })
      if (!res.ok) throw new Error('Could not reach the employee directory. Please try again.')

      const employees: PosEmployee[] = await res.json()
      const match = employees.find(e => e.employee_id === trimmed)

      if (!match) {
        setLookupError('Employee ID not found. Please check your ID and try again.')
        return
      }

      // Check if an account already exists for this employee ID
      const { data: existing } = await supabase
        .from('profiles')
        .select('id')
        .eq('employee_id', trimmed)
        .maybeSingle()

      if (existing) {
        setLookupError('An account already exists for this Employee ID. Please sign in instead.')
        return
      }

      setVerifiedEmployee(match)
    } catch (err: any) {
      setLookupError(err.message ?? 'Something went wrong. Please try again.')
    } finally {
      setLookupLoading(false)
    }
  }

  // Step 2: complete registration
  const onSubmit = async (values: RegistrationValues) => {
    if (!verifiedEmployee) return
    setServerError(null)

    const fullName = buildFullName(verifiedEmployee)
    const { error } = await signUp(
      values.email,
      values.password,
      fullName,
      values.phone,
      verifiedEmployee.employee_id,
    )

    if (error) {
      setServerError(error.message ?? 'Registration failed. Please try again.')
    } else {
      setSuccess(true)
      setTimeout(() => navigate('/login'), 3000)
    }
  }

  if (success) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 max-w-md w-full text-center">
          <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Account Created!</h2>
          <p className="text-gray-500 text-sm">
            Please check your email to confirm your account. You'll be redirected to login shortly.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 bg-blue-600 rounded-xl mb-4 overflow-hidden">
            {branding?.logoUrl ? (
              <img src={branding.logoUrl} alt="Logo" className="w-full h-full object-contain" />
            ) : (
              <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
            )}
          </div>
          {brandingPending
            ? <div className="h-8 w-44 mx-auto bg-gray-200 rounded-lg animate-pulse" />
            : <h1 className="text-2xl font-bold text-gray-900">Join {branding?.name || 'CoopFinance'}</h1>
          }
          <p className="text-gray-500 mt-1">
            {verifiedEmployee ? 'Complete your account setup' : 'Employees only — verify your ID to continue'}
          </p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">

          {/* ── Step 1: Employee ID lookup ── */}
          {!verifiedEmployee ? (
            <div className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Employee ID <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={employeeId}
                  onChange={e => { setEmployeeId(e.target.value); setLookupError(null) }}
                  onKeyDown={e => e.key === 'Enter' && handleLookup()}
                  placeholder="e.g. EMP-04-04-ZAPQ1IPHG"
                  className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                {lookupError && (
                  <p className="mt-1.5 text-xs text-red-600">{lookupError}</p>
                )}
                <p className="mt-1.5 text-xs text-gray-400">
                  Your Employee ID can be found on your company ID card or payslip.
                </p>
              </div>

              <Button
                className="w-full"
                size="lg"
                onClick={handleLookup}
                loading={lookupLoading}
              >
                Verify Employee ID
              </Button>

              <p className="text-center text-sm text-gray-500">
                Already have an account?{' '}
                <Link to="/login" className="text-blue-600 font-medium hover:underline">
                  Sign in
                </Link>
              </p>
            </div>

          ) : (

          /* ── Step 2: Registration form with autofilled name ── */
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
              {/* Verified employee banner */}
              <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-lg px-4 py-3">
                <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0">
                  <svg className="w-4 h-4 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-green-900">{buildFullName(verifiedEmployee)}</p>
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

              {/* Read-only full name */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
                <input
                  type="text"
                  value={buildFullName(verifiedEmployee)}
                  readOnly
                  className="block w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-500 cursor-not-allowed"
                />
                <p className="mt-1 text-xs text-gray-400">Pulled from employee records — cannot be changed here.</p>
              </div>

              {serverError && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
                  {serverError}
                </div>
              )}

              <Input
                label="Email address"
                type="email"
                placeholder="you@example.com"
                autoComplete="email"
                error={errors.email?.message}
                required
                {...register('email')}
              />

              <Input
                label="Phone number"
                type="tel"
                placeholder="09XXXXXXXXX"
                autoComplete="tel"
                error={errors.phone?.message}
                hint="Optional — used for account recovery"
                {...register('phone')}
              />

              <Input
                label="Password"
                type="password"
                placeholder="Min. 8 characters"
                autoComplete="new-password"
                error={errors.password?.message}
                required
                {...register('password')}
              />

              <Input
                label="Confirm Password"
                type="password"
                placeholder="Repeat password"
                autoComplete="new-password"
                error={errors.confirm_password?.message}
                required
                {...register('confirm_password')}
              />

              <Button type="submit" loading={isSubmitting} className="w-full" size="lg">
                Create Account
              </Button>

              <p className="text-center text-sm text-gray-500">
                Already have an account?{' '}
                <Link to="/login" className="text-blue-600 font-medium hover:underline">
                  Sign in
                </Link>
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
