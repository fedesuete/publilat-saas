import { useEffect, useRef, useState, type FormEvent, type ChangeEvent } from "react";
import { io, type Socket } from "socket.io-client";
import { api, apiError, API_BASE, getToken, clearToken, loadBranding } from "../lib/api";
import { subscribeToPush, pushSupported, pushPermission } from "../lib/push";
import InstallPrompt from "../components/InstallPrompt";

interface Msg { id: string; senderType: "player" | "operator" | "system"; body: string | null; image?: string | null; buttons?: string[] | null; link?: { label: string; url: string } | null; createdAt: string }
interface Popup { title?: string | null; text?: string | null; image?: string | null; link?: string | null; version: string }
interface Wallet { balance: number; minDeposit: number; minWithdrawal: number; paymentInfo: string | null; pay?: { cbu: string | null; alias: string | null; titular: string | null } }
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
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [cashier, setCashier] = useState<"deposit" | "withdrawal" | null>(null);
  const [depositCard, setDepositCard] = useState(false); // el "cargar" se muestra como mensaje en el chat
  const [amount, setAmount] = useState("");
  const [destino, setDestino] = useState("");
  const [comprobante, setComprobante] = useState<string | null>(null);
  const [cashBusy, setCashBusy] = useState(false);
  const [cashMsg, setCashMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const money = (n: number) => "$" + n.toLocaleString("es-AR");
  const copy = async (label: string, value: string) => {
    try { await navigator.clipboard.writeText(value); setCopied(label); setTimeout(() => setCopied(null), 1500); } catch { /* algunos webviews bloquean */ }
  };

  const loadWallet = () =>
    api.get<Wallet>("/api/chat/me/wallet").then(({ data }) => setWallet(data)).catch(() => undefined);
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
      setCashier(null); setDepositCard(false); setAmount(""); setComprobante(null); setCashMsg("✅ Carga registrada. La estamos verificando.");
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
    <div className="flex h-full flex-col bg-[#e5ddd5]">
      <header className="flex items-center gap-3 px-4 py-2.5 text-white shadow" style={{ background: "#0b7d6e" }}>
        {branding?.logoUrl ? <img src={branding.logoUrl} alt="" className="h-9 w-9 rounded-full object-cover" /> : <div className="h-9 w-9 rounded-full bg-white/20" />}
        <div className="min-w-0">
          <div className="truncate font-semibold leading-tight">{branding?.brandName || "Chat"}</div>
          <div className="text-xs text-white/85">🟢 en línea</div>
        </div>
        {wallet && <div className="ml-auto rounded-full bg-white/20 px-3 py-1 text-sm font-bold">💰 {money(wallet.balance)}</div>}
      </header>

      {/* Barra "conectado" (estilo competencia): azul, informativa. */}
      <div className="bg-[#e0f2fe] px-4 py-1.5 text-center text-xs font-medium text-[#1d4ed8]">
        Conectado. Escribinos y te respondemos.
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

      {/* Instalar la app (post-registro, ya con sesión) -> al abrir la app instalada entra directo. */}
      <InstallPrompt />

      {/* Aviso: activar notificaciones (solo si el navegador las soporta y aún no decidió). */}
      {push === "default" && (
        <div className="flex items-center justify-between gap-3 bg-white/80 px-4 py-2 text-sm shadow-sm">
          <span className="text-slate-700">🔔 Activá las notificaciones para no perderte respuestas.</span>
          <button onClick={() => void enablePush()} disabled={pushBusy}
            className="shrink-0 rounded-full bg-[#1fa855] px-3 py-1 text-xs font-semibold text-white disabled:opacity-50">
            {pushBusy ? "…" : "Activar"}
          </button>
        </div>
      )}
      {push === "denied" && (
        <div className="bg-white/70 px-4 py-2 text-center text-xs text-slate-500">
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
              className="btn-glow mt-2 flex items-center justify-center gap-1 rounded-lg py-2 text-sm font-extrabold text-white"
              style={{ background: "var(--brand-primary, #7c2fd6)" }}>
              {m.link.label}
            </a>
          );
          // system y operator se muestran igual: burbuja blanca a la IZQUIERDA (como que la marca
          // te escribe primero, estilo WhatsApp). Solo el jugador va a la derecha en verde.
          return (
            <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[82%] px-2.5 py-1.5 text-sm text-slate-800 shadow-sm ${mine ? "rounded-lg rounded-tr-sm" : "rounded-lg rounded-tl-sm bg-white"}`}
                style={mine ? { background: "#d9fdd3" } : undefined}>
                {img}
                {m.body && <div className="whitespace-pre-wrap break-words">{m.body}</div>}
                {linkBtn}
                <div className="mt-0.5 text-right text-[10px] leading-none text-slate-500">{time}</div>
              </div>
            </div>
          );
        })}
        {messages.length === 0 && <p className="mt-8 text-center text-sm text-slate-600">Escribinos, te respondemos al toque.</p>}

        {/* CARGAR como mensaje en el chat (estilo competencia): datos + copiar + subir comprobante. */}
        {depositCard && wallet && (
          <div className="flex justify-start">
            <div className="max-w-[86%] rounded-lg rounded-tl-sm bg-white px-3 py-2.5 text-sm text-slate-800 shadow-sm">
              <div className="mb-2 font-medium">Para cargar transferí a estos datos y subí el comprobante por favor 🙏</div>
              {(wallet.pay?.cbu || wallet.pay?.alias || wallet.pay?.titular) ? (
                <div className="rounded-lg bg-slate-50 p-2.5 text-xs">
                  {wallet.pay?.cbu && <div className="flex items-center justify-between gap-2 py-0.5"><span className="text-slate-500">CBU/CVU</span><span className="break-all text-right font-semibold text-slate-800">{wallet.pay.cbu}</span></div>}
                  {wallet.pay?.alias && <div className="flex items-center justify-between gap-2 py-0.5"><span className="text-slate-500">Alias</span><span className="break-all text-right font-semibold text-slate-800">{wallet.pay.alias}</span></div>}
                  {wallet.pay?.titular && <div className="flex items-center justify-between gap-2 py-0.5"><span className="text-slate-500">Titular</span><span className="text-right font-semibold text-slate-800">{wallet.pay.titular}</span></div>}
                </div>
              ) : wallet.paymentInfo ? (
                <div className="whitespace-pre-wrap rounded-lg bg-slate-50 p-2.5 text-xs text-slate-700">{wallet.paymentInfo}</div>
              ) : null}
              {(wallet.pay?.cbu || wallet.pay?.alias) && (
                <div className="mt-2 flex flex-col gap-2">
                  {wallet.pay?.cbu && (
                    <button onClick={() => void copy("cbu", wallet.pay!.cbu!)}
                      className={`w-full rounded-lg border py-2.5 text-sm font-bold ${copied === "cbu" ? "border-emerald-500 bg-emerald-500 text-white" : "border-[#1fa855] text-[#1fa855]"}`}>
                      {copied === "cbu" ? "✓ Copiado" : "Copiar CBU"}
                    </button>
                  )}
                  {wallet.pay?.alias && (
                    <button onClick={() => void copy("alias", wallet.pay!.alias!)}
                      className={`w-full rounded-lg border py-2.5 text-sm font-bold ${copied === "alias" ? "border-emerald-500 bg-emerald-500 text-white" : "border-[#1fa855] text-[#1fa855]"}`}>
                      {copied === "alias" ? "✓ Copiado" : "Copiar ALIAS"}
                    </button>
                  )}
                </div>
              )}
              <input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={`Monto a cargar (mín ${money(wallet.minDeposit)})`}
                className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 outline-none focus:border-[#1fa855] [color-scheme:light]" />
              <label className="mt-2 flex cursor-pointer items-center justify-center gap-2 rounded-lg bg-[#1fa855] py-3 text-sm font-bold text-white">
                {comprobante ? "✓ Comprobante listo" : "📎 SUBIR COMPROBANTE"}
                <input type="file" accept="image/*" className="hidden" onChange={onComprobante} />
              </label>
              {cashMsg && <div className="mt-1.5 text-xs text-rose-500">{cashMsg}</div>}
              <div className="mt-2 flex gap-2">
                <button onClick={() => { setDepositCard(false); setCashMsg(null); }}
                  className="rounded-lg border border-slate-300 px-3 py-2.5 text-xs font-semibold text-slate-500">Cancelar</button>
                <button onClick={() => void submitDeposit()} disabled={cashBusy}
                  className="flex-1 rounded-lg bg-[#0b7d6e] py-2.5 text-sm font-bold text-white disabled:opacity-50">{cashBusy ? "Enviando…" : "Ya transferí, avisar"}</button>
              </div>
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {error && <div className="px-4 py-1 text-center text-xs text-rose-600">{error}</div>}

      {/* Botones del bot (chips): tocar = mandar ese texto. Muestra los del último mensaje. */}
      {messages[messages.length - 1]?.buttons?.length ? (
        <div className="flex flex-wrap gap-2 bg-white px-3 pt-2.5">
          {messages[messages.length - 1]!.buttons!.map((b) => (
            <button key={b} type="button" disabled={sending} onClick={() => void sendBody(b)}
              className="rounded-full border border-[#1fa855] bg-white px-3.5 py-1.5 text-sm font-medium text-[#1fa855] hover:bg-emerald-50 disabled:opacity-50">
              {b}
            </button>
          ))}
        </div>
      ) : null}

      {/* Barra del cajero: cargar / retirar / soporte (E3). */}
      {wallet && (
        <div className="flex gap-2 bg-white px-3 pt-2.5">
          <button onClick={() => { setDepositCard(true); setCashier(null); setCashMsg(null); setAmount(""); setComprobante(null); setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), 60); }}
            className="flex-1 rounded-md bg-[#1fa855] py-2 text-sm font-bold text-white">CARGAR</button>
          <button onClick={() => { setCashier("withdrawal"); setDepositCard(false); setCashMsg(null); setAmount(""); }}
            className="flex-1 rounded-md border border-[#1fa855] py-2 text-sm font-bold text-[#1fa855]">RETIRAR</button>
          <button onClick={() => inputRef.current?.focus()}
            className="flex-1 rounded-md border border-[#1fa855] py-2 text-sm font-bold text-[#1fa855]">SOPORTE</button>
        </div>
      )}

      <form onSubmit={send} className="flex items-center gap-2 bg-white p-3" style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}>
        <input ref={inputRef} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Escribí un mensaje…"
          className="flex-1 rounded-full border border-slate-300 bg-slate-100 px-4 py-2.5 text-slate-800 placeholder:text-slate-400 outline-none focus:border-[#1fa855] [color-scheme:light]" />
        <button type="submit" disabled={sending || !draft.trim()} className="flex h-11 w-11 items-center justify-center rounded-full bg-[#1fa855] text-lg text-white disabled:opacity-50">
          ➤
        </button>
      </form>

      {/* Toast de confirmación (carga/retiro enviados). */}
      {cashMsg && !cashier && !depositCard && (
        <div className="fixed left-1/2 top-4 z-[60] max-w-[92%] -translate-x-1/2 rounded-full bg-emerald-600 px-4 py-2 text-center text-sm font-semibold text-white shadow-lg">{cashMsg}</div>
      )}

      {/* Modal RETIRAR */}
      {cashier === "withdrawal" && wallet && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-3 sm:items-center" onClick={() => setCashier(null)}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 text-slate-800" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900">Retirar fichas</h3>
              <button onClick={() => setCashier(null)} className="text-xl text-slate-400">✕</button>
            </div>
            <div className="mb-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-left">
              <div className="text-xs uppercase tracking-wide text-slate-500">Saldo actual</div>
              <div className="text-xl font-bold text-[#1fa855]">{money(wallet.balance)}</div>
            </div>
            <p className="mb-2 text-xs text-slate-500">Retiro mínimo {money(wallet.minWithdrawal)}.</p>
            <input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Monto a retirar"
              className="mb-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base text-slate-800 placeholder:text-slate-400 outline-none focus:border-[#1fa855] [color-scheme:light]" />
            <input value={destino} onChange={(e) => setDestino(e.target.value)} placeholder="Tu CBU / CVU / alias"
              className="mb-3 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base text-slate-800 placeholder:text-slate-400 outline-none focus:border-[#1fa855] [color-scheme:light]" />
            {cashMsg && <p className="mb-2 text-sm text-rose-500">{cashMsg}</p>}
            <button onClick={() => void submitWithdrawal()} disabled={cashBusy}
              className="w-full rounded-xl bg-[#1fa855] py-3 font-extrabold text-white disabled:opacity-50">
              {cashBusy ? "Enviando…" : "Enviar pedido de retiro"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
