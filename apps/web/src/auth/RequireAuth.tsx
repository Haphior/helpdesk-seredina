import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from './AuthContext';

export function RequireAuth() {
  const { payload } = useAuth();
  if (!payload) return <Navigate to="/login" replace />;
  return <Outlet />;
}
