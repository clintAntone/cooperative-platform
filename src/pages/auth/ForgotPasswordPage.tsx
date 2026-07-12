import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { Button } from '../../components/ui/Button'
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
        redirectTo: window.location.origin + '/reset-password',
      })
      if (resetError) throw resetError
      setSuccess(true)
    } catch (err: any) {
      setError(err.message ?? 'Something went wrong. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const appName = branding?.name || 'CoopFinance'

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
          <h2 className="text-2xl font-bold text-white">Reset password</h2>
          <p className="text-blue-100 text-sm mt-1">We'll send a reset link to your email</p>
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

        <div className="relative z-10 space-y-4">
          <h2 className="text-3xl xl:text-4xl font-bold text-white leading-tight">
            Forgot your<br />password?
          </h2>
          <p className="text-blue-100 text-base leading-relaxed">
            No worries — enter your email and we'll send you a reset link right away.
          </p>
        </div>

        <p className="relative z-10 text-blue-200 text-xs">Employees only · Secure cooperative platform</p>
      </div>

      {/* ── Right panel (form) ── */}
      <div className="flex-1 flex flex-col justify-start lg:justify-center px-6 pt-6 pb-4 lg:py-10 sm:px-12 lg:px-16 xl:px-24 bg-white">
        <div className="w-full max-w-sm mx-auto lg:border lg:border-gray-200 lg:rounded-2xl lg:p-8 lg:shadow-sm">
          {success ? (
            <div className="text-center space-y-4">
              <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center mx-auto">
                <svg className="w-7 h-7 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-900">Check your email</h2>
                <p className="mt-2 text-sm text-gray-500">
                  We've sent a password reset link to <strong>{email}</strong>. Check your inbox (and spam folder).
                </p>
              </div>
              <Link to="/login" className="inline-block text-sm font-medium text-blue-600 hover:text-blue-700 hover:underline">
                ← Back to sign in
              </Link>
            </div>
          ) : (
            <>
              <div className="hidden lg:block mb-8">
                <h1 className="text-2xl font-bold text-gray-900">Reset password</h1>
                <p className="mt-1 text-sm text-gray-500">
                  Enter your email and we'll send you a reset link.
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-5">
                {error && (
                  <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 rounded-xl p-3.5 text-sm text-red-700">
                    <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                    </svg>
                    {error}
                  </div>
                )}

                <div className="space-y-1.5">
                  <label className="block text-sm font-medium text-gray-700">Email address</label>
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
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      required
                      className="block w-full pl-10 pr-3.5 py-2.5 text-sm rounded-xl border border-gray-200 bg-gray-50 hover:border-gray-300 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                </div>

                <Button type="submit" loading={isSubmitting} className="w-full" size="lg">
                  Send Reset Link
                </Button>

                <p className="text-center text-sm text-gray-500">
                  <Link to="/login" className="font-medium text-blue-600 hover:text-blue-700 hover:underline">
                    ← Back to sign in
                  </Link>
                </p>
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
