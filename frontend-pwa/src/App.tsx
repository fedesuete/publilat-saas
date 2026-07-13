import { Routes, Route, Navigate } from "react-router-dom";
import OnboardingPage from "./pages/OnboardingPage";
import LoginPage from "./pages/LoginPage";
import ChatPage from "./pages/ChatPage";
import { getToken } from "./lib/api";

export default function App() {
  const authed = !!getToken();
  return (
    <Routes>
      <Route path="/i/:code" element={<OnboardingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/chat" element={authed ? <ChatPage /> : <Navigate to="/login" replace />} />
      <Route path="/" element={<Navigate to={authed ? "/chat" : "/login"} replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
