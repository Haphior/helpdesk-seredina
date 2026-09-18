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
import { AssetDetail } from './pages/AssetDetail';
import { Users } from './pages/Users';
import { Roles } from './pages/Roles';
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
import { Problems } from './pages/Problems';
import { ProblemDetail } from './pages/ProblemDetail';
import { ServiceCatalog } from './pages/ServiceCatalog';
import { Services } from './pages/Services';
import { KnowledgeBase } from './pages/KnowledgeBase';
import { OnCall } from './pages/OnCall';
import { NotificationSettings } from './pages/NotificationSettings';
import { AiUsage } from './pages/AiUsage';
import { AiAgentActivity } from './pages/AiAgentActivity';
import { AiSettings } from './pages/AiSettings';
import { MonitoringIntegrations } from './pages/MonitoringIntegrations';
import { DataExport } from './pages/DataExport';
import { TicketStatuses } from './pages/TicketStatuses';
import { PublicKb } from './pages/PublicKb';
import { PublicKbArticlePage } from './pages/PublicKbArticle';
import { PublicStatus } from './pages/PublicStatus';

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/kb/:tenantSlug" element={<PublicKb />} />
        <Route path="/kb/:tenantSlug/:slug" element={<PublicKbArticlePage />} />
        <Route path="/status/:tenantSlug" element={<PublicStatus />} />

        <Route element={<RequireAuth />}>
          <Route element={<Layout />}>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/tickets" element={<TicketsQueue />} />
            <Route path="/tickets/:id" element={<TicketDetail />} />
            <Route path="/assets" element={<Assets />} />
            <Route path="/assets/:id" element={<AssetDetail />} />
            <Route path="/api-keys" element={<ApiKeys />} />
            <Route path="/users" element={<Users />} />
            <Route path="/roles" element={<Roles />} />
            <Route path="/email-channels" element={<EmailChannels />} />
            <Route path="/custom-fields" element={<CustomFields />} />
            <Route path="/equipment-catalog" element={<EquipmentCatalog />} />
            <Route path="/processes" element={<Processes />} />
            <Route path="/processes/:id" element={<ProcessDetail />} />
            <Route path="/process-templates" element={<ProcessTemplates />} />
            <Route path="/problems" element={<Problems />} />
            <Route path="/problems/:id" element={<ProblemDetail />} />
            <Route path="/service-catalog" element={<ServiceCatalog />} />
            <Route path="/services" element={<Services />} />
            <Route path="/knowledge-base" element={<KnowledgeBase />} />
            <Route path="/on-call" element={<OnCall />} />
            <Route path="/notification-settings" element={<NotificationSettings />} />
            <Route path="/ai-usage" element={<AiUsage />} />
            <Route path="/ai-agent-activity" element={<AiAgentActivity />} />
            <Route path="/ai-settings" element={<AiSettings />} />
            <Route path="/monitoring-integrations" element={<MonitoringIntegrations />} />
            <Route path="/data-export" element={<DataExport />} />
            <Route path="/ticket-statuses" element={<TicketStatuses />} />
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
