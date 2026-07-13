// Inbox del Chat App (canal jugador↔cajero) — SEPARADO del Inbox de WhatsApp. Abre un
// SEGUNDO socket al namespace "/chat" SOLO en esta página; no toca el socket default.
import { useEffect, useRef, useState, type FormEvent } from "react";
import { io, type Socket } from "socket.io-client";
import { QRCodeSVG } from "qrcode.react";
import { api, apiError } from "../lib/api";
import { API_BASE } from "../lib/config";
import { Button, Input, Card, ErrorMsg } from "../components/ui";

const CHAT_PWA_URL = (import.meta.env.VITE_CHAT_PWA_URL as string | undefined) ?? "https://chat.publi.lat";

interface Conv { id: string; player: string; username: string; status: string; unread: number; preview: string; lastAt: string }
interface Msg { id: string; senderType: "player" | "operator" | "system"; body: string | null; metadata?: Record<string, unknown>; createdAt: string }
interface Invite { id: string; code: string; label: string | null; isActive: boolean; createdAt: string }

// Agrega un mensaje evitando duplicados por id (optimistic add + echo del socket).
function appendUnique(list: Msg[], m: Msg): Msg[] {
  if (list.some((x) => x.id === m.id)) return list;
  return [...list, m];
}

export default function ChatAppPage() {
  const [tab, setTab] = useState<"chats" | "invites">("chats");
  const [convs, setConvs] = useState<Conv[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const selectedRef = useRef<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  selectedRef.current = selected;

  const loadConvs = async () => {
    try { const { data } = await api.get<{ conversations: Conv[] }>("/api/chat/conversations"); setConvs(data.conversations); }
    catch (e) { setError(apiError(e)); }
  };
  const openConv = async (id: string) => {
    setSelected(id); setError(null);
    try {
      const { data } = await api.get<{ messages: Msg[] }>(`/api/chat/conversations/${id}/messages`);
      setMessages(data.messages);
      setConvs((prev) => prev.map((c) => (c.id === id ? { ...c, unread: 0 } : c)));
    } catch (e) { setError(apiError(e)); }
  };

  useEffect(() => { void loadConvs(); }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  // SEGUNDO socket, al namespace /chat, SOLO en esta sección. Cookie del operador (withCredentials).
  useEffect(() => {
    const socket: Socket = io(`${API_BASE}/chat`, { withCredentials: true });
    const onMsg = (p: { conversationId: string; message: Msg }) => {
      if (p.conversationId === selectedRef.current) {
        setMessages((prev) => appendUnique(prev, p.message)); // dedup por id
      }
      void loadConvs(); // refresca previews / no-leídos
    };
    socket.on("chat:message", onMsg);
    return () => { socket.off("chat:message", onMsg); socket.disconnect(); };
  }, []);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    const body = draft.trim();
    if (!body || !selected) return;
    setSending(true); setError(null);
    try {
      const { data } = await api.post<{ message: Msg }>("/api/chat/messages", { conversationId: selected, body });
      setMessages((prev) => appendUnique(prev, data.message)); // optimistic; el echo del socket se deduplica
      setDraft("");
      void loadConvs();
    } catch (e) { setError(apiError(e)); } finally { setSending(false); }
  };

  const current = convs.find((c) => c.id === selected);

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Chat</h1>
          <p className="text-sm text-slate-400">Canal directo con tus jugadores (app instalable). Separado del WhatsApp.</p>
        </div>
        <div className="inline-flex rounded-md bg-slate-900 p-1 text-sm">
          <button onClick={() => setTab("chats")} className={`rounded px-3 py-1 font-medium ${tab === "chats" ? "bg-wa-green text-slate-900" : "text-slate-300"}`}>Conversaciones</button>
          <button onClick={() => setTab("invites")} className={`rounded px-3 py-1 font-medium ${tab === "invites" ? "bg-wa-green text-slate-900" : "text-slate-300"}`}>Mi Invitación</button>
        </div>
      </div>

      {error && <div className="mb-3"><ErrorMsg>{error}</ErrorMsg></div>}

      {tab === "chats" ? (
        <div className="flex h-[calc(100vh-11rem)] gap-4">
          {/* Lista */}
          <div className="flex w-80 shrink-0 flex-col overflow-hidden rounded-lg border border-slate-800">
            <div className="border-b border-slate-800 px-4 py-3 text-xs text-slate-500">{convs.length} conversaciones</div>
            <div className="flex-1 overflow-y-auto">
              {convs.length === 0 ? <p className="p-4 text-sm text-slate-500">Todavía no hay jugadores. Compartí tu link en "Mi Invitación".</p> :
                convs.map((c) => (
                  <button key={c.id} onClick={() => void openConv(c.id)}
                    className={`flex w-full items-start gap-3 border-b border-slate-800/60 px-4 py-3 text-left transition ${selected === c.id ? "bg-slate-800" : "hover:bg-slate-800/50"}`}>
                    <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold ${c.unread > 0 ? "bg-wa-green text-slate-900" : "bg-slate-700 text-slate-200"}`}>
                      {c.unread > 0 ? c.unread : (c.player || "?").charAt(0).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-slate-100">{c.player}</span>
                      <span className="mt-0.5 block truncate text-xs text-slate-400">{c.preview || "—"}</span>
                    </span>
                  </button>
                ))}
            </div>
          </div>

          {/* Hilo */}
          <div className="flex flex-1 flex-col overflow-hidden rounded-lg border border-slate-800">
            {!selected ? (
              <div className="flex flex-1 items-center justify-center text-slate-500">Elegí una conversación.</div>
            ) : (
              <>
                <div className="border-b border-slate-800 px-4 py-3 text-sm font-semibold text-slate-100">{current?.player} <span className="text-xs font-normal text-slate-500">· {current?.username}</span></div>
                <div className="flex-1 space-y-2 overflow-y-auto p-4">
                  {messages.map((m) => (
                    <div key={m.id} className={`flex ${m.senderType === "operator" ? "justify-end" : m.senderType === "system" ? "justify-center" : "justify-start"}`}>
                      <div className={`max-w-[70%] rounded-lg px-3 py-2 text-sm ${m.senderType === "operator" ? "bg-wa-green text-slate-900" : m.senderType === "system" ? "bg-slate-800 text-slate-400 text-xs italic" : "bg-slate-700 text-slate-100"}`}>
                        {m.body}
                      </div>
                    </div>
                  ))}
                  <div ref={endRef} />
                </div>
                <form onSubmit={send} className="flex items-center gap-2 border-t border-slate-800 p-3">
                  <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Escribí un mensaje…" className="flex-1" />
                  <Button type="submit" disabled={sending || !draft.trim()}>{sending ? "…" : "Enviar"}</Button>
                </form>
              </>
            )}
          </div>
        </div>
      ) : (
        <InvitesTab />
      )}
    </div>
  );
}

// Sub-sección "Mi Invitación": crear/listar/borrar links single-use + QR.
function InvitesTab() {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = async () => {
    try { const { data } = await api.get<{ invites: Invite[] }>("/api/chat/invites"); setInvites(data.invites); }
    catch (e) { setError(apiError(e)); }
  };
  useEffect(() => { void load(); }, []);

  const create = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try { await api.post("/api/chat/invites", { label: label.trim() || undefined }); setLabel(""); await load(); }
    catch (e) { setError(apiError(e)); } finally { setBusy(false); }
  };
  const remove = async (id: string) => {
    try { await api.delete(`/api/chat/invites/${id}`); await load(); } catch (e) { setError(apiError(e)); }
  };
  const linkFor = (code: string) => `${CHAT_PWA_URL}/i/${code}`;
  const copy = async (code: string) => {
    try { await navigator.clipboard.writeText(linkFor(code)); setCopied(code); setTimeout(() => setCopied(null), 1500); } catch { /* noop */ }
  };

  return (
    <div className="max-w-3xl">
      {error && <div className="mb-3"><ErrorMsg>{error}</ErrorMsg></div>}
      <Card className="mb-5">
        <div className="mb-2 text-sm font-semibold text-slate-100">Nuevo link de invitación</div>
        <p className="mb-3 text-xs text-slate-500">Cada link sirve para registrar a UN jugador. Compartilo (link o QR); cuando se registra, se cierra solo.</p>
        <form onSubmit={create} className="flex items-center gap-2">
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Etiqueta (opcional, ej: Juan de Facebook)" className="flex-1" />
          <Button type="submit" disabled={busy}>{busy ? "…" : "Crear link"}</Button>
        </form>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2">
        {invites.map((inv) => (
          <Card key={inv.id}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-semibold text-slate-100">{inv.label || "Sin etiqueta"}</div>
                <div className={`text-xs font-medium ${inv.isActive ? "text-wa-green" : "text-slate-500"}`}>{inv.isActive ? "● Sin usar" : "○ Ya usado"}</div>
                <code className="mt-1 block break-all text-[11px] text-slate-400">{linkFor(inv.code)}</code>
              </div>
              {inv.isActive && (
                <div className="shrink-0 rounded bg-white p-1.5">
                  <QRCodeSVG value={linkFor(inv.code)} size={72} />
                </div>
              )}
            </div>
            <div className="mt-3 flex gap-2">
              <Button variant="secondary" onClick={() => void copy(inv.code)}>{copied === inv.code ? "¡Copiado!" : "Copiar link"}</Button>
              <Button variant="danger" onClick={() => void remove(inv.id)}>Borrar</Button>
            </div>
          </Card>
        ))}
        {invites.length === 0 && <p className="text-sm text-slate-500">No tenés links todavía. Creá uno arriba.</p>}
      </div>
    </div>
  );
}
