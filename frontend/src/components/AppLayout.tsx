import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { getSocket, type InboxMessagePayload } from "../lib/socket";
import { io, type Socket } from "socket.io-client";
import { API_BASE } from "../lib/config";
import { api } from "../lib/api";
import NotificationBell from "./NotificationBell";
import {
  LayoutDashboard,
  Users,
  Send,
  CalendarDays,
  KanbanSquare,
  MessageCircle,
  MessagesSquare,
  Workflow,
  Coins,
  Gift,
  Target,
  LayoutTemplate,
  Plug,
  Settings,
  GraduationCap,
  LifeBuoy,
  Shield,
  Menu,
  ChevronDown,
  X,
  Zap,
  Sun,
  Moon,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "../lib/auth";
import { getTheme, toggleTheme, type Theme } from "../lib/theme";
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

// Sonido ESPECIAL (sonido.mp3.mp3, empaquetado como /notif.mp3): suena SOLO cuando llega un comprobante
// (la IA lo lee = un cliente compró). Los mensajes comunes suenan el "ding" simple. Si el navegador
// bloquea el mp3 (autoplay), cae al "cha-ching" de caja.
const receiptAudio = new Audio("/notif.mp3");
receiptAudio.preload = "auto";
function playReceiptSound() {
  try { receiptAudio.currentTime = 0; void receiptAudio.play().catch(() => playCashRegister()); } catch { playCashRegister(); }
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

// Cuentas que ven la sección de Envíos masivos mientras está en prueba (el backend valida lo mismo).
const BULK_EMAILS = ["federicobogado1997@gmail.com"];

// Logo de WhatsApp: lucide no trae íconos de marca, así que va como SVG propio. Usa currentColor
// para heredar el color del menú (verde cuando la sección está activa, gris cuando no).
function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38c1.45.79 3.08 1.21 4.79 1.21h.01c5.46 0 9.91-4.45 9.91-9.91C21.96 6.45 17.5 2 12.04 2zm0 18.02h-.01c-1.52 0-3.01-.41-4.3-1.18l-.31-.18-3.19.84.85-3.11-.2-.32a8.22 8.22 0 0 1-1.26-4.38c0-4.54 3.7-8.23 8.24-8.23 2.2 0 4.27.86 5.82 2.42a8.18 8.18 0 0 1 2.41 5.82c0 4.54-3.7 8.32-8.25 8.32zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.12-.16.25-.64.81-.79.97-.14.17-.29.19-.54.06-.25-.12-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.02-.38.11-.5.11-.11.25-.29.37-.43.13-.15.17-.25.25-.41.08-.17.04-.31-.02-.43-.06-.12-.56-1.34-.76-1.84-.2-.48-.41-.42-.56-.43l-.48-.01c-.17 0-.43.06-.66.31-.23.25-.86.85-.86 2.07 0 1.22.89 2.4 1.01 2.56.12.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.48-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.15-1.18-.06-.1-.22-.17-.47-.29z" />
    </svg>
  );
}

const NAV: Array<{ to: string; label: string; icon: LucideIcon | typeof WhatsAppIcon; id?: string; end?: boolean; onlyFor?: "bulk" }> = [
  { to: "/empezar", label: "Empezá acá", icon: Zap, id: "nav-empezar" },
  { to: "/tutoriales", label: "Tutoriales", icon: GraduationCap, id: "nav-tutoriales" },
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/inbox", label: "Mensajes", icon: WhatsAppIcon },
  { to: "/chat", label: "Chat App", icon: MessagesSquare },
  // Envíos masivos: en prueba, solo para las cuentas de BULK_EMAILS (el backend también lo gatea).
  { to: "/envios", label: "Envíos masivos", icon: Send, onlyFor: "bulk" },
  { to: "/automatizaciones", label: "Automatizaciones", icon: Workflow },
  { to: "/whatsapp", label: "WhatsApp", icon: MessageCircle },
  { to: "/billing", label: "Créditos", icon: Coins },
  { to: "/pixel", label: "Mi Pixel", icon: Target },
  { to: "/landings", label: "Landings", icon: LayoutTemplate },
  { to: "/integraciones", label: "Integraciones", icon: Plug },
  { to: "/configuracion", label: "Configuración", icon: Settings },
  { to: "/soporte", label: "Soporte", icon: LifeBuoy },
];

// Secciones de uso puntual (no del día a día): van juntas en un desplegable para que el menú
// principal quede corto. /links se quitó: no aportaba nada y confundía.
const NAV_CLIENTES: Array<{ to: string; label: string; icon: LucideIcon }> = [
  { to: "/leads", label: "Leads", icon: Users },
  { to: "/kanban", label: "Kanban", icon: KanbanSquare },
  { to: "/agenda", label: "Agenda", icon: CalendarDays },
  { to: "/referidos", label: "Referidos", icon: Gift },
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
  // Ídem para el Chat App (no-leídos del operador en el canal propio).
  const [chatUnread, setChatUnread] = useState(0);
  const chatUnreadTimer = useRef<number | undefined>(undefined);
  // Tema del panel (oscuro por default; el claro es blanco+verde).
  const [theme, setThemeState] = useState<Theme>(() => getTheme());
  const onToggleTheme = () => setThemeState(toggleTheme());
  // Menú lateral en MÓVIL: cajón deslizable (en desktop es fijo, siempre visible).
  const [menuOpen, setMenuOpen] = useState(false);
  // Desplegable "Clientes": arranca abierto si ya estás en una de esas secciones.
  const [clientesOpen, setClientesOpen] = useState(() =>
    ["/leads", "/kanban", "/agenda", "/referidos"].some((p) => window.location.pathname.startsWith(p)),
  );
  // Días de crédito (pie del menú): al abrir y cada 60s. Best-effort: si falla, muestra "—".
  const [days, setDays] = useState<number | null>(null);
  useEffect(() => {
    let vivo = true;
    const traer = () =>
      api.get<{ days: number }>("/api/billing/credit")
        .then(({ data }) => { if (vivo) setDays(data.days); })
        .catch(() => undefined);
    void traer();
    const t = setInterval(traer, 60_000);
    return () => { vivo = false; clearInterval(t); };
  }, []);
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

  const refreshChatUnread = async () => {
    try {
      const { data } = await api.get<{ conversations: Array<{ unread: number }> }>("/api/chat/conversations");
      setChatUnread(data.conversations.reduce((acc, c) => acc + (c.unread || 0), 0));
    } catch {
      /* sin Chat App o red caída: el globito no es crítico */
    }
  };

  // Sonidos + contador de no-leídos, en cualquier pantalla del panel:
  // comprobante (imagen/PDF, un cliente compró) = sonido especial sonido.mp3.mp3; mensaje común = ding.
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
        if (looksLikeReceipt(p.message.mediaUrl)) playReceiptSound();
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

  // Chat App: sonido + contador de no-leídos del operador, en CUALQUIER pantalla del panel.
  // Segundo socket al namespace /chat (cookie del operador), igual que ChatAppPage. Solo suena con
  // mensajes ENTRANTES del jugador (senderType "player") — no el eco de lo que manda el operador/bot.
  useEffect(() => {
    void refreshChatUnread();
    const socket: Socket = io(`${API_BASE}/chat`, { withCredentials: true });
    const onChat = (p: { message?: { senderType?: string; image?: string | null } }) => {
      if (p?.message?.senderType !== "player") return;
      // Comprobante en el Chat App (el jugador manda una imagen = cargó/compró) → sonido especial; texto → ding.
      if (p.message.image) playReceiptSound(); else playPing();
      window.clearTimeout(chatUnreadTimer.current);
      chatUnreadTimer.current = window.setTimeout(() => void refreshChatUnread(), 800);
    };
    socket.on("chat:message", onChat);
    return () => {
      socket.off("chat:message", onChat);
      socket.disconnect();
      window.clearTimeout(chatUnreadTimer.current);
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
          {NAV.filter((item) => item.onlyFor !== "bulk" || BULK_EMAILS.includes((user?.email ?? "").toLowerCase())).map((item) => (
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
              {item.to === "/chat" && chatUnread > 0 && (
                <span className="ml-auto flex h-5 min-w-[20px] items-center justify-center rounded-full bg-wa-green px-1.5 text-[11px] font-bold text-slate-900">
                  {chatUnread > 99 ? "99+" : chatUnread}
                </span>
              )}
            </NavLink>
          ))}

          {/* Desplegable "Clientes": Leads, Kanban, Agenda y Referidos. Se abre solo si estás
              parado en alguna de ellas, así no perdés de vista dónde estás. */}
          <button
            type="button"
            onClick={() => setClientesOpen((v) => !v)}
            className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-slate-300 transition hover:bg-slate-800 hover:text-white"
          >
            <Users className="h-4 w-4 shrink-0" />
            Clientes
            <ChevronDown className={`ml-auto h-4 w-4 shrink-0 transition-transform ${clientesOpen ? "rotate-180" : ""}`} />
          </button>
          {clientesOpen && (
            <div className="flex flex-col gap-1 border-l border-slate-800 pl-3">
              {NAV_CLIENTES.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={() => setMenuOpen(false)}
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
            </div>
          )}

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
          {/* Días disponibles + "Agregar días": lo más importante del pie (si se quedan sin días,
              se les apaga el servicio). Barra sobre 30 días como referencia visual. */}
          <div className="mb-3 rounded-xl border border-slate-800 bg-slate-900/60 p-3">
            <div className="flex items-baseline justify-between">
              <span className="text-[11px] font-medium text-slate-400">Días disponibles</span>
              <span className={`text-lg font-extrabold ${days != null && days <= 3 ? "text-rose-400" : "text-slate-100"}`}>
                {days ?? "—"}
              </span>
            </div>
            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
              <div
                className={`h-full rounded-full transition-[width] duration-500 ${days != null && days <= 3 ? "bg-rose-500" : "bg-wa-green"}`}
                style={{ width: `${Math.min(100, Math.max(days ? 4 : 0, ((days ?? 0) / 30) * 100))}%` }}
              />
            </div>
            <NavLink
              to="/billing"
              onClick={() => setMenuOpen(false)}
              className="mt-2.5 flex items-center justify-center gap-1.5 rounded-lg bg-wa-green px-3 py-2 text-sm font-bold text-slate-900 transition hover:brightness-110"
            >
              + Agregar días
            </NavLink>
          </div>

          {/* Usuario */}
          <div className="mb-2 flex items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-wa-green/20 text-sm font-bold text-wa-green">
              {(user?.name || user?.email || "?").charAt(0).toUpperCase()}
            </span>
            <div className="min-w-0">
              {user?.name && <div className="truncate text-sm font-semibold text-slate-100">{user.name}</div>}
              <div className="truncate text-[11px] text-slate-400">{user?.email}</div>
            </div>
          </div>

          <button
            onClick={onToggleTheme}
            className="mb-2 flex w-full items-center justify-center gap-2 rounded-md border border-slate-700 px-3 py-2 text-sm font-medium text-slate-300 transition hover:bg-slate-800 hover:text-white"
          >
            {theme === "light" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
            {theme === "light" ? "Modo oscuro" : "Modo claro"}
          </button>
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
