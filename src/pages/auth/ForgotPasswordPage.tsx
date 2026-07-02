import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { useAppBranding } from '../../hooks/useAppBranding'

export function ForgotPasswordPage() {
  const { data: branding, isPending: brandingPending } = useAppBranding()
  const [email, setEmail] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setIsSubmitting(true)
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + '/login',
      })
      if (resetError) throw resetError
      setSuccess(true)
    } catch (err: any) {
      setError(err.message ?? 'Something went wrong. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
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
            ? <div className="h-8 w-40 mx-auto bg-gray-200 rounded-lg animate-pulse" />
            : <h1 className="text-2xl font-bold text-gray-900">{branding?.name || 'CoopFinance'}</h1>
          }
          <p className="text-gray-500 mt-1">Reset your password</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
          {success ? (
            <div className="space-y-4">
              <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-sm text-green-800">
                Check your email for a password reset link.
              </div>
              <p className="text-sm text-center text-gray-500">
                <Link to="/login" className="text-blue-600 font-medium hover:underline">
                  Back to Sign In
                </Link>
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
                  {error}
                </div>
              )}

              <p className="text-sm text-gray-500">
                Enter the email address associated with your account and we'll send you a link to reset your password.
              </p>

              <Input
                label="Email address"
                type="email"
                placeholder="you@example.com"
                autoComplete="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
              />

              <Button
                type="submit"
                loading={isSubmitting}
                className="w-full"
                size="lg"
              >
                Send Reset Link
              </Button>

              <p className="text-center text-sm text-gray-500">
                <Link to="/login" className="text-blue-600 font-medium hover:underline">
                  Back to Sign In
                </Link>
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
