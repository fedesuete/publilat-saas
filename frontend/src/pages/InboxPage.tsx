import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, apiError } from "../lib/api";
import { getSocket, type InboxMessagePayload } from "../lib/socket";
import type { Lead, Msg } from "../lib/types";
import { fmtDate } from "../lib/format";
import { Button, Input, StageBadge, ErrorMsg } from "../components/ui";

function contactLabel(lead: Lead): string {
  return lead.name || lead.code || lead.externalId.slice(0, 8);
}

export default function InboxPage() {
  const [contacts, setContacts] = useState<Lead[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [listError, setListError] = useState<string | null>(null);
  const [chatError, setChatError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const selectedRef = useRef<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  selectedRef.current = selected;

  const loadContacts = async () => {
    try {
      const { data } = await api.get<{ leads: Lead[] }>("/api/leads");
      setContacts(data.leads);
    } catch (err) {
      setListError(apiError(err));
    }
  };

  useEffect(() => {
    void loadContacts();
  }, []);

  useEffect(() => {
    const socket = getSocket();
    const onMessage = (payload: InboxMessagePayload) => {
      if (payload.contactId === selectedRef.current) {
        setMessages((prev) => [...prev, payload.message]);
      }
      void loadContacts();
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
      const { data } = await api.post<{ message: Msg }>(
        `/api/inbox/${selected}/messages`,
        { body }
      );
      setMessages((prev) => [...prev, data.message]);
      setDraft("");
    } catch (err) {
      setChatError(apiError(err));
    } finally {
      setSending(false);
    }
  };

  const current = contacts.find((c) => c.id === selected);

  return (
    <div className="flex h-screen">
      <div className="flex w-72 flex-col border-r border-slate-800">
        <div className="border-b border-slate-800 px-4 py-3">
          <h1 className="font-bold">Inbox</h1>
        </div>
        {listError && (
          <div className="p-3">
            <ErrorMsg>{listError}</ErrorMsg>
          </div>
        )}
        <div className="flex-1 overflow-y-auto">
          {contacts.length === 0 ? (
            <p className="p-4 text-sm text-slate-500">No hay contactos aún.</p>
          ) : (
            contacts.map((c) => (
              <button
                key={c.id}
                onClick={() => setSelected(c.id)}
                className={`flex w-full items-center justify-between gap-2 border-b border-slate-800/60 px-4 py-3 text-left transition ${
                  selected === c.id ? "bg-slate-800" : "hover:bg-slate-800/50"
                }`}
              >
                <span className="truncate text-sm">{contactLabel(c)}</span>
                <StageBadge stage={c.stage} />
              </button>
            ))
          )}
        </div>
      </div>

      <div className="flex flex-1 flex-col">
        {!selected ? (
          <div className="flex flex-1 items-center justify-center text-slate-500">
            Seleccioná un contacto para ver la conversación.
          </div>
        ) : (
          <>
            <div className="border-b border-slate-800 px-4 py-3">
              <div className="font-semibold">
                {current ? contactLabel(current) : "Conversación"}
              </div>
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
                    {m.mediaUrl && (
                      <a href={m.mediaUrl} target="_blank" rel="noopener noreferrer">
                        <img
                          src={m.mediaUrl}
                          alt="Imagen"
                          className="mb-1 max-h-64 w-full rounded-md object-cover"
                        />
                      </a>
                    )}
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
                placeholder="Escribí un mensaje…"
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
