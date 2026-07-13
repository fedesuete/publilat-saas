import { Routes, Route, Navigate } from "react-router-dom";
import OnboardingPage from "./pages/OnboardingPage";
import LoginPage from "./pages/LoginPage";
import ChatPage from "./pages/ChatPage";
import { getToken } from "./lib/api";

// El token se lee en el render de CADA ruta, NO en el de App. App no se re-renderiza al navegar
// (el elemento <App/> es la misma referencia dentro de <BrowserRouter>, así que React saltea su
// re-render), pero <Routes> sí monta el componente de la ruta destino. Si guardáramos `authed`
// en App, tras registrar (setToken + navigate a /chat) el guard vería el valor viejo (sin token)
// y rebotaría a /login. Leyéndolo acá, el guard ve el token recién guardado.
function ChatRoute() {
  return getToken() ? <ChatPage /> : <Navigate to="/login" replace />;
}
function IndexRoute() {
  return <Navigate to={getToken() ? "/chat" : "/login"} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/i/:code" element={<OnboardingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/chat" element={<ChatRoute />} />
      <Route path="/" element={<IndexRoute />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
