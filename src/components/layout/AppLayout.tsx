import { useState, useEffect } from 'react'
import { Outlet, Navigate, useLocation } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { useAuth } from '../../context/AuthContext'
import { LoadingSpinner } from '../shared/LoadingSpinner'
import { OfflineBanner } from '../shared/OfflineBanner'

interface AppLayoutProps {
  requiredRoles?: string[]
}

export function AppLayout({ requiredRoles }: AppLayoutProps) {
  const { user, profile, loading } = useAuth()
  const location = useLocation()
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

  if (requiredRoles && profile && !requiredRoles.includes(profile.role)) {
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
        <span className="text-white font-semibold text-sm">CoopFinance</span>
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
        <main className="flex-1 overflow-auto pt-14 lg:pt-0">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
