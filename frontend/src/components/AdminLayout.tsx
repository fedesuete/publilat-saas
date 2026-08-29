import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { LayoutDashboard, Users, UserPlus, Phone, Network, Gauge, Activity, LayoutTemplate, DollarSign, Gift, HandCoins, LifeBuoy, Download, GraduationCap, ArrowLeft, Menu, X, type LucideIcon } from "lucide-react";
import { useAuth } from "../lib/auth";
import { Button } from "./ui";
import InstallPWA from "./InstallPWA";

const NAV: Array<{ to: string; label: string; icon: LucideIcon; end?: boolean }> = [
  { to: "/admin", label: "Resumen", icon: LayoutDashboard, end: true },
  { to: "/admin/clientes", label: "Clientes", icon: Users },
  { to: "/admin/alta", label: "Alta de cliente", icon: UserPlus },
  { to: "/admin/lineas", label: "Líneas", icon: Phone },
  { to: "/admin/proxies", label: "Proxies", icon: Network },
  { to: "/admin/proxy-health", label: "Estabilidad", icon: Gauge },
  { to: "/admin/metricas", label: "Métricas", icon: Activity },
  { to: "/admin/landings", label: "Landings", icon: LayoutTemplate },
  { to: "/admin/ingresos", label: "Ingresos", icon: DollarSign },
  { to: "/admin/referidos", label: "Referidos", icon: HandCoins },
  { to: "/admin/demos", label: "Demos", icon: Gift },
  { to: "/admin/tutoriales", label: "Tutoriales", icon: GraduationCap },
  { to: "/admin/soporte", label: "Soporte", icon: LifeBuoy },
  { to: "/admin/exportar", label: "Exportar", icon: Download },
];

export default function AdminLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false); // drawer móvil

  return (
    <div className="flex h-full min-h-screen">
      {/* Fondo oscuro al abrir el menú en móvil */}
      {open && <div className="fixed inset-0 z-30 bg-black/50 md:hidden" onClick={() => setOpen(false)} aria-hidden />}

      {/* Sidebar: drawer deslizable en móvil, fijo en desktop */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 max-w-[82%] flex-col border-r border-slate-800 bg-slate-950 transition-transform duration-200 md:static md:z-auto md:w-56 md:max-w-none md:translate-x-0 md:bg-slate-950/60 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between px-5 py-5">
          <div>
            <span className="text-lg font-bold">
              Publi<span className="text-wa-green">.lat</span>
            </span>
            <div className="mt-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-400">Admin</div>
          </div>
          <button onClick={() => setOpen(false)} className="rounded-md p-1 text-slate-400 hover:bg-slate-800 md:hidden" aria-label="Cerrar menú">
            <X className="h-5 w-5" />
          </button>
        </div>
        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition ${
                  isActive ? "bg-wa-green/15 text-wa-green" : "text-slate-300 hover:bg-slate-800 hover:text-white"
                }`
              }
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <InstallPWA />
        <div className="border-t border-slate-800 p-4 text-xs text-slate-400">
          <button
            onClick={() => { setOpen(false); navigate("/dashboard"); }}
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

      {/* Columna de contenido */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Barra superior con hamburguesa (solo móvil) */}
        <header className="flex items-center gap-3 border-b border-slate-800 bg-slate-950/70 px-4 py-3 md:hidden">
          <button onClick={() => setOpen(true)} className="rounded-md p-1.5 text-slate-200 hover:bg-slate-800" aria-label="Abrir menú">
            <Menu className="h-6 w-6" />
          </button>
          <span className="text-base font-bold">
            Publi<span className="text-wa-green">.lat</span>
          </span>
          <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-400">Admin</span>
        </header>
        <main className="min-w-0 flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
