import { useState, useEffect } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useAuth } from '../../context/AuthContext'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'

const schema = z.object({
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
})

type FormValues = z.infer<typeof schema>

// Rate limiting helpers
const ATTEMPTS_KEY = 'login_attempts'
const MAX_ATTEMPTS = 5
const WINDOW_MS = 15 * 60 * 1000

function getAttempts(): number[] {
  try {
    return JSON.parse(sessionStorage.getItem(ATTEMPTS_KEY) ?? '[]')
  } catch { return [] }
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

function clearAttempts() {
  sessionStorage.removeItem(ATTEMPTS_KEY)
}

export function LoginPage() {
  const { user, signIn, loading } = useAuth()
  const navigate = useNavigate()
  const [serverError, setServerError] = useState<string | null>(null)
  const [lockInfo, setLockInfo] = useState<{ locked: boolean; remaining: number }>({ locked: false, remaining: 0 })

  useEffect(() => {
    setLockInfo(isLockedOut())
    const interval = setInterval(() => {
      setLockInfo(isLockedOut())
    }, 30000)
    return () => clearInterval(interval)
  }, [])

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) })

  if (!loading && user) {
    return <Navigate to="/dashboard" replace />
  }

  const onSubmit = async (values: FormValues) => {
    const currentLock = isLockedOut()
    if (currentLock.locked) {
      setLockInfo(currentLock)
      return
    }

    setServerError(null)
    const { error } = await signIn(values.email, values.password)
    if (error) {
      recordAttempt()
      setLockInfo(isLockedOut())
      setServerError(error.message ?? 'Invalid email or password')
    } else {
      clearAttempts()
      navigate('/dashboard')
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 bg-blue-600 rounded-xl mb-4">
            <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">CoopFinance</h1>
          <p className="text-gray-500 mt-1">Sign in to your account</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            {lockInfo.locked && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
                Too many failed attempts. Try again in {lockInfo.remaining} minute(s).
              </div>
            )}

            {serverError && !lockInfo.locked && (
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
              {...register('email')}
            />

            <Input
              label="Password"
              type="password"
              placeholder="••••••••"
              autoComplete="current-password"
              error={errors.password?.message}
              {...register('password')}
            />

            <div className="flex justify-end">
              <Link to="/forgot-password" className="text-xs text-blue-600 hover:underline">
                Forgot password?
              </Link>
            </div>

            <Button
              type="submit"
              loading={isSubmitting}
              disabled={isSubmitting || lockInfo.locked}
              className="w-full"
              size="lg"
            >
              Sign In
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-gray-500">
            Don't have an account?{' '}
            <Link to="/register" className="text-blue-600 font-medium hover:underline">
              Create one
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
