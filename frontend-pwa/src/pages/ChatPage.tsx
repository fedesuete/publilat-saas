import { useEffect, useRef, useState, type FormEvent } from "react";
import { io, type Socket } from "socket.io-client";
import { api, apiError, API_BASE, getToken, clearToken, loadBranding } from "../lib/api";
import { subscribeToPush, pushSupported, pushPermission } from "../lib/push";
import InstallPrompt from "../components/InstallPrompt";

interface Msg { id: string; senderType: "player" | "operator" | "system"; body: string | null; image?: string | null; buttons?: string[] | null; createdAt: string }
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
    socket.on("chat:message", onMsg);
    return () => { socket.off("chat:message", onMsg); socket.disconnect(); };
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
      </header>

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

      <div className="flex-1 space-y-2 overflow-y-auto p-4">
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.senderType === "player" ? "justify-end" : m.senderType === "system" ? "justify-center" : "justify-start"}`}>
            <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
              m.senderType === "player" ? "text-slate-900" : m.senderType === "system" ? "bg-slate-800 text-slate-400 text-xs italic" : "bg-slate-700 text-slate-100"
            }`} style={m.senderType === "player" ? { background: "var(--brand-primary)" } : undefined}>
              {m.image && (
                <a href={m.image} target="_blank" rel="noopener noreferrer">
                  <img src={m.image} alt="" className="mb-1.5 max-h-72 w-full rounded-md object-cover" />
                </a>
              )}
              {m.body && <div className="whitespace-pre-wrap break-words">{m.body}</div>}
            </div>
          </div>
        ))}
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

      <form onSubmit={send} className="flex items-center gap-2 border-t border-slate-800 p-3" style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}>
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Escribí un mensaje…"
          className="flex-1 rounded-full border border-slate-700 bg-slate-900 px-4 py-2.5 outline-none" />
        <button type="submit" disabled={sending || !draft.trim()} className="rounded-full px-5 py-2.5 font-semibold text-slate-900 disabled:opacity-50" style={{ background: "var(--brand-primary)" }}>
          →
        </button>
      </form>
    </div>
  );
}
