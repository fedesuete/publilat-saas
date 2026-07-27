import { useEffect, useRef, useState, type FormEvent, type ChangeEvent } from "react";
import { io, type Socket } from "socket.io-client";
import { api, apiError, API_BASE, getToken, clearToken, loadBranding } from "../lib/api";
import { subscribeToPush, pushSupported, pushPermission } from "../lib/push";
import InstallPrompt from "../components/InstallPrompt";

interface Msg { id: string; senderType: "player" | "operator" | "system"; body: string | null; image?: string | null; buttons?: string[] | null; link?: { label: string; url: string } | null; createdAt: string }
interface Popup { title?: string | null; text?: string | null; image?: string | null; link?: string | null; version: string }
const POPUP_SEEN_KEY = "publilat_popup_seen";

function appendUnique(list: Msg[], m: Msg): Msg[] {
  return list.some((x) => x.id === m.id) ? list : [...list, m];
}

export default function ChatPage() {
  const branding = loadBranding();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [push, setPush] = useState<NotificationPermission | "unsupported">(pushPermission());
  const [pushBusy, setPushBusy] = useState(false);
  const [popup, setPopup] = useState<Popup | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // --- Cajero (Fase E3): saldo + cargar/retirar ---
  const [wallet, setWallet] = useState<{ balance: number; minDeposit: number; minWithdrawal: number; paymentInfo: string | null } | null>(null);
  const [cashier, setCashier] = useState<"deposit" | "withdrawal" | null>(null);
  const [amount, setAmount] = useState("");
  const [destino, setDestino] = useState("");
  const [comprobante, setComprobante] = useState<string | null>(null);
  const [cashBusy, setCashBusy] = useState(false);
  const [cashMsg, setCashMsg] = useState<string | null>(null);
  const money = (n: number) => "$" + n.toLocaleString("es-AR");

  const loadWallet = () =>
    api.get<{ balance: number; minDeposit: number; minWithdrawal: number; paymentInfo: string | null }>("/api/chat/me/wallet")
      .then(({ data }) => setWallet(data)).catch(() => undefined);
  useEffect(() => { void loadWallet(); }, []);

  const onComprobante = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    const r = new FileReader(); r.onload = () => setComprobante(r.result as string); r.readAsDataURL(f);
  };
  const submitDeposit = async () => {
    const amt = parseInt(amount.replace(/\D/g, ""), 10);
    if (!amt) { setCashMsg("Poné un monto."); return; }
    setCashBusy(true); setCashMsg(null);
    try {
      await api.post("/api/chat/me/deposit", { amount: amt, method: "Transferencia", comprobante: comprobante || undefined });
      setCashier(null); setAmount(""); setComprobante(null); setCashMsg("✅ Carga registrada. La estamos verificando.");
      void loadWallet();
    } catch (e) { setCashMsg(apiError(e)); } finally { setCashBusy(false); }
  };
  const submitWithdrawal = async () => {
    const amt = parseInt(amount.replace(/\D/g, ""), 10);
    if (!amt || !destino.trim()) { setCashMsg("Completá monto y CBU/alias."); return; }
    setCashBusy(true); setCashMsg(null);
    try {
      await api.post("/api/chat/me/withdrawal", { amount: amt, destino: destino.trim() });
      setCashier(null); setAmount(""); setDestino(""); setCashMsg("✅ Pedido de retiro enviado.");
      void loadWallet();
    } catch (e) { setCashMsg(apiError(e)); } finally { setCashBusy(false); }
  };

  useEffect(() => {
    api.get<{ messages: Msg[] }>("/api/chat/me/conversation")
      .then(({ data }) => setMessages(data.messages))
      .catch((e) => {
        // token vencido/ inválido -> volver al login
        if ((e as { response?: { status?: number } })?.response?.status === 401) { clearToken(); location.href = "/login"; return; }
        setError(apiError(e));
      });
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
    return () => { socket.off("chat:message", onMsg); socket.off("chat:wallet", onWallet); socket.disconnect(); };
  }, []);

  const sendBody = async (body: string) => {
    if (!body.trim()) return;
    setSending(true); setError(null);
    try {
      const { data } = await api.post<{ message: Msg }>("/api/chat/me/messages", { body: body.trim() });
      setMessages((prev) => appendUnique(prev, data.message)); // optimistic; el echo se deduplica
    } catch (e) { setError(apiError(e)); } finally { setSending(false); }
  };
  const send = async (e: FormEvent) => {
    e.preventDefault();
    const body = draft.trim();
    if (!body) return;
    setDraft("");
    await sendBody(body);
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-slate-800 px-4 py-3">
        {branding?.logoUrl && <img src={branding.logoUrl} alt="" className="h-8 w-8 rounded-lg object-cover" />}
        <div className="font-semibold">{branding?.brandName || "Chat"}</div>
        {wallet && <div className="ml-auto rounded-full bg-slate-800 px-3 py-1 text-sm font-bold text-emerald-400">💰 {money(wallet.balance)}</div>}
      </header>

      {/* Botón "Entrar a la plataforma" (configurable por el operador). */}
      {branding?.chatPlatformUrl && (
        <a href={branding.chatPlatformUrl} target="_blank" rel="noopener noreferrer"
          className="mx-3 mt-2 flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-extrabold text-slate-900 transition active:scale-[.99]"
          style={{ background: "var(--brand-primary)", boxShadow: "0 8px 22px -10px var(--brand-primary)" }}>
          🎮 Entrar a la plataforma
        </a>
      )}

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

      {/* Instalar la app (post-registro, ya con sesión) -> al abrir la app instalada entra directo. */}
      <InstallPrompt />

      {/* Aviso: activar notificaciones (solo si el navegador las soporta y aún no decidió). */}
      {push === "default" && (
        <div className="flex items-center justify-between gap-3 border-b border-slate-800 bg-slate-900/60 px-4 py-2 text-sm">
          <span className="text-slate-300">🔔 Activá las notificaciones para no perderte respuestas.</span>
          <button onClick={() => void enablePush()} disabled={pushBusy}
            className="shrink-0 rounded-full px-3 py-1 text-xs font-semibold text-slate-900 disabled:opacity-50" style={{ background: "var(--brand-primary)" }}>
            {pushBusy ? "…" : "Activar"}
          </button>
        </div>
      )}
      {push === "denied" && (
        <div className="border-b border-slate-800 bg-slate-900/60 px-4 py-2 text-center text-xs text-slate-500">
          Notificaciones bloqueadas. Podés activarlas desde los ajustes del navegador.
        </div>
      )}

      <div className="flex-1 space-y-1.5 overflow-y-auto p-4">
        {messages.map((m) => {
          const mine = m.senderType === "player";
          const sys = m.senderType === "system";
          const time = new Date(m.createdAt).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
          const img = m.image && (
            <a href={m.image} target="_blank" rel="noopener noreferrer">
              <img src={m.image} alt="" className="mb-1.5 max-h-72 w-full rounded-lg object-cover" />
            </a>
          );
          const linkBtn = m.link && (
            <a href={m.link.url} target="_blank" rel="noopener noreferrer"
              className="mt-2 flex items-center justify-center gap-1 rounded-lg py-2 text-sm font-extrabold text-slate-900"
              style={{ background: "var(--brand-primary)" }}>
              {m.link.label}
            </a>
          );
          if (sys) {
            return (
              <div key={m.id} className="flex justify-center py-1">
                <div className="max-w-[88%] rounded-2xl bg-slate-800 px-4 py-2.5 text-sm text-slate-100 shadow">
                  {img}
                  {m.body && <div className="whitespace-pre-wrap break-words">{m.body}</div>}
                  {linkBtn}
                </div>
              </div>
            );
          }
          return (
            <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[82%] px-3 py-1.5 text-sm shadow ${mine ? "rounded-2xl rounded-tr-md text-slate-900" : "rounded-2xl rounded-tl-md bg-slate-700 text-slate-100"}`}
                style={mine ? { background: "var(--brand-primary)" } : undefined}>
                {img}
                {m.body && <div className="whitespace-pre-wrap break-words">{m.body}</div>}
                {linkBtn}
                <div className={`mt-0.5 text-right text-[10px] leading-none ${mine ? "text-slate-900/55" : "text-slate-400"}`}>{time}</div>
              </div>
            </div>
          );
        })}
        {messages.length === 0 && <p className="mt-8 text-center text-sm text-slate-500">Escribinos, te respondemos al toque.</p>}
        <div ref={endRef} />
      </div>

      {error && <div className="px-4 py-1 text-center text-xs text-rose-400">{error}</div>}

      {/* Botones del bot (chips): tocar = mandar ese texto. Muestra los del último mensaje. */}
      {messages[messages.length - 1]?.buttons?.length ? (
        <div className="flex flex-wrap gap-2 border-t border-slate-800 px-3 pt-2.5">
          {messages[messages.length - 1]!.buttons!.map((b) => (
            <button key={b} type="button" disabled={sending} onClick={() => void sendBody(b)}
              className="rounded-full border bg-slate-800 px-3.5 py-1.5 text-sm font-medium text-slate-100 hover:bg-slate-700 disabled:opacity-50"
              style={{ borderColor: "var(--brand-primary, #25d366)" }}>
              {b}
            </button>
          ))}
        </div>
      ) : null}

      {/* Barra del cajero: cargar / retirar (E3). */}
      {wallet && (
        <div className="flex gap-2 border-t border-slate-800 px-3 pt-2.5">
          <button onClick={() => { setCashier("deposit"); setCashMsg(null); setAmount(""); }}
            className="flex-1 rounded-full py-2 text-sm font-bold text-slate-900" style={{ background: "var(--brand-primary)" }}>💵 Cargar</button>
          <button onClick={() => { setCashier("withdrawal"); setCashMsg(null); setAmount(""); }}
            className="flex-1 rounded-full border border-slate-600 py-2 text-sm font-bold text-slate-100 hover:bg-slate-800">🏧 Retirar</button>
        </div>
      )}

      <form onSubmit={send} className="flex items-center gap-2 border-t border-slate-800 p-3" style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}>
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Escribí un mensaje…"
          className="flex-1 rounded-full border border-slate-700 bg-slate-900 px-4 py-2.5 outline-none" />
        <button type="submit" disabled={sending || !draft.trim()} className="rounded-full px-5 py-2.5 font-semibold text-slate-900 disabled:opacity-50" style={{ background: "var(--brand-primary)" }}>
          →
        </button>
      </form>

      {/* Toast de confirmación (carga/retiro enviados). */}
      {cashMsg && !cashier && (
        <div className="fixed left-1/2 top-4 z-[60] max-w-[92%] -translate-x-1/2 rounded-full bg-emerald-600 px-4 py-2 text-center text-sm font-semibold text-white shadow-lg">{cashMsg}</div>
      )}

      {/* Modal CARGAR */}
      {cashier === "deposit" && wallet && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-3 sm:items-center" onClick={() => setCashier(null)}>
          <div className="w-full max-w-sm rounded-2xl border border-slate-700 bg-slate-900 p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-bold">💵 Cargar</h3>
              <button onClick={() => setCashier(null)} className="text-xl text-slate-400">✕</button>
            </div>
            {wallet.paymentInfo && (
              <div className="mb-3 whitespace-pre-wrap rounded-xl border border-white/10 bg-white/5 p-3 text-left text-sm text-slate-200">{wallet.paymentInfo}</div>
            )}
            <p className="mb-2 text-xs text-slate-400">Transferí a esos datos, poné el monto y (si podés) subí el comprobante. Carga mínima {money(wallet.minDeposit)}.</p>
            <input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Monto a cargar"
              className="mb-2 w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-base outline-none" />
            <label className="mb-3 flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-white/15 py-2.5 text-sm text-slate-200 hover:bg-white/5">
              {comprobante ? "✓ Comprobante listo" : "📎 Subir comprobante (opcional)"}
              <input type="file" accept="image/*" className="hidden" onChange={onComprobante} />
            </label>
            {cashMsg && <p className="mb-2 text-sm text-rose-300">{cashMsg}</p>}
            <button onClick={() => void submitDeposit()} disabled={cashBusy}
              className="w-full rounded-xl py-3 font-extrabold text-slate-900 disabled:opacity-50" style={{ background: "var(--brand-primary)" }}>
              {cashBusy ? "Enviando…" : "Ya transferí"}
            </button>
          </div>
        </div>
      )}

      {/* Modal RETIRAR */}
      {cashier === "withdrawal" && wallet && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-3 sm:items-center" onClick={() => setCashier(null)}>
          <div className="w-full max-w-sm rounded-2xl border border-slate-700 bg-slate-900 p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-bold">🏧 Retirar</h3>
              <button onClick={() => setCashier(null)} className="text-xl text-slate-400">✕</button>
            </div>
            <div className="mb-3 rounded-xl border border-white/10 bg-white/5 p-3 text-left">
              <div className="text-xs uppercase tracking-wide text-slate-500">Saldo actual</div>
              <div className="text-xl font-bold text-emerald-400">{money(wallet.balance)}</div>
            </div>
            <p className="mb-2 text-xs text-slate-400">Retiro mínimo {money(wallet.minWithdrawal)}.</p>
            <input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Monto a retirar"
              className="mb-2 w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-base outline-none" />
            <input value={destino} onChange={(e) => setDestino(e.target.value)} placeholder="Tu CBU / CVU / alias"
              className="mb-3 w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-base outline-none" />
            {cashMsg && <p className="mb-2 text-sm text-rose-300">{cashMsg}</p>}
            <button onClick={() => void submitWithdrawal()} disabled={cashBusy}
              className="w-full rounded-xl py-3 font-extrabold text-slate-900 disabled:opacity-50" style={{ background: "var(--brand-primary)" }}>
              {cashBusy ? "Enviando…" : "Enviar pedido de retiro"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
