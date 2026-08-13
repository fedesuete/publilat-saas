import { useEffect, useRef, useState, type FormEvent, type ChangeEvent } from "react";
import { io, type Socket } from "socket.io-client";
import { api, apiError, API_BASE, getToken, clearToken, loadBranding, saveBranding, applyBranding, type Branding } from "../lib/api";
import { subscribeToPush, pushSupported, pushPermission } from "../lib/push";
import InstallPrompt, { InstallGuide } from "../components/InstallPrompt";
import PushPrompt from "../components/PushPrompt";
import { promptInstall, onInstallAvailable, bakeSessionIntoUrl, pointManifestToSession } from "../lib/install";

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
  const [showGuide, setShowGuide] = useState(false);
  const [chatImage, setChatImage] = useState<string | null>(null);
  useEffect(() => onInstallAvailable(setCanInstall), []);
  useEffect(() => { pointManifestToSession(); }, []); // manifest por sesión -> instalar en iPhone abre logueado
  const doInstall = () => { if (canInstall) { void promptInstall(); } else { bakeSessionIntoUrl(); setShowGuide(true); } };
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

  return (
    <div className="chat-root flex h-full flex-col bg-[var(--c-bg)]" data-theme={branding?.chatTheme || "whatsapp"}>
      <header className="flex items-center gap-3 px-4 py-2.5 shadow" style={{ background: "var(--c-header)", color: "var(--c-header-text)" }}>
        {branding?.logoUrl && !logoBroken ? <img src={branding.logoUrl} alt="" onError={() => setLogoBroken(true)} className="h-9 w-9 rounded-full object-cover" /> : <div className="h-9 w-9 rounded-full bg-white/20" />}
        <div className="min-w-0">
          <div className="truncate font-semibold leading-tight">{branding?.brandName || "Chat"}</div>
          <div className="text-xs opacity-80">🟢 en línea</div>
        </div>
        {wallet && <div className="ml-auto rounded-full bg-white/20 px-3 py-1 text-sm font-bold">💰 {money(wallet.balance)}</div>}
      </header>

      {/* Pill "conectado" (estilo competencia): redondeada, flotando sobre el fondo. */}
      <div className="flex justify-center px-4 pt-3 pb-1">
        <div className="rounded-full px-4 py-1.5 text-center text-xs font-medium shadow-sm" style={{ background: "var(--c-pill-bg)", color: "var(--c-pill-text)" }}>
          Conectado. Escribinos y te respondemos.
        </div>
      </div>

      {/* El link a la plataforma va SOLO en el primer mensaje (welcome), no en una barra arriba. */}

      {/* Popup/promo al entrar (imagen + texto + link), configurable por el operador. */}
      {popup && (
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
      {branding?.chatInstallPromptEnabled && <InstallPrompt />}

      {/* Modal GRANDE para activar notificaciones (solo si el navegador las soporta y aún no decidió).
          Branded por cuenta; se posterga unos días al tocar "Ahora no". */}
      {push === "default" && <PushPrompt branding={branding} onEnable={enablePush} busy={pushBusy} />}
      {push === "denied" && (
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
            <button onClick={doInstall}
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
          const isWide = hasPay || !!m.pay || !!m.link || !!m.install || !!m.copy;
          return (
            <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div className={`px-2.5 py-1.5 text-sm shadow-sm ${isWide ? "w-[88%] max-w-[88%]" : "max-w-[82%]"} ${mine ? "rounded-lg rounded-tr-sm" : "rounded-lg rounded-tl-sm"}`}
                style={mine ? { background: "var(--c-me)", color: "var(--c-me-text)" } : { background: "var(--c-surface)", color: "var(--c-surface-text)" }}>
                {img}
                {m.body && <div className="whitespace-pre-wrap break-words">{m.body}</div>}
                {copyBtn}
                {linkBtn}
                {installBtn}
                {(hasPay || showForm) && (
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

      {/* Botones del bot (chips): tocar = mandar ese texto. Muestra los del último mensaje. */}
      {messages[messages.length - 1]?.buttons?.length ? (
        <div className="flex flex-wrap gap-2 px-3 pt-2.5" style={{ background: "var(--c-surface)" }}>
          {messages[messages.length - 1]!.buttons!.map((b) => (
            <button key={b} type="button" disabled={sending} onClick={() => void sendBody(b)}
              className="rounded-full border px-3.5 py-1.5 text-sm font-medium disabled:opacity-50" style={{ borderColor: "var(--c-accent)", color: "var(--c-accent)" }}>
              {b}
            </button>
          ))}
        </div>
      ) : null}

      {/* Barra del cajero: cargar / retirar / soporte (E3). Botones full-width "fichas" (estilo maqueta). */}
      {wallet && (
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
      {showGuide && <InstallGuide onClose={() => setShowGuide(false)} />}
    </div>
  );
}
