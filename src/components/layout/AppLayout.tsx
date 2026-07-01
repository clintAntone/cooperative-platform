import { Outlet, Navigate } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { useAuth } from '../../context/AuthContext'
import { LoadingSpinner } from '../shared/LoadingSpinner'
import { OfflineBanner } from '../shared/OfflineBanner'

interface AppLayoutProps {
  requiredRoles?: string[]
}

export function AppLayout({ requiredRoles }: AppLayoutProps) {
  const { user, profile, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <LoadingSpinner size="lg" label="Loading..." />
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  if (requiredRoles && profile && !requiredRoles.includes(profile.role)) {
    const fallback = profile.role === 'member' ? '/dashboard' : '/reports'
    return <Navigate to={fallback} replace />
  }

  return (
    <div className="flex min-h-screen bg-gray-50">
      <OfflineBanner />
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
