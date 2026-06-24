import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, apiError } from "../lib/api";
import { getSocket, type InboxMessagePayload } from "../lib/socket";
import type { Msg, Stage } from "../lib/types";
import { fmtDate } from "../lib/format";
import { Button, Input, StageBadge, ErrorMsg } from "../components/ui";

interface Conversation {
  id: string;
  label: string;
  stage: Stage;
  line: string | null;
  preview: string;
  lastAt: string;
  unread: number;
}

// Hora corta para la lista (HH:MM).
const shortTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });

export default function InboxPage() {
  const [convs, setConvs] = useState<Conversation[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [listError, setListError] = useState<string | null>(null);
  const [chatError, setChatError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const selectedRef = useRef<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  selectedRef.current = selected;

  const loadConvs = async () => {
    try {
      const { data } = await api.get<{ conversations: Conversation[] }>("/api/inbox/conversations");
      setConvs(data.conversations);
    } catch (err) {
      setListError(apiError(err));
    }
  };

  useEffect(() => {
    void loadConvs();
  }, []);

  useEffect(() => {
    const socket = getSocket();
    const onMessage = (payload: InboxMessagePayload) => {
      if (payload.contactId === selectedRef.current) {
        setMessages((prev) => [...prev, payload.message]);
      }
      void loadConvs();
    };
    socket.on("inbox:message", onMessage);
    return () => {
      socket.off("inbox:message", onMessage);
    };
  }, []);

  useEffect(() => {
    if (!selected) return;
    setChatError(null);
    setMessages([]);
    // Al abrir, marcamos como leído en la lista (visual).
    setConvs((prev) => prev.map((c) => (c.id === selected ? { ...c, unread: 0 } : c)));
    api
      .get<{ messages: Msg[] }>(`/api/inbox/${selected}/messages`)
      .then(({ data }) => setMessages(data.messages))
      .catch((err) => setChatError(apiError(err)));
  }, [selected]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (!selected || !draft.trim()) return;
    setSending(true);
    setChatError(null);
    const body = draft.trim();
    try {
      const { data } = await api.post<{ message: Msg }>(`/api/inbox/${selected}/messages`, { body });
      setMessages((prev) => [...prev, data.message]);
      setDraft("");
      void loadConvs();
    } catch (err) {
      setChatError(apiError(err));
    } finally {
      setSending(false);
    }
  };

  const current = convs.find((c) => c.id === selected);

  return (
    <div className="flex h-screen">
      <div className="flex w-80 flex-col border-r border-slate-800">
        <div className="border-b border-slate-800 px-4 py-3">
          <h1 className="font-bold">WhatsApp Inbox</h1>
          <div className="text-xs text-slate-500">{convs.length} conversaciones</div>
        </div>
        {listError && (
          <div className="p-3">
            <ErrorMsg>{listError}</ErrorMsg>
          </div>
        )}
        <div className="flex-1 overflow-y-auto">
          {convs.length === 0 ? (
            <p className="p-4 text-sm text-slate-500">No hay conversaciones aún.</p>
          ) : (
            convs.map((c) => (
              <button
                key={c.id}
                onClick={() => setSelected(c.id)}
                className={`flex w-full items-start gap-3 border-b border-slate-800/60 px-4 py-3 text-left transition ${
                  selected === c.id ? "bg-slate-800" : "hover:bg-slate-800/50"
                }`}
              >
                {/* avatar / contador de no-leídos */}
                <span
                  className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                    c.unread > 0 ? "bg-wa-green text-slate-900" : "bg-slate-700 text-slate-200"
                  }`}
                >
                  {c.unread > 0 ? c.unread : c.label.charAt(0).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-slate-100">{c.label}</span>
                    <span className="shrink-0 text-[10px] text-slate-500">{shortTime(c.lastAt)}</span>
                  </span>
                  {c.line && <span className="block truncate text-[10px] text-slate-500">vía {c.line}</span>}
                  <span className="mt-0.5 flex items-center gap-2">
                    <span className="truncate text-xs text-slate-400">{c.preview || "—"}</span>
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      </div>

      <div className="flex flex-1 flex-col">
        {!selected ? (
          <div className="flex flex-1 items-center justify-center text-slate-500">
            Seleccioná una conversación para verla.
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
              <div>
                <div className="font-semibold">{current ? current.label : "Conversación"}</div>
                {current?.line && <div className="text-xs text-slate-500">vía {current.line}</div>}
              </div>
              {current && <StageBadge stage={current.stage} />}
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto bg-slate-900/40 p-4">
              {chatError && <ErrorMsg>{chatError}</ErrorMsg>}
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={`flex ${m.direction === "out" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[70%] rounded-lg px-3 py-2 text-sm ${
                      m.direction === "out"
                        ? "bg-wa-green text-slate-900"
                        : "bg-slate-700 text-slate-100"
                    }`}
                  >
                    {m.mediaUrl &&
                      (m.mediaUrl.startsWith("data:application/pdf") ? (
                        <a
                          href={m.mediaUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mb-1 flex items-center gap-2 rounded-md bg-black/20 px-3 py-2 font-medium underline"
                        >
                          📄 Abrir comprobante (PDF)
                        </a>
                      ) : (
                        <a href={m.mediaUrl} target="_blank" rel="noopener noreferrer">
                          <img
                            src={m.mediaUrl}
                            alt="Imagen"
                            className="mb-1 max-h-64 w-full rounded-md object-cover"
                          />
                        </a>
                      ))}
                    {m.body && <div>{m.body}</div>}
                    {!m.body && !m.mediaUrl && <div className="italic opacity-60">[mensaje no soportado]</div>}
                    <div
                      className={`mt-1 text-[10px] ${
                        m.direction === "out" ? "text-slate-800/70" : "text-slate-400"
                      }`}
                    >
                      {fmtDate(m.createdAt)}
                    </div>
                  </div>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>
            <form onSubmit={send} className="flex gap-2 border-t border-slate-800 p-3">
              <Input
                placeholder="Escribí un mensaje… (Enter para enviar)"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
              <Button type="submit" disabled={sending || !draft.trim()}>
                {sending ? "…" : "Enviar"}
              </Button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
