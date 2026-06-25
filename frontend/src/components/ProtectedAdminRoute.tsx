import { Navigate } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth } from "../lib/auth";

// Sólo ADMIN. Si no hay sesión -> login; si es USER -> dashboard.
export default function ProtectedAdminRoute({ children }: { children: ReactNode }) {
  const { token, user } = useAuth();
  if (!token) return <Navigate to="/login" replace />;
  if (user && user.role !== "ADMIN") return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}
