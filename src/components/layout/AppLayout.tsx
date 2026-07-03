import { useState, useEffect } from 'react'
import { Outlet, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { useAuth } from '../../context/AuthContext'
import { useImpersonation } from '../../context/ImpersonationContext'
import { LoadingSpinner } from '../shared/LoadingSpinner'
import { OfflineBanner } from '../shared/OfflineBanner'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'

function useAppBranding() {
  return useQuery({
    queryKey: ['app_branding'],
    queryFn: async () => {
      const { data } = await supabase
        .from('system_config')
        .select('config_key, config_value')
        .in('config_key', ['app_name', 'app_logo_url'])
      const map = Object.fromEntries((data ?? []).map(r => [r.config_key, r.config_value]))
      return { name: map['app_name'] || 'CoopFinance', logoUrl: map['app_logo_url'] || '' }
    },
    staleTime: 60_000,
  })
}

interface AppLayoutProps {
  requiredRoles?: string[]
}

export function AppLayout({ requiredRoles }: AppLayoutProps) {
  const { user, profile, loading } = useAuth()
  const { isImpersonating, impersonatedUser, stopImpersonation } = useImpersonation()
  const location = useLocation()
  const navigate = useNavigate()
  const { data: branding } = useAppBranding()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  // Close sidebar on navigation
  useEffect(() => {
    setSidebarOpen(false)
  }, [location.pathname])

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <LoadingSpinner size="lg" label="Loading..." />
      </div>
    )
  }

  if (!user) return <Navigate to="/login" replace />

  // When impersonating, admins bypass route role guards so they can view member pages.
  if (!isImpersonating && requiredRoles && profile && !requiredRoles.includes(profile.role)) {
    const fallback = profile.role === 'member' ? '/dashboard' : '/reports'
    return <Navigate to={fallback} replace />
  }

  return (
    <div className="flex min-h-screen bg-gray-50">
      <OfflineBanner />

      {/* Mobile top bar */}
      <div className="fixed top-0 left-0 right-0 z-20 h-14 bg-gray-900 flex items-center px-4 gap-3 lg:hidden">
        <button
          onClick={() => setSidebarOpen(true)}
          className="text-gray-300 hover:text-white p-1 rounded-md"
          aria-label="Open menu"
        >
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-blue-500 rounded-lg flex items-center justify-center overflow-hidden flex-shrink-0">
            {branding?.logoUrl ? (
              <img src={branding.logoUrl} alt="Logo" className="w-full h-full object-contain" />
            ) : (
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
            )}
          </div>
          <span className="text-white font-semibold text-sm">{branding?.name ?? 'CoopFinance'}</span>
        </div>
      </div>

      {/* Overlay backdrop for mobile sidebar */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex-1 flex flex-col min-w-0">
        {isImpersonating && (
          <div className="bg-amber-500 text-white px-4 py-2 flex items-center justify-between gap-3 flex-shrink-0 z-10 mt-14 lg:mt-0">
            <div className="flex items-center gap-2 min-w-0">
              <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
              <span className="text-sm font-medium truncate">
                Viewing as <strong>{impersonatedUser?.full_name}</strong> — read-only member view
              </span>
            </div>
            <button
              onClick={async () => {
                // Navigate first so the admin route is active before isImpersonating
                // flips to false — otherwise the route guard redirects to /reports.
                navigate(`/admin/members/${impersonatedUser?.id}`)
                await stopImpersonation()
              }}
              className="flex-shrink-0 text-xs font-semibold bg-white/20 hover:bg-white/30 px-3 py-1 rounded-full transition-colors"
            >
              Exit
            </button>
          </div>
        )}
        <main className={`flex-1 overflow-auto ${isImpersonating ? '' : 'pt-14 lg:pt-0'}`}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}
