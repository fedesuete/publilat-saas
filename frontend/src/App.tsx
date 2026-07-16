import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./lib/auth";
import ProtectedRoute from "./components/ProtectedRoute";
import AppLayout from "./components/AppLayout";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import LeadsPage from "./pages/LeadsPage";
import KanbanPage from "./pages/KanbanPage";
import InboxPage from "./pages/InboxPage";
import ChatAppPage from "./pages/ChatAppPage";
import WhatsappPage from "./pages/WhatsappPage";
import LinksPage from "./pages/LinksPage";
import LandingsPage from "./pages/LandingsPage";
import IntegrationsPage from "./pages/IntegrationsPage";
import BillingPage from "./pages/BillingPage";
import PixelPage from "./pages/PixelPage";
import AgendaPage from "./pages/AgendaPage";
import SetupPage from "./pages/SetupPage";
import TutorialesPage from "./pages/TutorialesPage";
import SupportPage from "./pages/SupportPage";
import AutomationsPage from "./pages/AutomationsPage";
import ProtectedAdminRoute from "./components/ProtectedAdminRoute";
import AdminLayout from "./components/AdminLayout";
import AdminOverview from "./pages/admin/AdminOverview";
import AdminClients from "./pages/admin/AdminClients";
import AdminLines from "./pages/admin/AdminLines";
import AdminLandings from "./pages/admin/AdminLandings";
import AdminRevenue from "./pages/admin/AdminRevenue";
import AdminDemos from "./pages/admin/AdminDemos";
import AdminTutorials from "./pages/admin/AdminTutorials";
import AdminSupport from "./pages/admin/AdminSupport";
import AdminExport from "./pages/admin/AdminExport";

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            element={
              <ProtectedRoute>
                <AppLayout />
              </ProtectedRoute>
            }
          >
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/leads" element={<LeadsPage />} />
            <Route path="/agenda" element={<AgendaPage />} />
            <Route path="/kanban" element={<KanbanPage />} />
            <Route path="/inbox" element={<InboxPage />} />
            <Route path="/chat" element={<ChatAppPage />} />
            <Route path="/automatizaciones" element={<AutomationsPage />} />
            <Route path="/whatsapp" element={<WhatsappPage />} />
            <Route path="/billing" element={<BillingPage />} />
            <Route path="/pixel" element={<PixelPage />} />
            <Route path="/links" element={<LinksPage />} />
            <Route path="/landings" element={<LandingsPage />} />
            <Route path="/integraciones" element={<IntegrationsPage />} />
            <Route path="/configuracion" element={<SetupPage />} />
            <Route path="/tutoriales" element={<TutorialesPage />} />
            <Route path="/soporte" element={<SupportPage />} />
          </Route>
          {/* Panel maestro (admin-only) */}
          <Route
            element={
              <ProtectedAdminRoute>
                <AdminLayout />
              </ProtectedAdminRoute>
            }
          >
            <Route path="/admin" element={<AdminOverview />} />
            <Route path="/admin/clientes" element={<AdminClients />} />
            <Route path="/admin/lineas" element={<AdminLines />} />
            <Route path="/admin/landings" element={<AdminLandings />} />
            <Route path="/admin/ingresos" element={<AdminRevenue />} />
            <Route path="/admin/demos" element={<AdminDemos />} />
            <Route path="/admin/tutoriales" element={<AdminTutorials />} />
            <Route path="/admin/soporte" element={<AdminSupport />} />
            <Route path="/admin/exportar" element={<AdminExport />} />
          </Route>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
