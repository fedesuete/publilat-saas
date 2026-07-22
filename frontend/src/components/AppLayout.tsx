import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { getSocket, type InboxMessagePayload } from "../lib/socket";
import { api } from "../lib/api";
import NotificationBell from "./NotificationBell";
import {
  LayoutDashboard,
  Users,
  CalendarDays,
  KanbanSquare,
  Inbox,
  MessageCircle,
  MessagesSquare,
  Workflow,
  Coins,
  Target,
  Link2,
  LayoutTemplate,
  Plug,
  Settings,
  GraduationCap,
  LifeBuoy,
  Shield,
  Menu,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "../lib/auth";
import { Button } from "./ui";
import SupportBubble from "./SupportBubble";
import OnboardingTour, { type TourStep } from "./OnboardingTour";
import InstallPWA from "./InstallPWA";
import UpdatePrompt from "./UpdatePrompt";

// Sonidos de notificación (Web Audio, sin archivos externos).
let audioCtx: AudioContext | null = null;
function ensureCtx(): AudioContext | null {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    audioCtx = audioCtx ?? new AC();
    if (audioCtx.state === "suspended") void audioCtx.resume();
    return audioCtx;
  } catch {
    return null; // si el navegador bloquea el audio, no rompemos nada
  }
}

// "Ding" simple: mensaje entrante común.
function playPing() {
  const ctx = ensureCtx();
  if (!ctx) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.connect(g); g.connect(ctx.destination);
  o.type = "sine";
  o.frequency.setValueAtTime(880, t);
  o.frequency.setValueAtTime(1175, t + 0.12);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.35, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
  o.start(t);
  o.stop(t + 0.34);
}

// "Cha-ching" de caja registradora 💰: cuando entra una imagen/PDF (comprobante de pago).
function playCashRegister() {
  const ctx = ensureCtx();
  if (!ctx) return;
  const t0 = ctx.currentTime;
  // Campanilla doble (el "cha-ching")
  const bell: Array<[number, number]> = [[1319, 0], [1760, 0.08]];
  for (const [freq, delay] of bell) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.type = "triangle";
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t0 + delay);
    g.gain.exponentialRampToValueAtTime(0.4, t0 + delay + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + delay + 0.28);
    o.start(t0 + delay);
    o.stop(t0 + delay + 0.3);
  }
  // Tintineo de monedas cayendo
  const coins = [2637, 3135, 2794, 3520];
  coins.forEach((freq, i) => {
    const delay = 0.18 + i * 0.06;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.type = "sine";
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t0 + delay);
    g.gain.exponentialRampToValueAtTime(0.18, t0 + delay + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + delay + 0.14);
    o.start(t0 + delay);
    o.stop(t0 + delay + 0.16);
  });
}

// ¿El mensaje entrante parece un comprobante? (imagen o PDF adjunto)
function looksLikeReceipt(mediaUrl: string | null | undefined): boolean {
  if (!mediaUrl) return false;
  return mediaUrl.startsWith("data:image") || mediaUrl.startsWith("data:application/pdf");
}

const NAV: Array<{ to: string; label: string; icon: LucideIcon; id?: string; end?: boolean }> = [
  { to: "/empezar", label: "Empezá acá", icon: Zap, id: "nav-empezar" },
  { to: "/tutoriales", label: "Tutoriales", icon: GraduationCap, id: "nav-tutoriales" },
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/leads", label: "Leads", icon: Users },
  { to: "/agenda", label: "Agenda", icon: CalendarDays },
  { to: "/kanban", label: "Kanban", icon: KanbanSquare },
  { to: "/inbox", label: "Inbox", icon: Inbox },
  { to: "/chat", label: "Chat App", icon: MessagesSquare },
  { to: "/automatizaciones", label: "Automatizaciones", icon: Workflow },
  { to: "/whatsapp", label: "WhatsApp", icon: MessageCircle },
  { to: "/billing", label: "Créditos", icon: Coins },
  { to: "/pixel", label: "Mi Pixel", icon: Target },
  { to: "/links", label: "Links", icon: Link2 },
  { to: "/landings", label: "Landings", icon: LayoutTemplate },
  { to: "/integraciones", label: "Integraciones", icon: Plug },
  { to: "/configuracion", label: "Configuración", icon: Settings },
  { to: "/soporte", label: "Soporte", icon: LifeBuoy },
];

// Pasos del recorrido guiado de bienvenida (se dispara al crear la cuenta).
const TOUR_STEPS: TourStep[] = [
  { targetId: "nav-empezar", title: "Empezá acá 🚀", body: "Tu punto de partida. Acá tenés los pasos para dejar tu cuenta lista y vendiendo. Volvé cuando quieras." },
  { targetId: "nav-tutoriales", title: "Tutoriales 🎓", body: "Videos y guías paso a paso de cada sección. Si te trabás en algo, mirá acá primero." },
  { targetId: "support-bubble", title: "Soporte por WhatsApp 💬", body: "¿Tenés una duda? Tocá este globo y nos escribís directo por WhatsApp. Te ayudamos al toque." },
];

export default function AppLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  // Total de mensajes sin leer (para el globito del menú Inbox).
  const [unread, setUnread] = useState(0);
  const unreadTimer = useRef<number | undefined>(undefined);
  // Menú lateral en MÓVIL: cajón deslizable (en desktop es fijo, siempre visible).
  const [menuOpen, setMenuOpen] = useState(false);
  // Recorrido guiado de bienvenida (se dispara al crear la cuenta o desde "Empezá acá").
  const [tour, setTour] = useState(false);

  useEffect(() => {
    const start = () => { setMenuOpen(true); setTour(true); };
    // Recién registrado: LoginPage dejó la marca. Pequeño delay para que monte el layout.
    let t: number | undefined;
    if (localStorage.getItem("pl_start_tour") === "1") {
      localStorage.removeItem("pl_start_tour");
      t = window.setTimeout(start, 500);
    }
    window.addEventListener("pl:start-tour", start); // botón manual "Ver el recorrido"
    return () => { window.removeEventListener("pl:start-tour", start); if (t) clearTimeout(t); };
  }, []);

  const closeTour = () => { setTour(false); setMenuOpen(false); };

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const refreshUnread = async () => {
    try {
      const { data } = await api.get<{ conversations: Array<{ unread: number }> }>("/api/inbox/conversations");
      setUnread(data.conversations.reduce((acc, c) => acc + (c.unread || 0), 0));
    } catch {
      /* sin permisos o red caída: el globito no es crítico */
    }
  };

  // Sonidos + contador de no-leídos, en cualquier pantalla del panel:
  // comprobante (imagen/PDF) = caja registradora 💰; mensaje común = ding.
  useEffect(() => {
    void refreshUnread();
    // Chrome bloquea el audio hasta el primer gesto del usuario: desbloqueamos el
    // AudioContext con el primer click/tap en el panel, así los sonidos que disparan
    // los sockets (sin gesto) ya salen con volumen.
    const unlockAudio = () => {
      ensureCtx();
      window.removeEventListener("pointerdown", unlockAudio);
      window.removeEventListener("keydown", unlockAudio);
    };
    window.addEventListener("pointerdown", unlockAudio);
    window.addEventListener("keydown", unlockAudio);
    const socket = getSocket();
    const onMsg = (p: InboxMessagePayload) => {
      if (p.message?.direction === "in") {
        if (looksLikeReceipt(p.message.mediaUrl)) playCashRegister();
        else playPing();
      }
      // Refresca el contador con un pequeño debounce (los mensajes vienen en ráfaga).
      window.clearTimeout(unreadTimer.current);
      unreadTimer.current = window.setTimeout(() => void refreshUnread(), 800);
    };
    socket.on("inbox:message", onMsg);
    return () => {
      socket.off("inbox:message", onMsg);
      window.clearTimeout(unreadTimer.current);
      window.removeEventListener("pointerdown", unlockAudio);
      window.removeEventListener("keydown", unlockAudio);
    };
  }, []);

  return (
    // Layout fijo al viewport: la ventana NUNCA scrollea; cada columna (menú, lista de
    // chats, mensajes) scrollea por su cuenta. Así el chat ocupa la pantalla justa.
    <div className="flex h-screen overflow-hidden">
      {/* Fondo oscuro detrás del cajón (sólo móvil, con el menú abierto). */}
      {menuOpen && (
        <div onClick={() => setMenuOpen(false)} className="fixed inset-0 z-30 bg-black/50 lg:hidden" aria-hidden="true" />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col border-r border-slate-800 bg-slate-950 transition-transform duration-200 lg:static lg:z-auto lg:w-56 lg:translate-x-0 lg:bg-slate-950/60 ${
          menuOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between px-5 py-5">
          <span className="text-lg font-bold">
            Publi<span className="text-wa-green">.lat</span>
          </span>
          <div className="flex items-center gap-1">
            <NotificationBell />
            {/* Cerrar el cajón (sólo móvil). */}
            <button onClick={() => setMenuOpen(false)} className="rounded p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white lg:hidden" aria-label="Cerrar menú">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              id={item.id}
              onClick={() => setMenuOpen(false)}
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
              {item.to === "/inbox" && unread > 0 && (
                <span className="ml-auto flex h-5 min-w-[20px] items-center justify-center rounded-full bg-wa-green px-1.5 text-[11px] font-bold text-slate-900">
                  {unread > 99 ? "99+" : unread}
                </span>
              )}
            </NavLink>
          ))}
          {user?.role === "ADMIN" && (
            <NavLink
              to="/admin"
              onClick={() => setMenuOpen(false)}
              className="mt-1 flex items-center gap-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm font-semibold text-amber-300 transition hover:bg-amber-500/20"
            >
              <Shield className="h-4 w-4 shrink-0" />
              Admin
            </NavLink>
          )}
        </nav>
        <InstallPWA />
        <div className="border-t border-slate-800 p-4 text-xs text-slate-400">
          <div className="truncate font-medium text-slate-200">{user?.email}</div>
          <div className="mb-3 truncate">slug: {user?.slug}</div>
          <Button variant="ghost" className="w-full" onClick={handleLogout}>
            Cerrar sesión
          </Button>
          <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
            <a href="https://publi.lat/privacidad" target="_blank" rel="noopener noreferrer" className="hover:text-slate-300">Privacidad</a>
            <a href="https://publi.lat/terminos" target="_blank" rel="noopener noreferrer" className="hover:text-slate-300">Términos</a>
            <a href="https://publi.lat/eliminacion-datos" target="_blank" rel="noopener noreferrer" className="hover:text-slate-300">Eliminación de datos</a>
          </div>
        </div>
      </aside>
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Barra superior sólo en MÓVIL: botón de menú + marca + campana. */}
        <header className="flex items-center gap-3 border-b border-slate-800 px-4 py-3 lg:hidden">
          <button onClick={() => setMenuOpen(true)} className="rounded p-1.5 text-slate-300 hover:bg-slate-800 hover:text-white" aria-label="Abrir menú">
            <Menu className="h-6 w-6" />
          </button>
          <span className="text-lg font-bold">
            Publi<span className="text-wa-green">.lat</span>
          </span>
          <div className="ml-auto flex items-center gap-1">
            {unread > 0 && (
              <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-wa-green px-1.5 text-[11px] font-bold text-slate-900">
                {unread > 99 ? "99+" : unread}
              </span>
            )}
            <NotificationBell />
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>

      {/* Aviso de versión nueva del panel (se actualiza sin borrar cache). */}
      <UpdatePrompt />

      {/* Globo de soporte por WhatsApp (siempre visible, salvo en el Inbox). */}
      <SupportBubble />

      {/* Recorrido guiado de bienvenida. */}
      {tour && <OnboardingTour steps={TOUR_STEPS} onClose={closeTour} />}
    </div>
  );
}
