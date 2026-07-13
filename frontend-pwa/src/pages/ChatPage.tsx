import { useEffect, useRef, useState, type FormEvent } from "react";
import { io, type Socket } from "socket.io-client";
import { api, apiError, API_BASE, getToken, clearToken, loadBranding } from "../lib/api";

interface Msg { id: string; senderType: "player" | "operator" | "system"; body: string | null; createdAt: string }

function appendUnique(list: Msg[], m: Msg): Msg[] {
  return list.some((x) => x.id === m.id) ? list : [...list, m];
}

export default function ChatPage() {
  const branding = loadBranding();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
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

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  // Socket al namespace /chat con el JWT client como auth (Bearer va aparte en las requests HTTP).
  useEffect(() => {
    const token = getToken();
    if (!token) return;
    const socket: Socket = io(`${API_BASE}/chat`, { auth: { token } });
    const onMsg = (p: { message: Msg }) => setMessages((prev) => appendUnique(prev, p.message)); // dedup por id
    socket.on("chat:message", onMsg);
    return () => { socket.off("chat:message", onMsg); socket.disconnect(); };
  }, []);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    const body = draft.trim();
    if (!body) return;
    setSending(true); setError(null);
    try {
      const { data } = await api.post<{ message: Msg }>("/api/chat/me/messages", { body });
      setMessages((prev) => appendUnique(prev, data.message)); // optimistic; el echo se deduplica
      setDraft("");
    } catch (e) { setError(apiError(e)); } finally { setSending(false); }
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-slate-800 px-4 py-3">
        {branding?.logoUrl && <img src={branding.logoUrl} alt="" className="h-8 w-8 rounded-lg object-cover" />}
        <div className="font-semibold">{branding?.brandName || "Chat"}</div>
      </header>

      <div className="flex-1 space-y-2 overflow-y-auto p-4">
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.senderType === "player" ? "justify-end" : m.senderType === "system" ? "justify-center" : "justify-start"}`}>
            <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
              m.senderType === "player" ? "text-slate-900" : m.senderType === "system" ? "bg-slate-800 text-slate-400 text-xs italic" : "bg-slate-700 text-slate-100"
            }`} style={m.senderType === "player" ? { background: "var(--brand-primary)" } : undefined}>
              {m.body}
            </div>
          </div>
        ))}
        {messages.length === 0 && <p className="mt-8 text-center text-sm text-slate-500">Escribinos, te respondemos al toque.</p>}
        <div ref={endRef} />
      </div>

      {error && <div className="px-4 py-1 text-center text-xs text-rose-400">{error}</div>}

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
