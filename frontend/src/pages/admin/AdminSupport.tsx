import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, apiError } from "../../lib/api";
import { getSocket } from "../../lib/socket";
import { fmtDate } from "../../lib/format";
import { Button, Input, ErrorMsg } from "../../components/ui";

interface Thread { userId: string; email: string; name: string | null; last: string; lastAt: string; unread: number }
interface Msg { id: string; userId: string; fromAdmin: boolean; body: string; createdAt: string }

export default function AdminSupport() {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const selRef = useRef<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  selRef.current = sel;

  const loadThreads = async () => {
    try { const { data } = await api.get<{ threads: Thread[] }>("/api/admin/support"); setThreads(data.threads); }
    catch (e) { setError(apiError(e)); }
  };
  const openThread = async (userId: string) => {
    setSel(userId);
    try { const { data } = await api.get<{ messages: Msg[] }>(`/api/admin/support/${userId}`); setMessages(data.messages); await loadThreads(); }
    catch (e) { setError(apiError(e)); }
  };

  useEffect(() => { void loadThreads(); }, []);
  useEffect(() => {
    const s = getSocket();
    const onIncoming = (p: { userId: string; message: Msg }) => {
      if (p.userId === selRef.current) setMessages((m) => [...m, p.message]);
      void loadThreads();
    };
    s.on("support:incoming", onIncoming);
    return () => { s.off("support:incoming", onIncoming); };
  }, []);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const reply = async (e: FormEvent) => {
    e.preventDefault();
    if (!sel || !draft.trim()) return;
    try {
      const { data } = await api.post<{ message: Msg }>(`/api/admin/support/${sel}/reply`, { body: draft.trim() });
      setMessages((m) => [...m, data.message]); setDraft("");
    } catch (err) { setError(apiError(err)); }
  };

  const current = threads.find((t) => t.userId === sel);

  return (
    <div className="flex h-screen">
      <div className="flex w-80 flex-col border-r border-slate-800">
        <div className="border-b border-slate-800 px-4 py-3"><h1 className="font-bold">Soporte</h1><div className="text-xs text-slate-500">{threads.length} conversaciones</div></div>
        {error && <div className="p-3"><ErrorMsg>{error}</ErrorMsg></div>}
        <div className="flex-1 overflow-y-auto">
          {threads.length === 0 ? <p className="p-4 text-sm text-slate-500">Nadie escribió todavía.</p> : threads.map((t) => (
            <button key={t.userId} onClick={() => void openThread(t.userId)} className={`flex w-full items-start gap-3 border-b border-slate-800/60 px-4 py-3 text-left transition ${sel === t.userId ? "bg-slate-800" : "hover:bg-slate-800/50"}`}>
              <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold ${t.unread > 0 ? "bg-wa-green text-slate-900" : "bg-slate-700 text-slate-200"}`}>{t.unread > 0 ? t.unread : (t.name || t.email).charAt(0).toUpperCase()}</span>
              <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-slate-100">{t.name || t.email}</span><span className="block truncate text-xs text-slate-400">{t.last}</span></span>
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-1 flex-col">
        {!sel ? <div className="flex flex-1 items-center justify-center text-slate-500">Elegí una conversación.</div> : (
          <>
            <div className="border-b border-slate-800 px-4 py-3 font-semibold">{current?.name || current?.email || "Conversación"}</div>
            <div className="flex-1 space-y-2 overflow-y-auto bg-slate-900/40 p-4">
              {messages.map((m) => (
                <div key={m.id} className={`flex ${m.fromAdmin ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[70%] rounded-lg px-3 py-2 text-sm ${m.fromAdmin ? "bg-wa-green text-slate-900" : "bg-slate-700 text-slate-100"}`}>
                    <div>{m.body}</div>
                    <div className={`mt-1 text-[10px] ${m.fromAdmin ? "text-slate-800/70" : "text-slate-400"}`}>{fmtDate(m.createdAt)}</div>
                  </div>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>
            <form onSubmit={reply} className="flex gap-2 border-t border-slate-800 p-3">
              <Input placeholder="Responder al cliente…" value={draft} onChange={(e) => setDraft(e.target.value)} />
              <Button type="submit" disabled={!draft.trim()}>Enviar</Button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
