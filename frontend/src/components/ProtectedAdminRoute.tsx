import { Navigate } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth } from "../lib/auth";

// Sólo ADMIN. Si no hay sesión -> login; si es USER -> dashboard.
export default function ProtectedAdminRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading && !user) return null; // esperando validar la sesión (cookie) con /me
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "ADMIN") return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}
