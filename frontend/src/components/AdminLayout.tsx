import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { LayoutDashboard, Users, Phone, DollarSign, Gift, LifeBuoy, Download, ArrowLeft, type LucideIcon } from "lucide-react";
import { useAuth } from "../lib/auth";
import { Button } from "./ui";

const NAV: Array<{ to: string; label: string; icon: LucideIcon; end?: boolean }> = [
  { to: "/admin", label: "Resumen", icon: LayoutDashboard, end: true },
  { to: "/admin/clientes", label: "Clientes", icon: Users },
  { to: "/admin/lineas", label: "Líneas", icon: Phone },
  { to: "/admin/ingresos", label: "Ingresos", icon: DollarSign },
  { to: "/admin/demos", label: "Demos", icon: Gift },
  { to: "/admin/soporte", label: "Soporte", icon: LifeBuoy },
  { to: "/admin/exportar", label: "Exportar", icon: Download },
];

export default function AdminLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="flex h-full min-h-screen">
      <aside className="flex w-56 flex-col border-r border-slate-800 bg-slate-950/60">
        <div className="px-5 py-5">
          <span className="text-lg font-bold">
            Publi<span className="text-wa-green">.lat</span>
          </span>
          <div className="mt-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-400">Admin</div>
        </div>
        <nav className="flex flex-1 flex-col gap-1 px-3">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition ${
                  isActive ? "bg-wa-green/15 text-wa-green" : "text-slate-300 hover:bg-slate-800 hover:text-white"
                }`
              }
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-slate-800 p-4 text-xs text-slate-400">
          <button
            onClick={() => navigate("/dashboard")}
            className="mb-3 flex items-center gap-2 text-slate-300 hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" /> Volver al panel
          </button>
          <div className="truncate font-medium text-slate-200">{user?.email}</div>
          <Button variant="ghost" className="mt-2 w-full" onClick={() => { logout(); navigate("/login"); }}>
            Cerrar sesión
          </Button>
        </div>
      </aside>
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
