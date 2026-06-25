import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, apiError } from "../lib/api";
import { getSocket } from "../lib/socket";
import { fmtDate } from "../lib/format";
import { Button, Input, Card, ErrorMsg } from "../components/ui";

interface Msg { id: string; fromAdmin: boolean; body: string; createdAt: string }

export default function SupportPage() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    try { const { data } = await api.get<{ messages: Msg[] }>("/api/support"); setMessages(data.messages); }
    catch (e) { setError(apiError(e)); }
  };

  useEffect(() => {
    void load();
    const s = getSocket();
    const onMsg = (m: Msg) => setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
    s.on("support:message", onMsg);
    return () => { s.off("support:message", onMsg); };
  }, []);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (!draft.trim()) return;
    try {
      const { data } = await api.post<{ message: Msg }>("/api/support", { body: draft.trim() });
      setMessages((m) => (m.some((x) => x.id === data.message.id) ? m : [...m, data.message]));
      setDraft("");
    } catch (err) { setError(apiError(err)); }
  };

  return (
    <div className="p-6">
      <h1 className="mb-1 text-xl font-bold">Soporte</h1>
      <p className="mb-4 text-sm text-slate-400">¿Necesitás ayuda? Escribinos y te respondemos por acá.</p>
      {error && <div className="mb-3"><ErrorMsg>{error}</ErrorMsg></div>}

      <Card className="flex h-[60vh] max-w-2xl flex-col p-0">
        <div className="flex-1 space-y-2 overflow-y-auto p-4">
          {messages.length === 0 ? (
            <p className="text-sm text-slate-500">Todavía no hay mensajes. Escribinos tu consulta 👇</p>
          ) : messages.map((m) => (
            <div key={m.id} className={`flex ${m.fromAdmin ? "justify-start" : "justify-end"}`}>
              <div className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${m.fromAdmin ? "bg-slate-700 text-slate-100" : "bg-wa-green text-slate-900"}`}>
                {m.fromAdmin && <div className="mb-0.5 text-[10px] font-semibold text-wa-green/90">Soporte Publi</div>}
                <div>{m.body}</div>
                <div className={`mt-1 text-[10px] ${m.fromAdmin ? "text-slate-400" : "text-slate-800/70"}`}>{fmtDate(m.createdAt)}</div>
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
        <form onSubmit={send} className="flex gap-2 border-t border-slate-800 p-3">
          <Input placeholder="Escribí tu mensaje…" value={draft} onChange={(e) => setDraft(e.target.value)} />
          <Button type="submit" disabled={!draft.trim()}>Enviar</Button>
        </form>
      </Card>
    </div>
  );
}
