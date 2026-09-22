import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AuthProvider } from './auth/AuthContext';
import { RequireAuth } from './auth/RequireAuth';
import { Layout } from './components/Layout';
import { Login } from './pages/Login';
import { Register } from './pages/Register';

// Every route past Login/Register is lazy -- those two are the only pages an
// unauthenticated visitor ever needs, so eagerly bundling the other ~40 pages
// (tickets, CMDB, reporting, AI settings, ...) into the same chunk meant every
// first-time visitor downloaded the whole app before seeing a login form. See
// docs/adr/ for the performance report this fixes: one 518 KB/142 KB-gzip
// chunk, flagged by Vite's own build warning. Route-level code-splitting
// keeps Login/Register light and defers everything else to the moment it's
// actually navigated to.
const Dashboard = lazy(() => import('./pages/Dashboard').then((m) => ({ default: m.Dashboard })));
const TicketsQueue = lazy(() => import('./pages/TicketsQueue').then((m) => ({ default: m.TicketsQueue })));
const TicketDetail = lazy(() => import('./pages/TicketDetail').then((m) => ({ default: m.TicketDetail })));
const ApiKeys = lazy(() => import('./pages/ApiKeys').then((m) => ({ default: m.ApiKeys })));
const Assets = lazy(() => import('./pages/Assets').then((m) => ({ default: m.Assets })));
const Devices = lazy(() => import('./pages/Devices').then((m) => ({ default: m.Devices })));
const AssetDetail = lazy(() => import('./pages/AssetDetail').then((m) => ({ default: m.AssetDetail })));
const Users = lazy(() => import('./pages/Users').then((m) => ({ default: m.Users })));
const Roles = lazy(() => import('./pages/Roles').then((m) => ({ default: m.Roles })));
const EmailChannels = lazy(() => import('./pages/EmailChannels').then((m) => ({ default: m.EmailChannels })));
const CustomFields = lazy(() => import('./pages/CustomFields').then((m) => ({ default: m.CustomFields })));
const EquipmentCatalog = lazy(() => import('./pages/EquipmentCatalog').then((m) => ({ default: m.EquipmentCatalog })));
const Processes = lazy(() => import('./pages/Processes').then((m) => ({ default: m.Processes })));
const ProcessDetail = lazy(() => import('./pages/ProcessDetail').then((m) => ({ default: m.ProcessDetail })));
const ProcessTemplates = lazy(() => import('./pages/ProcessTemplates').then((m) => ({ default: m.ProcessTemplates })));
const Webhooks = lazy(() => import('./pages/Webhooks').then((m) => ({ default: m.Webhooks })));
const Macros = lazy(() => import('./pages/Macros').then((m) => ({ default: m.Macros })));
const SlaPolicies = lazy(() => import('./pages/SlaPolicies').then((m) => ({ default: m.SlaPolicies })));
const BusinessHoursPage = lazy(() => import('./pages/BusinessHoursPage').then((m) => ({ default: m.BusinessHoursPage })));
const Problems = lazy(() => import('./pages/Problems').then((m) => ({ default: m.Problems })));
const ProblemDetail = lazy(() => import('./pages/ProblemDetail').then((m) => ({ default: m.ProblemDetail })));
const ServiceCatalog = lazy(() => import('./pages/ServiceCatalog').then((m) => ({ default: m.ServiceCatalog })));
const Services = lazy(() => import('./pages/Services').then((m) => ({ default: m.Services })));
const KnowledgeBase = lazy(() => import('./pages/KnowledgeBase').then((m) => ({ default: m.KnowledgeBase })));
const OnCall = lazy(() => import('./pages/OnCall').then((m) => ({ default: m.OnCall })));
const NotificationSettings = lazy(() => import('./pages/NotificationSettings').then((m) => ({ default: m.NotificationSettings })));
const AiUsage = lazy(() => import('./pages/AiUsage').then((m) => ({ default: m.AiUsage })));
const AiAgentActivity = lazy(() => import('./pages/AiAgentActivity').then((m) => ({ default: m.AiAgentActivity })));
const AiSettings = lazy(() => import('./pages/AiSettings').then((m) => ({ default: m.AiSettings })));
const MonitoringIntegrations = lazy(() => import('./pages/MonitoringIntegrations').then((m) => ({ default: m.MonitoringIntegrations })));
const ThemeSettings = lazy(() => import('./pages/ThemeSettings').then((m) => ({ default: m.ThemeSettings })));
const BrandingSettings = lazy(() => import('./pages/BrandingSettings').then((m) => ({ default: m.BrandingSettings })));
const TelegramSettings = lazy(() => import('./pages/TelegramSettings').then((m) => ({ default: m.TelegramSettings })));
const DataExport = lazy(() => import('./pages/DataExport').then((m) => ({ default: m.DataExport })));
const TicketStatuses = lazy(() => import('./pages/TicketStatuses').then((m) => ({ default: m.TicketStatuses })));
const PublicKb = lazy(() => import('./pages/PublicKb').then((m) => ({ default: m.PublicKb })));
const PublicKbArticlePage = lazy(() => import('./pages/PublicKbArticle').then((m) => ({ default: m.PublicKbArticlePage })));
const PublicStatus = lazy(() => import('./pages/PublicStatus').then((m) => ({ default: m.PublicStatus })));
const PublicCsat = lazy(() => import('./pages/PublicCsat').then((m) => ({ default: m.PublicCsat })));

function RouteFallback() {
  const { t } = useTranslation();
  return (
    <div className="flex h-full min-h-[50vh] items-center justify-center">
      <p className="text-sm text-slate-400">{t('common.loading')}</p>
    </div>
  );
}

export function App() {
  return (
    <AuthProvider>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/kb/:tenantSlug" element={<PublicKb />} />
          <Route path="/kb/:tenantSlug/:slug" element={<PublicKbArticlePage />} />
          <Route path="/status/:tenantSlug" element={<PublicStatus />} />
          <Route path="/csat/:tenantSlug/:token" element={<PublicCsat />} />

          <Route element={<RequireAuth />}>
            <Route element={<Layout />}>
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/tickets" element={<TicketsQueue />} />
              <Route path="/tickets/:id" element={<TicketDetail />} />
              <Route path="/assets" element={<Assets />} />
              <Route path="/devices" element={<Devices />} />
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
              <Route path="/appearance" element={<ThemeSettings />} />
              <Route path="/branding" element={<BrandingSettings />} />
              <Route path="/telegram" element={<TelegramSettings />} />
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
      </Suspense>
    </AuthProvider>
  );
}
