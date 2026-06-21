import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./lib/auth";
import ProtectedRoute from "./components/ProtectedRoute";
import AppLayout from "./components/AppLayout";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import LeadsPage from "./pages/LeadsPage";
import KanbanPage from "./pages/KanbanPage";
import InboxPage from "./pages/InboxPage";
import WhatsappPage from "./pages/WhatsappPage";
import LinksPage from "./pages/LinksPage";
import LandingsPage from "./pages/LandingsPage";
import IntegrationsPage from "./pages/IntegrationsPage";
import BillingPage from "./pages/BillingPage";

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
            <Route path="/kanban" element={<KanbanPage />} />
            <Route path="/inbox" element={<InboxPage />} />
            <Route path="/whatsapp" element={<WhatsappPage />} />
            <Route path="/billing" element={<BillingPage />} />
            <Route path="/links" element={<LinksPage />} />
            <Route path="/landings" element={<LandingsPage />} />
            <Route path="/integraciones" element={<IntegrationsPage />} />
          </Route>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
