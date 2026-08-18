import { useEffect, useRef, useState, type FormEvent, type ChangeEvent } from "react";
import { io, type Socket } from "socket.io-client";
import { api, apiError, API_BASE, getToken, clearToken, loadBranding, saveBranding, applyBranding, type Branding } from "../lib/api";
import { subscribeToPush, pushSupported, pushPermission } from "../lib/push";
import InstallPrompt, { InstallGuide, AndroidInstallGuide } from "../components/InstallPrompt";
import PushPrompt from "../components/PushPrompt";
import { promptInstall, onInstallAvailable, bakeSessionIntoUrl, pointManifestToSession, isStandalone, isIos, waitForInstallPrompt } from "../lib/install";

interface Pay { cbu: string | null; alias: string | null; titular: string | null }
interface Msg { id: string; senderType: "player" | "operator" | "system"; body: string | null; image?: string | null; buttons?: string[] | null; link?: { label: string; url: string } | null; copy?: { label: string; value: string } | null; pay?: Pay | null; install?: boolean; createdAt: string }
interface Popup { title?: string | null; text?: string | null; image?: string | null; link?: string | null; version: string }
interface Wallet { balance: number; minDeposit: number; minWithdrawal: number; paymentInfo: string | null; pay?: { cbu: string | null; alias: string | null; titular: string | null } }
const POPUP_SEEN_KEY = "publilat_popup_seen";

function appendUnique(list: Msg[], m: Msg): Msg[] {
  return list.some((x) => x.id === m.id) ? list : [...list, m];
}

export default function ChatPage() {
  // Marca desde localStorage, pero la REFRESCAMOS del server al abrir para tomar cambios del
  // operador (tema/logo/colores) sin re-registrarse.
  const [branding, setBranding] = useState(loadBranding());
  // Si el logo no carga (asset viejo/borrado/cache corrupto), mostramos el fallback limpio en vez del
  // ícono roto. Se resetea cuando llega branding fresco del server (logo nuevo).
  const [logoBroken, setLogoBroken] = useState(false);
  useEffect(() => {
    // Fallback al slug de sesión: en la app instalada (storage aislado) loadBranding() puede venir
    // vacío, pero recoverSession dejó el slug de la cuenta → igual traemos y aplicamos la marca.
    const slug = branding?.accountSlug || localStorage.getItem("publilat_session_slug") || undefined;
    if (!slug) return;
    api.get<{ branding: Branding }>(`/api/chat/public/${slug}`)
      .then(({ data }) => { if (data?.branding) { applyBranding(data.branding); saveBranding(slug, data.branding); setBranding({ accountSlug: slug, ...data.branding }); setLogoBroken(false); } })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [push, setPush] = useState<NotificationPermission | "unsupported">(pushPermission());
  const [pushBusy, setPushBusy] = useState(false);
  const [popup, setPopup] = useState<Popup | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // --- Cajero (Fase E3): saldo + cargar/retirar ---
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [cashier, setCashier] = useState<"deposit" | "withdrawal" | null>(null);
  const [amount, setAmount] = useState("");
  const [destino, setDestino] = useState("");
  const [comprobante, setComprobante] = useState<string | null>(null);
  const [cashBusy, setCashBusy] = useState(false);
  const [cashMsg, setCashMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Instalación (botón "INSTALAR APP" en mensajes) + clip para adjuntar imagen.
  const [canInstall, setCanInstall] = useState(false);
  const [guide, setGuide] = useState<"ios" | "android" | null>(null); // qué guía de instalación mostrar
  const [chatImage, setChatImage] = useState<string | null>(null);
  useEffect(() => onInstallAvailable(setCanInstall), []);
  useEffect(() => { pointManifestToSession(); }, []); // manifest por sesión -> instalar en iPhone abre logueado
  // Instalar: en Android/Chrome usamos el INSTALADOR NATIVO (un tap, como quiere el negocio). Si el
  // beforeinstallprompt todavía no llegó, esperamos un instante a que aparezca antes de rendirnos. Solo
  // si de verdad no hay prompt nativo mostramos la guía manual (iPhone: Compartir→Agregar; Android: menú ⋮).
  const doInstall = async () => {
    if (canInstall || (!isIos() && (await waitForInstallPrompt(1800)))) { void promptInstall(); return; }
    bakeSessionIntoUrl();
    setGuide(isIos() ? "ios" : "android");
  };
  // Banner de instalar en modo bare (redblack): estilo WhatsApp, arriba del chat. Se cierra y no vuelve.
  const [installHidden, setInstallHidden] = useState(() => localStorage.getItem("publilat_install_hidden") === "1");
  const dismissInstall = () => { localStorage.setItem("publilat_install_hidden", "1"); setInstallHidden(true); };
  const money = (n: number) => "$" + n.toLocaleString("es-AR");
  const copy = async (label: string, value: string) => {
    try { await navigator.clipboard.writeText(value); setCopied(label); setTimeout(() => setCopied(null), 1500); } catch { /* algunos webviews bloquean */ }
  };

  const loadWallet = () =>
    api.get<Wallet>("/api/chat/me/wallet").then(({ data }) => setWallet(data)).catch(() => undefined);
  useEffect(() => { void loadWallet(); }, []);

  // Trae la conversación con un GET fresco. Se usa al montar Y para re-sincronizar cuando el jugador
  // vuelve de la app del banco (la PWA estuvo en segundo plano y el socket se durmió: los mensajes que
  // el server emitió en vivo — ej. "✅ Carga acreditada" del callback — no llegaron y hay que traerlos).
  const loadMessages = () =>
    api.get<{ messages: Msg[] }>("/api/chat/me/conversation")
      .then(({ data }) => setMessages(data.messages))
      .catch((e) => {
        if ((e as { response?: { status?: number } })?.response?.status === 401) { clearToken(); location.href = "/login"; return; }
        setError(apiError(e));
      });

  const onComprobante = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    const r = new FileReader(); r.onload = () => setComprobante(r.result as string); r.readAsDataURL(f);
  };
  const submitDeposit = async () => {
    const amt = parseInt(amount.replace(/\D/g, ""), 10);
    // El monto es OPCIONAL: alcanza con subir el comprobante (el server lee el monto con IA). Sin monto
    // y sin comprobante no hay nada que mandar.
    if (!amt && !comprobante) { setCashMsg("Subí el comprobante (o poné el monto)."); return; }
    setCashBusy(true); setCashMsg(null);
    try {
      await api.post("/api/chat/me/deposit", { amount: amt || undefined, method: "Transferencia", comprobante: comprobante || undefined });
      // El card de datos QUEDA en el chat (no se achica). El backend deja el mensaje "🧾 Registraste una carga…".
      setAmount(""); setComprobante(null); setCashMsg(null);
      void loadWallet();
    } catch (e) { setCashMsg(apiError(e)); } finally { setCashBusy(false); }
  };
  // CARGAR: deja los datos de pago como MENSAJE en la conversación (persiste, estilo mensajería) y abre el form.
  const openDeposit = async () => {
    setCashier(null); setCashMsg(null); setAmount(""); setComprobante(null);
    try {
      const { data } = await api.post<{ message: Msg }>("/api/chat/me/deposit/help");
      setMessages((prev) => appendUnique(prev, data.message));
    } catch { /* si falla igual queda el form en el último mensaje de datos */ }
    setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), 90);
  };
  const submitWithdrawal = async () => {
    const amt = parseInt(amount.replace(/\D/g, ""), 10);
    if (!amt || !destino.trim()) { setCashMsg("Completá monto y CBU/alias."); return; }
    setCashBusy(true); setCashMsg(null);
    try {
      await api.post("/api/chat/me/withdrawal", { amount: amt, destino: destino.trim() });
      setCashier(null); setAmount(""); setDestino(""); setCashMsg(null); // el chat deja "🏧 Pediste un retiro…"
      void loadWallet();
    } catch (e) { setCashMsg(apiError(e)); } finally { setCashBusy(false); }
  };

  useEffect(() => { void loadMessages(); }, []);

  // Re-sincroniza al volver a la pestaña (el jugador transfiere en el banco y vuelve): trae los mensajes
  // y el saldo frescos, así ve "✅ Carga acreditada" aunque el socket se haya dormido en segundo plano.
  useEffect(() => {
    const resync = () => { if (document.visibilityState === "visible") { void loadMessages(); void loadWallet(); } };
    document.addEventListener("visibilitychange", resync);
    return () => document.removeEventListener("visibilitychange", resync);
  }, []);

  // Popup/promo al entrar: se muestra si está activo y su versión no fue vista todavía.
  useEffect(() => {
    api.get<{ popup: Popup | null }>("/api/chat/me/popup")
      .then(({ data }) => {
        const p = data.popup;
        if (p?.version && localStorage.getItem(POPUP_SEEN_KEY) !== p.version) setPopup(p);
      })
      .catch(() => undefined);
  }, []);

  const closePopup = () => {
    if (popup?.version) localStorage.setItem(POPUP_SEEN_KEY, popup.version);
    setPopup(null);
  };

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  // Si ya dio permiso, re-suscribimos en silencio (refresca el endpoint en el backend).
  useEffect(() => { if (pushSupported() && Notification.permission === "granted") void subscribeToPush(); }, []);

  const enablePush = async () => {
    setPushBusy(true);
    const state = await subscribeToPush();
    setPush(state === "granted" ? "granted" : state === "denied" ? "denied" : Notification.permission);
    setPushBusy(false);
  };

  // Socket al namespace /chat con el JWT client como auth (Bearer va aparte en las requests HTTP).
  useEffect(() => {
    const token = getToken();
    if (!token) return;
    const socket: Socket = io(`${API_BASE}/chat`, { auth: { token } });
    const onMsg = (p: { message: Msg }) => setMessages((prev) => appendUnique(prev, p.message)); // dedup por id
    const onWallet = (p: { balance: number }) => setWallet((w) => (w ? { ...w, balance: p.balance } : w));
    socket.on("chat:message", onMsg);
    socket.on("chat:wallet", onWallet);
    // Al reconectar (el socket se cayó por segundo plano/red): traigo lo que me perdí mientras estuve
    // desconectado, porque socket.io NO reenvía los eventos emitidos cuando no había socket vivo.
    socket.io.on("reconnect", () => { void loadMessages(); void loadWallet(); });
    return () => { socket.off("chat:message", onMsg); socket.off("chat:wallet", onWallet); socket.disconnect(); };
  }, []);

  const sendBody = async (body: string, image?: string) => {
    if (!body.trim() && !image) return;
    setSending(true); setError(null);
    try {
      const { data } = await api.post<{ message: Msg }>("/api/chat/me/messages", { body: body.trim() || undefined, image });
      setMessages((prev) => appendUnique(prev, data.message)); // optimistic; el echo se deduplica
    } catch (e) { setError(apiError(e)); } finally { setSending(false); }
  };
  const send = async (e: FormEvent) => {
    e.preventDefault();
    const body = draft.trim();
    const image = chatImage;
    if (!body && !image) return;
    setDraft(""); setChatImage(null);
    await sendBody(body, image || undefined);
  };
  // Clip: adjuntar una imagen (comprobante/foto) al mensaje del jugador.
  const onChatImage = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) { return; }
    if (f.size > 700 * 1024) { setError("La imagen supera 700 KB. Sacá una foto más liviana."); e.target.value = ""; return; }
    const r = new FileReader(); r.onload = () => setChatImage(r.result as string); r.readAsDataURL(f);
    e.target.value = "";
  };

  // id del último mensaje con datos de pago (ahí va el form de carga activo).
  let lastPayId: string | null = null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const p = messages[i].pay;
    if (p && (p.cbu || p.alias || p.titular)) { lastPayId = messages[i].id; break; }
  }
  // si el operador no cargó datos estructurados, el form igual se ancla al último mensaje de datos.
  if (!lastPayId) { for (let i = messages.length - 1; i >= 0; i--) { if (messages[i].pay) { lastPayId = messages[i].id; break; } } }

  // "redblack" = diseño WhatsApp PELADO (Valentino): un chat común y corriente. Esconde TODO lo del
  // casino (saldo, pill de estado, barra Cargar/Retirar, chips del bot, botones dentro de mensajes,
  // popup/install/push) y deja solo: header + mensajes + barra de escribir (con 📎 para el comprobante,
  // que la IA lee igual). El cajero opera hablando, como en un WhatsApp real.
  const bare = (branding?.chatTheme || "whatsapp") === "redblack";

  return (
    <div className="chat-root flex h-full flex-col" data-theme={branding?.chatTheme || "whatsapp"}
      style={bare
        ? { backgroundColor: "var(--c-bg)", backgroundImage: "url(/chat-bg-redblack.jpg)", backgroundSize: "cover", backgroundPosition: "center" }
        : { backgroundColor: "var(--c-bg)" }}>
      {bare ? (
        /* Header estilo WhatsApp: flecha ← + avatar + nombre + "en línea" + videollamada + llamada. */
        <header className="flex items-center gap-2.5 px-2.5 py-2 shadow-sm" style={{ background: "var(--c-header)", color: "var(--c-header-text)" }}>
          <span className="flex h-8 w-5 shrink-0 items-center justify-center opacity-90" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
          </span>
          {branding?.logoUrl && !logoBroken ? <img src={branding.logoUrl} alt="" onError={() => setLogoBroken(true)} className="h-9 w-9 rounded-full object-cover" /> : <div className="h-9 w-9 rounded-full bg-white/25" />}
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-semibold leading-tight">{branding?.brandName || "Chat"}</div>
            <div className="text-[11px] leading-tight opacity-80">en línea</div>
          </div>
          <span className="flex h-9 w-8 items-center justify-center opacity-95" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="23" height="23" fill="currentColor"><path d="M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4z" /></svg>
          </span>
          <span className="flex h-9 w-8 items-center justify-center opacity-95" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2a1 1 0 0 1 1.02-.24 11.36 11.36 0 0 0 3.57.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1.02l-2.2 2.2z" /></svg>
          </span>
        </header>
      ) : (
        <header className="flex items-center gap-3 px-4 py-2.5 shadow" style={{ background: "var(--c-header)", color: "var(--c-header-text)" }}>
          {branding?.logoUrl && !logoBroken ? <img src={branding.logoUrl} alt="" onError={() => setLogoBroken(true)} className="h-9 w-9 rounded-full object-cover" /> : <div className="h-9 w-9 rounded-full bg-white/20" />}
          <div className="min-w-0">
            <div className="truncate font-semibold leading-tight">{branding?.brandName || "Chat"}</div>
            <div className="text-xs opacity-80">🟢 en línea</div>
          </div>
          {wallet && <div className="ml-auto rounded-full bg-white/20 px-3 py-1 text-sm font-bold">💰 {money(wallet.balance)}</div>}
        </header>
      )}

      {/* Banner "Instalar app" para el chat bare (redblack). Se muestra SOLO cuando se puede instalar
          DIRECTO: en Android cuando el instalador nativo de Chrome está listo (canInstall), en iPhone
          siempre (ahí el único camino es Compartir→Agregar). Si el teléfono ya la tiene instalada, en
          Android canInstall es false → el banner NO aparece (no confunde con una guía). */}
      {bare && branding?.chatInstallPromptEnabled && !isStandalone() && !installHidden && (canInstall || isIos()) && (
        <div className="flex items-center gap-2 px-3 py-2 text-sm shadow-sm" style={{ background: "rgba(255,255,255,0.97)", color: "#111b21" }}>
          <span className="text-base" aria-hidden="true">📲</span>
          <span className="min-w-0 flex-1 truncate font-medium">Instalá {branding?.brandName || "la app"} en tu teléfono</span>
          <button onClick={() => void doInstall()} className="shrink-0 rounded-full px-4 py-1.5 text-xs font-bold text-white" style={{ background: "var(--brand-primary)" }}>Instalar</button>
          <button onClick={dismissInstall} aria-label="Cerrar" className="shrink-0 px-1 text-lg leading-none text-slate-400">×</button>
        </div>
      )}

      {/* Pill "conectado" (estilo competencia): redondeada, flotando sobre el fondo. En redblack se
          esconde (WhatsApp pelado no tiene esa pill). */}
      {!bare && (
        <div className="flex justify-center px-4 pt-3 pb-1">
          <div className="rounded-full px-4 py-1.5 text-center text-xs font-medium shadow-sm" style={{ background: "var(--c-pill-bg)", color: "var(--c-pill-text)" }}>
            Conectado. Escribinos y te respondemos.
          </div>
        </div>
      )}

      {/* El link a la plataforma va SOLO en el primer mensaje (welcome), no en una barra arriba. */}

      {/* Popup/promo al entrar (imagen + texto + link), configurable por el operador. Oculto en redblack. */}
      {popup && !bare && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={closePopup}>
          <div className="w-full max-w-sm overflow-hidden rounded-2xl border border-slate-700 bg-slate-900" onClick={(e) => e.stopPropagation()}>
            {popup.image && <img src={popup.image} alt="" className="max-h-[45vh] w-full object-cover" />}
            <div className="p-4 text-center">
              {popup.title && <div className="text-lg font-bold text-slate-100">{popup.title}</div>}
              {popup.text && <p className="mt-1 text-sm text-slate-300">{popup.text}</p>}
              {popup.link ? (
                <a href={popup.link} target="_blank" rel="noreferrer" onClick={closePopup}
                  className="mt-4 block w-full rounded-full py-2.5 font-semibold text-slate-900" style={{ background: "var(--brand-primary)" }}>Ver más</a>
              ) : (
                <button onClick={closePopup} className="mt-4 w-full rounded-full py-2.5 font-semibold text-slate-900" style={{ background: "var(--brand-primary)" }}>Entendido</button>
              )}
              <button onClick={closePopup} className="mt-2 text-xs text-slate-500 underline">Cerrar</button>
            </div>
          </div>
        </div>
      )}

      {/* Instalar la app (post-registro, ya con sesión) -> al abrir la app instalada entra directo.
          Solo si el operador lo activó en el panel (apagado por defecto). */}
      {branding?.chatInstallPromptEnabled && !bare && <InstallPrompt />}

      {/* Modal GRANDE para activar notificaciones (solo si el navegador las soporta y aún no decidió).
          Branded por cuenta; se posterga unos días al tocar "Ahora no". Oculto en redblack (chat pelado). */}
      {push === "default" && !bare && <PushPrompt branding={branding} onEnable={enablePush} busy={pushBusy} />}
      {push === "denied" && !bare && (
        <div className="px-4 py-2 text-center text-xs" style={{ background: "var(--c-surface)", color: "var(--c-muted)" }}>
          Notificaciones bloqueadas. Podés activarlas desde los ajustes del navegador.
        </div>
      )}

      <div className="flex-1 space-y-1.5 overflow-y-auto px-3 py-3">
        {messages.map((m) => {
          const mine = m.senderType === "player";
          const time = new Date(m.createdAt).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
          const img = m.image && (
            <a href={m.image} target="_blank" rel="noopener noreferrer">
              <img src={m.image} alt="" className="mb-1 max-h-72 w-full rounded-lg object-cover" />
            </a>
          );
          const linkBtn = m.link && (
            <a href={m.link.url} target="_blank" rel="noopener noreferrer"
              className="btn-glow mt-2 flex w-full items-center justify-center gap-1 rounded-lg py-2.5 text-sm font-extrabold text-white"
              style={{ background: "#7c2fd6" }}>
              {m.link.label}
            </a>
          );
          // Botón "Copiar usuario" (mensaje post-carga con credenciales): copia el nombre al portapapeles.
          const copyBtn = m.copy && (
            <button onClick={() => void copy("user", m.copy!.value)}
              className="mt-2 flex w-full items-center justify-center gap-1 rounded-lg border py-2.5 text-sm font-bold"
              style={copied === "user" ? { background: "var(--c-accent)", color: "var(--c-accent-text)", borderColor: "var(--c-accent)" } : { color: "var(--c-accent)", borderColor: "var(--c-accent)" }}>
              {copied === "user" ? "✓ Copiado" : m.copy.label}
            </button>
          );
          // Botón "INSTALAR APP" (mensaje 2 de la secuencia de instalación): dispara el instalador
          // (Android) o la guía de iPhone.
          const installBtn = m.install && (
            <button onClick={() => void doInstall()}
              className="btn-glow mt-2 flex w-full items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-extrabold text-white"
              style={{ background: "var(--brand-primary, #7c2fd6)" }}>
              📲 INSTALAR APP
            </button>
          );
          // system y operator se muestran igual: burbuja blanca a la IZQUIERDA (como que la marca
          // te escribe primero, estilo WhatsApp). Solo el jugador va a la derecha en verde.
          const hasPay = !!(m.pay && (m.pay.cbu || m.pay.alias || m.pay.titular));
          const showForm = m.id === lastPayId;  // el form persiste en el último mensaje de datos (no se achica al enviar)
          // Cards con botón (bienvenida con link + datos de pago + instalar) usan el MISMO ancho, para
          // que todos los botones tengan las mismas proporciones y el chat no se "descuadre".
          const isWide = !bare && (hasPay || !!m.pay || !!m.link || !!m.install || !!m.copy);
          return (
            <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div className={`px-2.5 py-1.5 text-sm shadow-sm ${isWide ? "w-[88%] max-w-[88%]" : "max-w-[82%]"} ${mine ? "rounded-lg rounded-tr-sm" : "rounded-lg rounded-tl-sm"}`}
                style={mine ? { background: "var(--c-me)", color: "var(--c-me-text)" } : { background: "var(--c-surface)", color: "var(--c-surface-text)" }}>
                {img}
                {m.body && <div className="whitespace-pre-wrap break-words">{m.body}</div>}
                {!bare && copyBtn}
                {!bare && linkBtn}
                {!bare && installBtn}
                {!bare && (hasPay || showForm) && (
                  <div className="mt-1.5">
                    {hasPay ? (
                      <>
                        <div className="rounded-lg p-2.5 text-xs" style={{ background: "var(--c-inset)" }}>
                          {m.pay!.cbu && <div className="flex items-center justify-between gap-2 py-0.5"><span className="opacity-60">CBU/CVU</span><span className="break-all text-right font-semibold">{m.pay!.cbu}</span></div>}
                          {m.pay!.alias && <div className="flex items-center justify-between gap-2 py-0.5"><span className="opacity-60">Alias</span><span className="break-all text-right font-semibold">{m.pay!.alias}</span></div>}
                          {m.pay!.titular && <div className="flex items-center justify-between gap-2 py-0.5"><span className="opacity-60">Titular</span><span className="text-right font-semibold">{m.pay!.titular}</span></div>}
                        </div>
                        <div className="mt-2 flex flex-col gap-2">
                          {m.pay!.cbu && <button onClick={() => void copy("cbu", m.pay!.cbu!)} className="w-full rounded-lg border py-2.5 text-sm font-bold" style={copied === "cbu" ? { background: "var(--c-accent)", color: "var(--c-accent-text)", borderColor: "var(--c-accent)" } : { color: "var(--c-accent)", borderColor: "var(--c-accent)" }}>{copied === "cbu" ? "✓ Copiado" : "Copiar CBU"}</button>}
                          {m.pay!.alias && <button onClick={() => void copy("alias", m.pay!.alias!)} className="w-full rounded-lg border py-2.5 text-sm font-bold" style={copied === "alias" ? { background: "var(--c-accent)", color: "var(--c-accent-text)", borderColor: "var(--c-accent)" } : { color: "var(--c-accent)", borderColor: "var(--c-accent)" }}>{copied === "alias" ? "✓ Copiado" : "Copiar ALIAS"}</button>}
                        </div>
                      </>
                    ) : (showForm && wallet?.paymentInfo) ? (
                      <div className="whitespace-pre-wrap rounded-lg p-2.5 text-xs" style={{ background: "var(--c-inset)" }}>{wallet.paymentInfo}</div>
                    ) : null}
                    {showForm && wallet && (
                      <div className="mt-2">
                        <input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Monto (opcional, lo leemos del comprobante)"
                          className="w-full rounded-lg border px-3 py-2.5 text-base outline-none placeholder:opacity-50" style={{ background: "var(--c-input)", color: "var(--c-surface-text)", borderColor: "var(--c-border)" }} />
                        <label className="mt-2 flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-bold" style={{ background: "var(--c-accent)", color: "var(--c-accent-text)" }}>
                          {comprobante ? "✓ Comprobante listo" : "📎 SUBIR COMPROBANTE"}
                          <input type="file" accept="image/*" className="hidden" onChange={onComprobante} />
                        </label>
                        {cashMsg && <div className="mt-1.5 text-center text-xs text-rose-500">{cashMsg}</div>}
                        <button onClick={() => void submitDeposit()} disabled={cashBusy}
                          className="mt-2 w-full rounded-lg py-2.5 text-sm font-bold text-white disabled:opacity-50" style={{ background: "var(--c-submit)" }}>{cashBusy ? "Enviando…" : "Ya transferí, avisar"}</button>
                      </div>
                    )}
                  </div>
                )}
                <div className="mt-0.5 text-right text-[10px] leading-none opacity-60">{time}</div>
              </div>
            </div>
          );
        })}
        {messages.length === 0 && <p className="mt-8 text-center text-sm text-[var(--c-muted)]">Escribinos, te respondemos al toque.</p>}
        <div ref={endRef} />
      </div>

      {error && <div className="px-4 py-1 text-center text-xs text-rose-600">{error}</div>}

      {/* Botones del bot (chips): tocar = mandar ese texto. Muestra los del último mensaje. Ocultos en redblack. */}
      {!bare && messages[messages.length - 1]?.buttons?.length ? (
        <div className="flex flex-wrap gap-2 px-3 pt-2.5" style={{ background: "var(--c-surface)" }}>
          {messages[messages.length - 1]!.buttons!.map((b) => (
            <button key={b} type="button" disabled={sending} onClick={() => void sendBody(b)}
              className="rounded-full border px-3.5 py-1.5 text-sm font-medium disabled:opacity-50" style={{ borderColor: "var(--c-accent)", color: "var(--c-accent)" }}>
              {b}
            </button>
          ))}
        </div>
      ) : null}

      {/* Barra del cajero: cargar / retirar / soporte (E3). Botones full-width "fichas" (estilo maqueta).
          En redblack NO va (chat pelado): el cajero maneja carga/retiro hablando, como en WhatsApp. */}
      {wallet && !bare && (
        <div className="flex flex-col gap-2 px-3 pt-3 pb-1" style={{ background: "var(--c-bg)" }}>
          <button onClick={() => void openDeposit()}
            className="flex w-full items-center justify-center gap-2 rounded-lg py-3 text-sm font-extrabold shadow-sm"
            style={{ background: "var(--c-surface)", color: "var(--c-accent)" }}>💰 Cargar fichas</button>
          <button onClick={() => { setCashier("withdrawal"); setCashMsg(null); setAmount(""); }}
            className="flex w-full items-center justify-center gap-2 rounded-lg py-3 text-sm font-extrabold shadow-sm"
            style={{ background: "var(--c-surface)", color: "var(--c-accent)" }}>💸 Retirar</button>
          <button onClick={() => inputRef.current?.focus()}
            className="w-full py-0.5 text-center text-xs font-medium" style={{ color: "var(--c-muted)" }}>💬 ¿Ayuda? Escribinos</button>
        </div>
      )}

      <form onSubmit={send} className="p-3" style={{ background: "var(--c-surface)", paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}>
        {chatImage && (
          <div className="mb-2 flex items-center gap-2 rounded-lg p-2" style={{ background: "var(--c-inset)" }}>
            <img src={chatImage} alt="" className="h-14 w-14 rounded object-cover" />
            <span className="text-xs opacity-60">Imagen lista para enviar</span>
            <button type="button" onClick={() => setChatImage(null)} className="ml-auto px-2 opacity-60" aria-label="Quitar imagen">✕</button>
          </div>
        )}
        {bare ? (
          /* Barra estilo WhatsApp: + (adjuntar) · campo redondeado con sticker adentro · (vacío) cámara +
             micrófono / (escribiendo) botón enviar. Iconos con los colores del tema (var --c-*). */
          <div className="flex items-center gap-1.5">
            <label className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center" aria-label="Adjuntar" style={{ color: "var(--c-muted)" }}>
              <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
              <input type="file" accept="image/*" className="hidden" onChange={onChatImage} />
            </label>
            <div className="relative flex-1">
              <input ref={inputRef} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Mensaje"
                className="w-full rounded-full border py-2.5 pl-4 pr-11 outline-none placeholder:opacity-50" style={{ background: "var(--c-input)", color: "var(--c-surface-text)", borderColor: "var(--c-border)" }} />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2" style={{ color: "var(--c-muted)" }} aria-hidden="true">
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8l-6 6H6a2 2 0 0 1-2-2V6z" /><path d="M14 20v-4a2 2 0 0 1 2-2h4" /></svg>
              </span>
            </div>
            {(draft.trim() || chatImage) ? (
              <button type="submit" disabled={sending} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full disabled:opacity-50" style={{ background: "var(--c-accent)", color: "var(--c-accent-text)" }} aria-label="Enviar">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M3 20.5L21 12 3 3.5V10l12 2-12 2z" /></svg>
              </button>
            ) : (
              <>
                <label className="flex h-9 w-8 shrink-0 cursor-pointer items-center justify-center" aria-label="Cámara" style={{ color: "var(--c-muted)" }}>
                  <svg viewBox="0 0 24 24" width="23" height="23" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></svg>
                  <input type="file" accept="image/*" capture="environment" className="hidden" onChange={onChatImage} />
                </label>
                <span className="flex h-9 w-7 shrink-0 items-center justify-center" style={{ color: "var(--c-muted)" }} aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" /><path d="M19 11a7 7 0 0 1-14 0" /><line x1="12" y1="18" x2="12" y2="22" /></svg>
                </span>
              </>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <label className="flex h-11 w-9 shrink-0 cursor-pointer items-center justify-center text-2xl opacity-50" aria-label="Adjuntar imagen">
              📎
              <input type="file" accept="image/*" className="hidden" onChange={onChatImage} />
            </label>
            <input ref={inputRef} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Escribí un mensaje…"
              className="flex-1 rounded-full border px-4 py-2.5 outline-none placeholder:opacity-50" style={{ background: "var(--c-input)", color: "var(--c-surface-text)", borderColor: "var(--c-border)" }} />
            <button type="submit" disabled={sending || (!draft.trim() && !chatImage)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-lg disabled:opacity-50" style={{ background: "var(--c-accent)", color: "var(--c-accent-text)" }}>
              ➤
            </button>
          </div>
        )}
      </form>

      {/* Modal RETIRAR */}
      {cashier === "withdrawal" && wallet && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-3 sm:items-center" onClick={() => setCashier(null)}>
          <div className="chat-root w-full max-w-sm rounded-2xl p-5" data-theme={branding?.chatTheme || "whatsapp"} style={{ background: "var(--c-surface)", color: "var(--c-surface-text)" }} onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-bold">Retirar fichas</h3>
              <button onClick={() => setCashier(null)} className="text-xl opacity-50">✕</button>
            </div>
            <div className="mb-3 rounded-xl p-3 text-left" style={{ background: "var(--c-inset)" }}>
              <div className="text-xs uppercase tracking-wide opacity-60">Saldo actual</div>
              <div className="text-xl font-bold" style={{ color: "var(--c-accent)" }}>{money(wallet.balance)}</div>
            </div>
            <p className="mb-2 text-xs opacity-60">Retiro mínimo {money(wallet.minWithdrawal)}.</p>
            <input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Monto a retirar"
              className="mb-2 w-full rounded-xl border px-4 py-3 text-base outline-none placeholder:opacity-50" style={{ background: "var(--c-input)", color: "var(--c-surface-text)", borderColor: "var(--c-border)" }} />
            <input value={destino} onChange={(e) => setDestino(e.target.value)} placeholder="Tu CBU / CVU / alias"
              className="mb-3 w-full rounded-xl border px-4 py-3 text-base outline-none placeholder:opacity-50" style={{ background: "var(--c-input)", color: "var(--c-surface-text)", borderColor: "var(--c-border)" }} />
            {cashMsg && <p className="mb-2 text-sm text-rose-500">{cashMsg}</p>}
            <button onClick={() => void submitWithdrawal()} disabled={cashBusy}
              className="w-full rounded-xl py-3 font-extrabold disabled:opacity-50" style={{ background: "var(--c-accent)", color: "var(--c-accent-text)" }}>
              {cashBusy ? "Enviando…" : "Enviar pedido de retiro"}
            </button>
          </div>
        </div>
      )}

      {/* Guía de instalación en iPhone (al tocar "INSTALAR APP" cuando no hay instalador nativo). */}
      {guide === "ios" && <InstallGuide onClose={() => setGuide(null)} />}
      {guide === "android" && <AndroidInstallGuide onClose={() => setGuide(null)} />}
    </div>
  );
}
