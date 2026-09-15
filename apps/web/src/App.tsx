import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { RequireAuth } from './auth/RequireAuth';
import { Layout } from './components/Layout';
import { Login } from './pages/Login';
import { Register } from './pages/Register';
import { TicketsQueue } from './pages/TicketsQueue';
import { TicketDetail } from './pages/TicketDetail';
import { ApiKeys } from './pages/ApiKeys';
import { Assets } from './pages/Assets';
import { Users } from './pages/Users';

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />

        <Route element={<RequireAuth />}>
          <Route element={<Layout />}>
            <Route path="/" element={<Navigate to="/tickets" replace />} />
            <Route path="/tickets" element={<TicketsQueue />} />
            <Route path="/tickets/:id" element={<TicketDetail />} />
            <Route path="/assets" element={<Assets />} />
            <Route path="/api-keys" element={<ApiKeys />} />
            <Route path="/users" element={<Users />} />
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
