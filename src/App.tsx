import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from './context/AuthContext'
import { ImpersonationProvider } from './context/ImpersonationContext'
import { ToastProvider } from './context/ToastContext'
import { AppLayout } from './components/layout/AppLayout'
import { useAuth } from './context/AuthContext'
import { ErrorBoundary } from './components/shared/ErrorBoundary'
import { OfflineBanner } from './components/shared/OfflineBanner'

function RootRedirect() {
  const { profile, loading } = useAuth()
  if (loading) return null
  return <Navigate to={profile?.role === 'member' ? '/dashboard' : '/reports'} replace />
}

import { LoginPage } from './pages/auth/LoginPage'
import { RegisterPage } from './pages/auth/RegisterPage'
import { ForgotPasswordPage } from './pages/auth/ForgotPasswordPage'
import { ResetPasswordPage } from './pages/auth/ResetPasswordPage'
import { DashboardPage } from './pages/dashboard/DashboardPage'
import { EquityPage } from './pages/equity/EquityPage'
import { DepositRequestPage } from './pages/equity/DepositRequestPage'
import { MembershipPage } from './pages/membership/MembershipPage'
import { LendingPage } from './pages/lending/LendingPage'
import { LoanDetailPage } from './pages/lending/LoanDetailPage'
import { LoanCalculatorPage } from './pages/lending/LoanCalculatorPage'
import { ReportsPage } from './pages/reports/ReportsPage'
import { AdminPage } from './pages/admin/AdminPage'
import { ConfigPage } from './pages/admin/ConfigPage'
import { AppSettingsPage } from './pages/admin/AppSettingsPage'
import { UsersPage } from './pages/admin/UsersPage'
import { MembersPage } from './pages/admin/MembersPage'
import { MemberDetailPage } from './pages/admin/MemberDetailPage'
import { DepositRequestsPage } from './pages/admin/DepositRequestsPage'
import { LoanApplicationsPage } from './pages/admin/LoanApplicationsPage'
import { LoanProductsPage } from './pages/admin/LoanProductsPage'
import { AdminLoanDetailPage } from './pages/admin/AdminLoanDetailPage'
import { PermissionsPage } from './pages/admin/PermissionsPage'
import { UserDetailPage } from './pages/admin/UserDetailPage'
import { FaqPage } from './pages/FaqPage'
import { ActivityPage } from './pages/activity/ActivityPage'
import { ProfilePage } from './pages/profile/ProfilePage'
import { ProfileCompletionPage } from './pages/auth/ProfileCompletionPage'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
})

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ImpersonationProvider>
        <ToastProvider>
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <OfflineBanner />
          <Routes>
            {/* Public routes */}
            <Route path="/login" element={<ErrorBoundary><LoginPage /></ErrorBoundary>} />
            <Route path="/register" element={<ErrorBoundary><RegisterPage /></ErrorBoundary>} />
            <Route path="/forgot-password" element={<ErrorBoundary><ForgotPasswordPage /></ErrorBoundary>} />
            <Route path="/reset-password" element={<ErrorBoundary><ResetPasswordPage /></ErrorBoundary>} />

            {/* Profile completion — no sidebar, same layout as auth pages */}
            <Route path="/complete-profile" element={<ErrorBoundary><ProfileCompletionPage /></ErrorBoundary>} />

            {/* Root redirect — authenticated only, role-aware */}
            <Route element={<AppLayout />}>
              <Route path="/" element={<RootRedirect />} />
            </Route>

            {/* FAQ — all authenticated users */}
            <Route element={<AppLayout />}>
              <Route path="/faq" element={<ErrorBoundary><FaqPage /></ErrorBoundary>} />
            </Route>

            {/* Member only */}
            <Route element={<AppLayout requiredRoles={['member']} />}>
              <Route path="/dashboard" element={<ErrorBoundary><DashboardPage /></ErrorBoundary>} />
              <Route path="/equity" element={<ErrorBoundary><EquityPage /></ErrorBoundary>} />
              <Route path="/equity/deposit-request" element={<ErrorBoundary><DepositRequestPage /></ErrorBoundary>} />
              <Route path="/membership" element={<ErrorBoundary><MembershipPage /></ErrorBoundary>} />
              <Route path="/lending" element={<ErrorBoundary><LendingPage /></ErrorBoundary>} />
              <Route path="/lending/calculator" element={<ErrorBoundary><LoanCalculatorPage /></ErrorBoundary>} />
              <Route path="/lending/:id" element={<ErrorBoundary><LoanDetailPage /></ErrorBoundary>} />
              <Route path="/activity" element={<ErrorBoundary><ActivityPage /></ErrorBoundary>} />
              <Route path="/profile" element={<ErrorBoundary><ProfilePage /></ErrorBoundary>} />
            </Route>

            {/* Admin + Staff */}
            <Route element={<AppLayout requiredRoles={['admin', 'staff']} />}>
              <Route path="/reports" element={<ErrorBoundary><ReportsPage /></ErrorBoundary>} />
              <Route path="/admin/users" element={<ErrorBoundary><UsersPage /></ErrorBoundary>} />
              <Route path="/admin/members" element={<ErrorBoundary><MembersPage /></ErrorBoundary>} />
              <Route path="/admin/members/:id" element={<ErrorBoundary><MemberDetailPage /></ErrorBoundary>} />
              <Route path="/admin/deposit-requests" element={<ErrorBoundary><DepositRequestsPage /></ErrorBoundary>} />
              <Route path="/admin/loans" element={<ErrorBoundary><LoanApplicationsPage /></ErrorBoundary>} />
              <Route path="/admin/loans/:id" element={<ErrorBoundary><AdminLoanDetailPage /></ErrorBoundary>} />
              <Route path="/admin/loan-products" element={<ErrorBoundary><LoanProductsPage /></ErrorBoundary>} />
            </Route>

            {/* Admin only */}
            <Route element={<AppLayout requiredRoles={['admin']} />}>
              <Route path="/admin" element={<ErrorBoundary><AdminPage /></ErrorBoundary>} />
              <Route path="/admin/config" element={<ErrorBoundary><ConfigPage /></ErrorBoundary>} />
              <Route path="/admin/settings" element={<ErrorBoundary><AppSettingsPage /></ErrorBoundary>} />
              <Route path="/admin/permissions" element={<ErrorBoundary><PermissionsPage /></ErrorBoundary>} />
              <Route path="/admin/users/:id" element={<ErrorBoundary><UserDetailPage /></ErrorBoundary>} />
            </Route>

            {/* Fallback — redirect based on role */}
            <Route path="*" element={<RootRedirect />} />
          </Routes>
        </BrowserRouter>
        </ToastProvider>
        </ImpersonationProvider>
      </AuthProvider>
    </QueryClientProvider>
  )
}
