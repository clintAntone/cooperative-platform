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
  if (role === 'member') return <Navigate to="/dashboard" replace />
  if (role === 'board') return <Navigate to="/reports" replace />
  return <Navigate to="/overview" replace />
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

// Member pages — simplified
const DashboardPage = lazy(() => import('./pages/dashboard/DashboardPage').then(m => ({ default: m.DashboardPage })))
const LendingPage = lazy(() => import('./pages/lending/LendingPage').then(m => ({ default: m.LendingPage })))
const LoanDetailPage = lazy(() => import('./pages/lending/LoanDetailPage').then(m => ({ default: m.LoanDetailPage })))
const LoanCalculatorPage = lazy(() => import('./pages/lending/LoanCalculatorPage').then(m => ({ default: m.LoanCalculatorPage })))
const ProfilePage = lazy(() => import('./pages/profile/ProfilePage').then(m => ({ default: m.ProfilePage })))
const FaqPage = lazy(() => import('./pages/FaqPage').then(m => ({ default: m.FaqPage })))

// Staff pages
const WeeklyPostingPage = lazy(() => import('./pages/staff/WeeklyPostingPage').then(m => ({ default: m.WeeklyPostingPage })))

// Admin / Staff pages
const OverviewPage = lazy(() => import('./pages/overview/OverviewPage').then(m => ({ default: m.OverviewPage })))
const ReportsPage = lazy(() => import('./pages/reports/ReportsPage').then(m => ({ default: m.ReportsPage })))
const MembersPage = lazy(() => import('./pages/admin/MembersPage').then(m => ({ default: m.MembersPage })))
const MemberDetailPage = lazy(() => import('./pages/admin/MemberDetailPage').then(m => ({ default: m.MemberDetailPage })))
const LoanApplicationsPage = lazy(() => import('./pages/admin/LoanApplicationsPage').then(m => ({ default: m.LoanApplicationsPage })))
const LoanProductsPage = lazy(() => import('./pages/admin/LoanProductsPage').then(m => ({ default: m.LoanProductsPage })))
const AdminLoanDetailPage = lazy(() => import('./pages/admin/AdminLoanDetailPage').then(m => ({ default: m.AdminLoanDetailPage })))
const AdminLoanApplicationDetailPage = lazy(() => import('./pages/admin/AdminLoanApplicationDetailPage').then(m => ({ default: m.AdminLoanApplicationDetailPage })))
const AllDepositRequestsPage = lazy(() => import('./pages/admin/AllDepositRequestsPage').then(m => ({ default: m.AllDepositRequestsPage })))
const SavingsWithdrawalsPage = lazy(() => import('./pages/admin/SavingsWithdrawalsPage').then(m => ({ default: m.SavingsWithdrawalsPage })))
const AdminSavingsPage = lazy(() => import('./pages/admin/AdminSavingsPage').then(m => ({ default: m.AdminSavingsPage })))
const ShareTransfersPage = lazy(() => import('./pages/admin/ShareTransfersPage').then(m => ({ default: m.ShareTransfersPage })))
const DamayanAdminPage = lazy(() => import('./pages/admin/DamayanAdminPage').then(m => ({ default: m.DamayanAdminPage })))
const BranchesPage = lazy(() => import('./pages/admin/BranchesPage').then(m => ({ default: m.BranchesPage })))
const UsersPage = lazy(() => import('./pages/admin/UsersPage').then(m => ({ default: m.UsersPage })))

// Admin-only pages
const AdminPage = lazy(() => import('./pages/admin/AdminPage').then(m => ({ default: m.AdminPage })))
const ConfigPage = lazy(() => import('./pages/admin/ConfigPage').then(m => ({ default: m.ConfigPage })))
const AppSettingsPage = lazy(() => import('./pages/admin/AppSettingsPage').then(m => ({ default: m.AppSettingsPage })))
const PermissionsPage = lazy(() => import('./pages/admin/PermissionsPage').then(m => ({ default: m.PermissionsPage })))
const UserDetailPage = lazy(() => import('./pages/admin/UserDetailPage').then(m => ({ default: m.UserDetailPage })))
const RolesPage = lazy(() => import('./pages/admin/RolesPage').then(m => ({ default: m.RolesPage })))
const DividendsPage = lazy(() => import('./pages/admin/DividendsPage').then(m => ({ default: m.DividendsPage })))
const RebatesPage = lazy(() => import('./pages/admin/RebatesPage').then(m => ({ default: m.RebatesPage })))

// Board
const BranchKPIPage = lazy(() => import('./pages/branches/BranchKPIPage').then(m => ({ default: m.BranchKPIPage })))

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
              <Route path="/complete-profile" element={<ErrorBoundary><ProfileCompletionPage /></ErrorBoundary>} />

              {/* Root redirect */}
              <Route element={<AppLayout />}>
                <Route path="/" element={<RootRedirect />} />
              </Route>

              {/* All authenticated users */}
              <Route element={<AppLayout />}>
                <Route path="/faq" element={<ErrorBoundary><FaqPage /></ErrorBoundary>} />
                <Route path="/profile" element={<ErrorBoundary><ProfilePage /></ErrorBoundary>} />
              </Route>

              {/* Member */}
              <Route element={<AppLayout requiredRoles={['member']} />}>
                <Route path="/dashboard" element={<ErrorBoundary><DashboardPage /></ErrorBoundary>} />
                <Route path="/loans" element={<ErrorBoundary><LendingPage /></ErrorBoundary>} />
                <Route path="/loans/calculator" element={<ErrorBoundary><LoanCalculatorPage /></ErrorBoundary>} />
                <Route path="/loans/:id" element={<ErrorBoundary><LoanDetailPage /></ErrorBoundary>} />
                <Route path="/loans/apply" element={<ErrorBoundary><LendingPage /></ErrorBoundary>} />
              </Route>

              {/* Board + Admin + Staff — read views */}
              <Route element={<AppLayout requiredRoles={['admin', 'staff', 'board']} />}>
                <Route path="/overview" element={<ErrorBoundary><OverviewPage /></ErrorBoundary>} />
                <Route path="/reports" element={<ErrorBoundary><ReportsPage /></ErrorBoundary>} />
                <Route path="/branches" element={<ErrorBoundary><BranchKPIPage /></ErrorBoundary>} />
                <Route path="/admin/members" element={<ErrorBoundary><MembersPage /></ErrorBoundary>} />
                <Route path="/admin/members/:id" element={<ErrorBoundary><MemberDetailPage /></ErrorBoundary>} />
                <Route path="/admin/loans" element={<ErrorBoundary><LoanApplicationsPage /></ErrorBoundary>} />
                <Route path="/admin/loans/applications/:id" element={<ErrorBoundary><AdminLoanApplicationDetailPage /></ErrorBoundary>} />
                <Route path="/admin/loans/:id" element={<ErrorBoundary><AdminLoanDetailPage /></ErrorBoundary>} />
              </Route>

              {/* Admin only — post deposits */}
              <Route element={<AppLayout requiredRoles={['admin']} />}>
                <Route path="/staff/post-deposits" element={<ErrorBoundary><WeeklyPostingPage /></ErrorBoundary>} />
              </Route>

              {/* Admin + Staff — operational */}
              <Route element={<AppLayout requiredRoles={['admin', 'staff']} />}>
                <Route path="/admin/users" element={<ErrorBoundary><UsersPage /></ErrorBoundary>} />
                <Route path="/admin/deposit-requests" element={<ErrorBoundary><AllDepositRequestsPage /></ErrorBoundary>} />
                <Route path="/admin/loan-products" element={<ErrorBoundary><LoanProductsPage /></ErrorBoundary>} />
                <Route path="/admin/savings" element={<ErrorBoundary><AdminSavingsPage /></ErrorBoundary>} />
                <Route path="/admin/savings-withdrawals" element={<ErrorBoundary><SavingsWithdrawalsPage /></ErrorBoundary>} />
                <Route path="/admin/share-transfers" element={<ErrorBoundary><ShareTransfersPage /></ErrorBoundary>} />
                <Route path="/admin/damayan" element={<ErrorBoundary><DamayanAdminPage /></ErrorBoundary>} />
                <Route path="/admin/branches" element={<ErrorBoundary><BranchesPage /></ErrorBoundary>} />
              </Route>

              {/* Admin only — cooperative finance */}
              <Route element={<AppLayout requiredRoles={['admin']} />}>
                <Route path="/admin/dividends" element={<ErrorBoundary><DividendsPage /></ErrorBoundary>} />
                <Route path="/admin/rebates" element={<ErrorBoundary><RebatesPage /></ErrorBoundary>} />
              </Route>

              {/* Admin only */}
              <Route element={<AppLayout requiredRoles={['admin']} />}>
                <Route path="/admin" element={<ErrorBoundary><AdminPage /></ErrorBoundary>} />
                <Route path="/admin/config" element={<ErrorBoundary><ConfigPage /></ErrorBoundary>} />
                <Route path="/admin/settings" element={<ErrorBoundary><AppSettingsPage /></ErrorBoundary>} />
                <Route path="/admin/permissions" element={<ErrorBoundary><PermissionsPage /></ErrorBoundary>} />
                <Route path="/admin/roles" element={<ErrorBoundary><RolesPage /></ErrorBoundary>} />
                <Route path="/admin/users/:id" element={<ErrorBoundary><UserDetailPage /></ErrorBoundary>} />
              </Route>

              {/* Fallback */}
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
