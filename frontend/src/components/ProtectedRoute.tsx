import { Navigate } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth } from "../lib/auth";

export default function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading && !user) return null; // esperando validar la sesión (cookie) con /me
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}
