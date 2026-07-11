import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from './context/AuthContext'
import { ImpersonationProvider } from './context/ImpersonationContext'
import { ToastProvider } from './context/ToastContext'
import { AppLayout } from './components/layout/AppLayout'
import { useAuth } from './context/AuthContext'
import { ErrorBoundary } from './components/shared/ErrorBoundary'
import { OfflineBanner } from './components/shared/OfflineBanner'
import { LoadingSpinner } from './components/shared/LoadingSpinner'

function RootRedirect() {
  const { profile, loading } = useAuth()
  if (loading) return null
  const role = profile?.role
  if (role === 'member' || role === 'collector') return <Navigate to="/dashboard" replace />
  return <Navigate to="/reports" replace />
}

function PageFallback() {
  return (
    <div className="flex items-center justify-center min-h-[50vh]">
      <LoadingSpinner size="lg" label="Loading…" />
    </div>
  )
}

// Auth pages
const LoginPage = lazy(() => import('./pages/auth/LoginPage').then(m => ({ default: m.LoginPage })))
const RegisterPage = lazy(() => import('./pages/auth/RegisterPage').then(m => ({ default: m.RegisterPage })))
const ForgotPasswordPage = lazy(() => import('./pages/auth/ForgotPasswordPage').then(m => ({ default: m.ForgotPasswordPage })))
const ResetPasswordPage = lazy(() => import('./pages/auth/ResetPasswordPage').then(m => ({ default: m.ResetPasswordPage })))
const ProfileCompletionPage = lazy(() => import('./pages/auth/ProfileCompletionPage').then(m => ({ default: m.ProfileCompletionPage })))

// Member pages
const DashboardPage = lazy(() => import('./pages/dashboard/DashboardPage').then(m => ({ default: m.DashboardPage })))
const EquityPage = lazy(() => import('./pages/equity/EquityPage').then(m => ({ default: m.EquityPage })))
const DepositRequestPage = lazy(() => import('./pages/equity/DepositRequestPage').then(m => ({ default: m.DepositRequestPage })))
const MembershipPage = lazy(() => import('./pages/membership/MembershipPage').then(m => ({ default: m.MembershipPage })))
const LendingPage = lazy(() => import('./pages/lending/LendingPage').then(m => ({ default: m.LendingPage })))
const LoanDetailPage = lazy(() => import('./pages/lending/LoanDetailPage').then(m => ({ default: m.LoanDetailPage })))
const LoanCalculatorPage = lazy(() => import('./pages/lending/LoanCalculatorPage').then(m => ({ default: m.LoanCalculatorPage })))
const ActivityPage = lazy(() => import('./pages/activity/ActivityPage').then(m => ({ default: m.ActivityPage })))
const ProfilePage = lazy(() => import('./pages/profile/ProfilePage').then(m => ({ default: m.ProfilePage })))
const FaqPage = lazy(() => import('./pages/FaqPage').then(m => ({ default: m.FaqPage })))

// Savings pages
const SavingsPage = lazy(() => import('./pages/savings/SavingsPage').then(m => ({ default: m.SavingsPage })))
const SavingsDepositRequestPage = lazy(() => import('./pages/savings/SavingsDepositRequestPage').then(m => ({ default: m.SavingsDepositRequestPage })))
const SavingsWithdrawPage = lazy(() => import('./pages/savings/SavingsWithdrawPage').then(m => ({ default: m.SavingsWithdrawPage })))
const SavingsDepositRequestsPage = lazy(() => import('./pages/admin/SavingsDepositRequestsPage').then(m => ({ default: m.SavingsDepositRequestsPage })))
const SavingsWithdrawalsPage = lazy(() => import('./pages/admin/SavingsWithdrawalsPage').then(m => ({ default: m.SavingsWithdrawalsPage })))

// Admin / Staff pages
const ReportsPage = lazy(() => import('./pages/reports/ReportsPage').then(m => ({ default: m.ReportsPage })))
const UsersPage = lazy(() => import('./pages/admin/UsersPage').then(m => ({ default: m.UsersPage })))
const MembersPage = lazy(() => import('./pages/admin/MembersPage').then(m => ({ default: m.MembersPage })))
const MemberDetailPage = lazy(() => import('./pages/admin/MemberDetailPage').then(m => ({ default: m.MemberDetailPage })))
const DepositRequestsPage = lazy(() => import('./pages/admin/DepositRequestsPage').then(m => ({ default: m.DepositRequestsPage })))
const LoanApplicationsPage = lazy(() => import('./pages/admin/LoanApplicationsPage').then(m => ({ default: m.LoanApplicationsPage })))
const LoanProductsPage = lazy(() => import('./pages/admin/LoanProductsPage').then(m => ({ default: m.LoanProductsPage })))
const AdminLoanDetailPage = lazy(() => import('./pages/admin/AdminLoanDetailPage').then(m => ({ default: m.AdminLoanDetailPage })))

// Collector pages
const BatchDepositPage = lazy(() => import('./pages/collector/BatchDepositPage').then(m => ({ default: m.BatchDepositPage })))
const BatchDepositsPage = lazy(() => import('./pages/admin/BatchDepositsPage').then(m => ({ default: m.BatchDepositsPage })))

// Admin-only pages
const AdminPage = lazy(() => import('./pages/admin/AdminPage').then(m => ({ default: m.AdminPage })))
const ConfigPage = lazy(() => import('./pages/admin/ConfigPage').then(m => ({ default: m.ConfigPage })))
const AppSettingsPage = lazy(() => import('./pages/admin/AppSettingsPage').then(m => ({ default: m.AppSettingsPage })))
const PermissionsPage = lazy(() => import('./pages/admin/PermissionsPage').then(m => ({ default: m.PermissionsPage })))
const UserDetailPage = lazy(() => import('./pages/admin/UserDetailPage').then(m => ({ default: m.UserDetailPage })))

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
          <Suspense fallback={<PageFallback />}>
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

              {/* All authenticated users */}
              <Route element={<AppLayout />}>
                <Route path="/faq" element={<ErrorBoundary><FaqPage /></ErrorBoundary>} />
                <Route path="/profile" element={<ErrorBoundary><ProfilePage /></ErrorBoundary>} />
              </Route>

              {/* Member + Collector */}
              <Route element={<AppLayout requiredRoles={['member', 'collector']} />}>
                <Route path="/dashboard" element={<ErrorBoundary><DashboardPage /></ErrorBoundary>} />
                <Route path="/equity" element={<ErrorBoundary><EquityPage /></ErrorBoundary>} />
                <Route path="/equity/deposit-request" element={<ErrorBoundary><DepositRequestPage /></ErrorBoundary>} />
                <Route path="/membership" element={<ErrorBoundary><MembershipPage /></ErrorBoundary>} />
                <Route path="/lending" element={<ErrorBoundary><LendingPage /></ErrorBoundary>} />
                <Route path="/lending/calculator" element={<ErrorBoundary><LoanCalculatorPage /></ErrorBoundary>} />
                <Route path="/lending/:id" element={<ErrorBoundary><LoanDetailPage /></ErrorBoundary>} />
                <Route path="/activity" element={<ErrorBoundary><ActivityPage /></ErrorBoundary>} />
                <Route path="/savings" element={<ErrorBoundary><SavingsPage /></ErrorBoundary>} />
                <Route path="/savings/deposit-request" element={<ErrorBoundary><SavingsDepositRequestPage /></ErrorBoundary>} />
                <Route path="/savings/withdraw" element={<ErrorBoundary><SavingsWithdrawPage /></ErrorBoundary>} />
              </Route>

              {/* Collector only */}
              <Route element={<AppLayout requiredRoles={['collector']} />}>
                <Route path="/batch-deposit" element={<ErrorBoundary><BatchDepositPage /></ErrorBoundary>} />
                <Route path="/batch-deposits" element={<ErrorBoundary><BatchDepositsPage /></ErrorBoundary>} />
              </Route>

              {/* Admin + Staff */}
              <Route element={<AppLayout requiredRoles={['admin', 'staff']} />}>
                <Route path="/reports" element={<ErrorBoundary><ReportsPage /></ErrorBoundary>} />
                <Route path="/admin/users" element={<ErrorBoundary><UsersPage /></ErrorBoundary>} />
                <Route path="/admin/members" element={<ErrorBoundary><MembersPage /></ErrorBoundary>} />
                <Route path="/admin/members/:id" element={<ErrorBoundary><MemberDetailPage /></ErrorBoundary>} />
                <Route path="/admin/deposit-requests" element={<ErrorBoundary><DepositRequestsPage /></ErrorBoundary>} />
                <Route path="/admin/batch-deposits" element={<ErrorBoundary><BatchDepositsPage /></ErrorBoundary>} />
                <Route path="/admin/loans" element={<ErrorBoundary><LoanApplicationsPage /></ErrorBoundary>} />
                <Route path="/admin/loans/:id" element={<ErrorBoundary><AdminLoanDetailPage /></ErrorBoundary>} />
                <Route path="/admin/loan-products" element={<ErrorBoundary><LoanProductsPage /></ErrorBoundary>} />
                <Route path="/admin/savings-deposits" element={<ErrorBoundary><SavingsDepositRequestsPage /></ErrorBoundary>} />
                <Route path="/admin/savings-withdrawals" element={<ErrorBoundary><SavingsWithdrawalsPage /></ErrorBoundary>} />
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
          </Suspense>
        </BrowserRouter>
        </ToastProvider>
        </ImpersonationProvider>
      </AuthProvider>
    </QueryClientProvider>
  )
}
