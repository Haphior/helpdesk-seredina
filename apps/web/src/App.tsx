import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { RequireAuth } from './auth/RequireAuth';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { Login } from './pages/Login';
import { Register } from './pages/Register';
import { TicketsQueue } from './pages/TicketsQueue';
import { TicketDetail } from './pages/TicketDetail';
import { ApiKeys } from './pages/ApiKeys';
import { Assets } from './pages/Assets';
import { Users } from './pages/Users';
import { EmailChannels } from './pages/EmailChannels';
import { CustomFields } from './pages/CustomFields';
import { EquipmentCatalog } from './pages/EquipmentCatalog';
import { Processes } from './pages/Processes';
import { ProcessDetail } from './pages/ProcessDetail';
import { ProcessTemplates } from './pages/ProcessTemplates';
import { Webhooks } from './pages/Webhooks';
import { Macros } from './pages/Macros';
import { SlaPolicies } from './pages/SlaPolicies';
import { BusinessHoursPage } from './pages/BusinessHoursPage';

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />

        <Route element={<RequireAuth />}>
          <Route element={<Layout />}>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/tickets" element={<TicketsQueue />} />
            <Route path="/tickets/:id" element={<TicketDetail />} />
            <Route path="/assets" element={<Assets />} />
            <Route path="/api-keys" element={<ApiKeys />} />
            <Route path="/users" element={<Users />} />
            <Route path="/email-channels" element={<EmailChannels />} />
            <Route path="/custom-fields" element={<CustomFields />} />
            <Route path="/equipment-catalog" element={<EquipmentCatalog />} />
            <Route path="/processes" element={<Processes />} />
            <Route path="/processes/:id" element={<ProcessDetail />} />
            <Route path="/process-templates" element={<ProcessTemplates />} />
            <Route path="/webhooks" element={<Webhooks />} />
            <Route path="/macros" element={<Macros />} />
            <Route path="/sla-policies" element={<SlaPolicies />} />
            <Route path="/business-hours" element={<BusinessHoursPage />} />
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
