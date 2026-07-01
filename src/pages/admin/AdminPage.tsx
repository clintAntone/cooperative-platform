import { Navigate } from 'react-router-dom'

// Redirect /admin to /admin/config
export function AdminPage() {
  return <Navigate to="/admin/config" replace />
}
