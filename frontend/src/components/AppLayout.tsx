import { NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Users,
  CalendarDays,
  KanbanSquare,
  Inbox,
  MessageCircle,
  Coins,
  Target,
  Link2,
  LayoutTemplate,
  Plug,
  Settings,
  GraduationCap,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "../lib/auth";
import { Button } from "./ui";

const NAV: Array<{ to: string; label: string; icon: LucideIcon }> = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/leads", label: "Leads", icon: Users },
  { to: "/agenda", label: "Agenda", icon: CalendarDays },
  { to: "/kanban", label: "Kanban", icon: KanbanSquare },
  { to: "/inbox", label: "Inbox", icon: Inbox },
  { to: "/whatsapp", label: "WhatsApp", icon: MessageCircle },
  { to: "/billing", label: "Créditos", icon: Coins },
  { to: "/pixel", label: "Mi Pixel", icon: Target },
  { to: "/links", label: "Links", icon: Link2 },
  { to: "/landings", label: "Landings", icon: LayoutTemplate },
  { to: "/integraciones", label: "Integraciones", icon: Plug },
  { to: "/configuracion", label: "Configuración", icon: Settings },
  { to: "/tutoriales", label: "Tutoriales", icon: GraduationCap },
];

export default function AppLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  return (
    <div className="flex h-full min-h-screen">
      <aside className="flex w-56 flex-col border-r border-slate-800 bg-slate-950/60">
        <div className="px-5 py-5">
          <span className="text-lg font-bold">
            Publi<span className="text-wa-green">.lat</span>
          </span>
        </div>
        <nav className="flex flex-1 flex-col gap-1 px-3">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition ${
                  isActive
                    ? "bg-wa-green/15 text-wa-green"
                    : "text-slate-300 hover:bg-slate-800 hover:text-white"
                }`
              }
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-slate-800 p-4 text-xs text-slate-400">
          <div className="truncate font-medium text-slate-200">{user?.email}</div>
          <div className="mb-3 truncate">slug: {user?.slug}</div>
          <Button variant="ghost" className="w-full" onClick={handleLogout}>
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
