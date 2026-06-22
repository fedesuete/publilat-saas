import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { Button } from "./ui";

const NAV = [
  { to: "/dashboard", label: "Dashboard" },
  { to: "/leads", label: "Leads" },
  { to: "/agenda", label: "Agenda" },
  { to: "/kanban", label: "Kanban" },
  { to: "/inbox", label: "Inbox" },
  { to: "/whatsapp", label: "WhatsApp" },
  { to: "/billing", label: "Créditos" },
  { to: "/pixel", label: "Mi Pixel" },
  { to: "/links", label: "Links" },
  { to: "/landings", label: "Landings" },
  { to: "/integraciones", label: "Integraciones" },
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
                `rounded-md px-3 py-2 text-sm font-medium transition ${
                  isActive
                    ? "bg-wa-green/15 text-wa-green"
                    : "text-slate-300 hover:bg-slate-800 hover:text-white"
                }`
              }
            >
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
