import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { ArrowLeft, PanelLeftClose, PanelLeftOpen, Smile, Mic, Square, MessageSquareText, Music, Upload, Trash2, Send, X } from "lucide-react";
import { api, apiError } from "../lib/api";
import { getSocket, type InboxMessagePayload, type InboxMessageStatusPayload } from "../lib/socket";
import type { Msg, Stage } from "../lib/types";
import { fmtDate } from "../lib/format";
import { Button, StageBadge, ErrorMsg } from "../components/ui";

interface Conversation {
  id: string;
  name: string | null;
  number: string;
  label: string;
  stage: Stage;
  line: string | null;
  preview: string;
  lastAt: string;
  unread: number;
}
interface QuickReply { id: string; title: string; body: string }
interface AudioClip { id: string; title: string; contentType: string; createdAt: string }
interface Tpl { name: string; language: string; category?: string; bodyParams: number }

const shortTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });

// Agrega un mensaje sólo si su id no está ya en la lista (evita el duplicado salida POST + socket).
const appendUnique = (prev: Msg[], m: Msg) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]);

// Tildes de estado del mensaje saliente (ack REAL de WhatsApp, no optimista).
function AckTicks({ status }: { status?: Msg["status"] }) {
  if (status === "failed") return null; // el fallo se muestra aparte, en rojo
  if (status === "read") return <span className="font-bold text-sky-700" title="Leído">✓✓</span>;
  if (status === "delivered") return <span title="Entregado">✓✓</span>;
  return <span title="Enviado">✓</span>; // sent (o mensajes previos al tracking)
}

const EMOJIS = ["😀","😅","😂","🤣","😊","😍","😘","😎","🤩","🥳","👍","🙏","🙌","👏","💪","🔥","✨","🎉","🎁","💯","❤️","💚","💙","✅","❌","⚠️","⏰","📞","📲","💬","🤝","🙋","😉","😜","🤔","😢","😭","😡","🥰","😴","💰","💵","🏦","🛒","📷","🎤","📄"];

// Fila de un audio guardado: nombre + "Escuchar" (carga el blob autenticado bajo demanda) + Enviar + borrar.
function ClipRow({ clip, disabled, onSend, onDelete }: {
  clip: AudioClip;
  disabled: boolean;
  onSend: (id: string) => void | Promise<void>;
  onDelete: (id: string) => void | Promise<void>;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const play = async () => {
    if (url) return;
    setLoading(true);
    try {
      const { data } = await api.get(`/api/inbox/audio-clips/${clip.id}/audio`, { responseType: "blob" });
      setUrl(URL.createObjectURL(data as Blob));
    } catch { /* noop */ } finally { setLoading(false); }
  };
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  return (
    <div className="group rounded px-2 py-1.5 hover:bg-slate-800">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-slate-200">{clip.title}</span>
        <button type="button" disabled={disabled} onClick={() => void onSend(clip.id)} className="rounded bg-wa-green px-2.5 py-1 text-[11px] font-semibold text-slate-900 disabled:opacity-50">Enviar</button>
        <button type="button" onClick={() => void onDelete(clip.id)} className="text-slate-500 opacity-0 transition group-hover:opacity-100 hover:text-rose-400">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      {url ? (
        <audio controls src={url} className="mt-1.5 h-8 w-full" />
      ) : (
        <button type="button" onClick={() => void play()} className="mt-1 text-[11px] text-slate-400 hover:text-white">{loading ? "cargando…" : "▶ Escuchar"}</button>
      )}
    </div>
  );
}

export default function InboxPage() {
  const [convs, setConvs] = useState<Conversation[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [listError, setListError] = useState<string | null>(null);
  const [chatError, setChatError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [listOpen, setListOpen] = useState(true);
  const [showEmoji, setShowEmoji] = useState(false);
  const [showQuick, setShowQuick] = useState(false);
  const [quick, setQuick] = useState<QuickReply[]>([]);
  const [qForm, setQForm] = useState<{ title: string; body: string } | null>(null); // editor multilínea de mensaje guardado
  const [showAudios, setShowAudios] = useState(false);
  const [audioClips, setAudioClips] = useState<AudioClip[]>([]);
  const [recording, setRecording] = useState(false);
  const [needTemplate, setNeedTemplate] = useState(false);
  const [templates, setTemplates] = useState<Tpl[]>([]);
  const [tplInputs, setTplInputs] = useState<Record<string, string[]>>({});
  const selectedRef = useRef<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recTargetRef = useRef<"chat" | "lib">("chat"); // destino de la grabación en curso
  const fileRef = useRef<HTMLInputElement>(null); // input oculto para subir audios a la biblioteca
  const draftRef = useRef<HTMLTextAreaElement>(null); // compositor (para auto-alto)
  selectedRef.current = selected;

  const loadConvs = async () => {
    try {
      const { data } = await api.get<{ conversations: Conversation[] }>("/api/inbox/conversations");
      setConvs(data.conversations);
    } catch (err) { setListError(apiError(err)); }
  };
  const loadQuick = async () => {
    try { const { data } = await api.get<{ items: QuickReply[] }>("/api/inbox/quick-replies"); setQuick(data.items); }
    catch { /* noop */ }
  };
  const loadAudioClips = async () => {
    try { const { data } = await api.get<{ items: AudioClip[] }>("/api/inbox/audio-clips"); setAudioClips(data.items); }
    catch { /* noop */ }
  };

  useEffect(() => { void loadConvs(); void loadQuick(); void loadAudioClips(); }, []);

  useEffect(() => {
    const socket = getSocket();
    const onMessage = (payload: InboxMessagePayload) => {
      if (payload.contactId === selectedRef.current) setMessages((prev) => appendUnique(prev, payload.message));
      void loadConvs();
    };
    // Ack real de WhatsApp (entregado / leído / rechazado) sobre un mensaje ya mostrado.
    const onStatus = (p: InboxMessageStatusPayload) => {
      if (p.contactId !== selectedRef.current) return;
      setMessages((prev) => prev.map((m) => (m.id === p.messageId ? { ...m, status: p.status, error: p.error } : m)));
    };
    socket.on("inbox:message", onMessage);
    socket.on("inbox:message-status", onStatus);
    return () => { socket.off("inbox:message", onMessage); socket.off("inbox:message-status", onStatus); };
  }, []);

  useEffect(() => {
    if (!selected) return;
    setChatError(null); setMessages([]); setShowEmoji(false); setShowQuick(false); setShowAudios(false); setNeedTemplate(false); setTemplates([]);
    setConvs((prev) => prev.map((c) => (c.id === selected ? { ...c, unread: 0 } : c)));
    api.get<{ messages: Msg[] }>(`/api/inbox/${selected}/messages`)
      .then(({ data }) => setMessages(data.messages))
      .catch((err) => setChatError(apiError(err)));
  }, [selected]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  // Auto-alto del compositor (crece con los saltos de línea, hasta un tope) — cubre escribir,
  // pegar, insertar un mensaje guardado y el reset al enviar.
  useEffect(() => {
    const t = draftRef.current;
    if (!t) return;
    t.style.height = "auto";
    t.style.height = Math.min(t.scrollHeight, 140) + "px";
  }, [draft]);

  const send = async (e?: { preventDefault?: () => void }) => {
    e?.preventDefault?.();
    if (!selected || !draft.trim()) return;
    setSending(true); setChatError(null);
    const body = draft.trim();
    try {
      const { data } = await api.post<{ message: Msg }>(`/api/inbox/${selected}/messages`, { body });
      setMessages((prev) => appendUnique(prev, data.message));
      setDraft(""); setShowEmoji(false); setShowQuick(false); setShowAudios(false);
      void loadConvs();
    } catch (err) {
      setChatError(apiError(err));
      // 409 fuera de la ventana de 24h -> ofrecer plantillas para reabrir.
      const r = (err as { response?: { status?: number; data?: { requiresTemplate?: boolean } } })?.response;
      if (r?.status === 409 && r.data?.requiresTemplate) void loadTemplates();
    } finally { setSending(false); }
  };

  const loadTemplates = async () => {
    if (!selectedRef.current) return;
    try {
      const { data } = await api.get<{ templates: Tpl[] }>(`/api/inbox/${selectedRef.current}/templates`);
      setTemplates(data.templates);
      setNeedTemplate(true);
    } catch (err) { setChatError(apiError(err)); }
  };

  const sendTemplate = async (t: Tpl, params: string[]) => {
    if (!selected) return;
    try {
      const { data } = await api.post<{ message: Msg }>(`/api/inbox/${selected}/template`, {
        name: t.name, language: t.language, params: params.length ? params : undefined,
      });
      setMessages((prev) => appendUnique(prev, data.message));
      setNeedTemplate(false); setTemplates([]); setDraft("");
      void loadConvs();
    } catch (err) { setChatError(apiError(err)); }
  };

  // --- Grabación de audio (target "chat" = enviar al toque; "lib" = guardar en la biblioteca) ---
  const startRec = async (target: "chat" | "lib" = "chat") => {
    setChatError(null);
    recTargetRef.current = target;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/ogg;codecs=opus")
        ? "audio/ogg;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "";
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (ev) => { if (ev.data.size) chunksRef.current.push(ev.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: rec.mimeType });
        // Grabación vacía o muy corta (tap instantáneo / micrófono que no capturó): NO la mandamos,
        // porque llega vacía y ffmpeg la rechaza ("Invalid data"). Avisamos para regrabar.
        if (blob.size < 1200) {
          setChatError("La grabación salió vacía o muy corta. Tocá el micrófono, hablá unos segundos y recién ahí detené.");
          setRecording(false);
          return;
        }
        const dataUrl: string = await new Promise((resolve) => {
          const fr = new FileReader();
          fr.onloadend = () => resolve(String(fr.result));
          fr.readAsDataURL(blob);
        });
        if (recTargetRef.current === "lib") { await saveClip(dataUrl); return; }
        if (!selectedRef.current) return;
        try {
          const { data } = await api.post<{ message: Msg }>(`/api/inbox/${selectedRef.current}/audio`, { audio: dataUrl });
          setMessages((prev) => appendUnique(prev, data.message));
          void loadConvs();
        } catch (err) { setChatError(apiError(err)); }
      };
      recRef.current = rec;
      rec.start();
      setRecording(true);
    } catch { setChatError("No pude acceder al micrófono. Revisá los permisos del navegador."); }
  };
  const stopRec = () => { recRef.current?.stop(); setRecording(false); };

  // --- Biblioteca de audios ---
  // Guarda un audio (data URL) en la biblioteca, pidiendo un nombre.
  const saveClip = async (dataUrl: string, suggested = "") => {
    const title = window.prompt("Nombre del audio (ej: Bienvenida):", suggested)?.trim();
    if (!title) return;
    try { await api.post("/api/inbox/audio-clips", { title, audio: dataUrl }); await loadAudioClips(); }
    catch (err) { setChatError(apiError(err)); }
  };
  const onFilePicked = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // permite volver a elegir el mismo archivo
    if (!file) return;
    const dataUrl: string = await new Promise((resolve) => {
      const fr = new FileReader();
      fr.onloadend = () => resolve(String(fr.result));
      fr.readAsDataURL(file);
    });
    await saveClip(dataUrl, file.name.replace(/\.[^.]+$/, ""));
  };
  const delClip = async (id: string) => {
    if (!window.confirm("¿Borrar este audio de la biblioteca?")) return;
    try { await api.delete(`/api/inbox/audio-clips/${id}`); await loadAudioClips(); }
    catch (err) { setChatError(apiError(err)); }
  };
  const sendAudioClip = async (clipId: string) => {
    if (!selected) return;
    setChatError(null); setSending(true);
    try {
      const { data } = await api.post<{ message: Msg }>(`/api/inbox/${selected}/audio-clip`, { clipId });
      setMessages((prev) => appendUnique(prev, data.message));
      setShowAudios(false);
      void loadConvs();
    } catch (err) { setChatError(apiError(err)); }
    finally { setSending(false); }
  };

  // --- Mensajes guardados ---
  const saveQuick = async () => {
    const title = qForm?.title.trim();
    const body = qForm?.body.trim();
    if (!title || !body) { setChatError("Poné un título y el texto del mensaje."); return; }
    try { await api.post("/api/inbox/quick-replies", { title, body }); await loadQuick(); setQForm(null); }
    catch (err) { setChatError(apiError(err)); }
  };
  const delQuick = async (id: string) => {
    try { await api.delete(`/api/inbox/quick-replies/${id}`); await loadQuick(); }
    catch (err) { setChatError(apiError(err)); }
  };

  const current = convs.find((c) => c.id === selected);

  return (
    // h-full: llena el <main> del layout (que ya mide el viewport exacto) — sin h-screen,
    // que sumado al alto del menú hacía scrollear la ventana y dejaba margen abajo.
    <div className="flex h-full">
      {/* ---- Lista de conversaciones. En MÓVIL ocupa toda la pantalla y se oculta al abrir un chat;
           en DESKTOP es plegable (listOpen) y va al costado. ---- */}
      <div className={`w-full shrink-0 flex-col border-r border-slate-800 lg:w-80 ${selected ? "hidden" : "flex"} ${listOpen ? "lg:flex" : "lg:hidden"}`}>
          <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
            <div>
              <h1 className="font-bold">WhatsApp Inbox</h1>
              <div className="text-xs text-slate-500">{convs.length} conversaciones</div>
            </div>
            <button onClick={() => setListOpen(false)} title="Ocultar lista" className="hidden rounded p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white lg:inline-flex">
              <PanelLeftClose className="h-5 w-5" />
            </button>
          </div>
          {listError && <div className="p-3"><ErrorMsg>{listError}</ErrorMsg></div>}
          <div className="flex-1 overflow-y-auto">
            {convs.length === 0 ? (
              <p className="p-4 text-sm text-slate-500">No hay conversaciones aún.</p>
            ) : convs.map((c) => (
              <button key={c.id} onClick={() => setSelected(c.id)}
                className={`flex w-full items-start gap-3 border-b border-slate-800/60 px-4 py-3 text-left transition ${selected === c.id ? "bg-slate-800" : "hover:bg-slate-800/50"}`}>
                <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold ${c.unread > 0 ? "bg-wa-green text-slate-900" : "bg-slate-700 text-slate-200"}`}>
                  {c.unread > 0 ? c.unread : (c.name || c.number || "?").charAt(0).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-slate-100">{c.name || c.number || "Sin nombre"}</span>
                    <span className="shrink-0 text-[10px] text-slate-500">{shortTime(c.lastAt)}</span>
                  </span>
                  {c.name && c.number && <span className="block truncate text-[10px] text-slate-500">{c.number}</span>}
                  {c.line && <span className="block truncate text-[10px] text-slate-600">vía {c.line}</span>}
                  <span className="mt-0.5 block truncate text-xs text-slate-400">{c.preview || "—"}</span>
                </span>
              </button>
            ))}
          </div>
      </div>

      {/* ---- Chat. En MÓVIL: pantalla completa, visible sólo con una conversación abierta. ---- */}
      <div className={`flex-1 flex-col ${selected ? "flex" : "hidden lg:flex"}`}>
        {!selected ? (
          <div className="flex flex-1 items-center justify-center text-slate-500">
            {!listOpen && (
              <button onClick={() => setListOpen(true)} className="absolute left-3 top-3 rounded p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white">
                <PanelLeftOpen className="h-5 w-5" />
              </button>
            )}
            Seleccioná una conversación para verla.
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3 border-b border-slate-800 px-4 py-3">
              {/* Móvil: volver a la lista de conversaciones */}
              <button onClick={() => setSelected(null)} title="Volver" className="rounded p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white lg:hidden">
                <ArrowLeft className="h-5 w-5" />
              </button>
              {/* Desktop: mostrar la lista si está plegada */}
              {!listOpen && (
                <button onClick={() => setListOpen(true)} title="Mostrar lista" className="hidden rounded p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white lg:inline-flex">
                  <PanelLeftOpen className="h-5 w-5" />
                </button>
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">{current?.name || current?.number || "Conversación"}</div>
                <div className="truncate text-xs text-slate-500">
                  {current?.number}{current?.line ? ` · vía ${current.line}` : ""}
                </div>
              </div>
              {current && <StageBadge stage={current.stage} />}
            </div>

            <div className="flex-1 space-y-2 overflow-y-auto bg-slate-900/40 p-4">
              {chatError && <ErrorMsg>{chatError}</ErrorMsg>}
              {messages.map((m) => (
                <div key={m.id} className={`flex ${m.direction === "out" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${
                    m.direction === "out"
                      ? m.status === "failed"
                        ? "border border-rose-500 bg-rose-100 text-rose-900"
                        : "bg-wa-green text-slate-900"
                      : "bg-slate-700 text-slate-100"
                  }`}>
                    {m.mediaUrl && m.mediaUrl.startsWith("data:audio") && (
                      <audio controls src={m.mediaUrl} className="mb-1 w-56 max-w-full" />
                    )}
                    {m.mediaUrl && m.mediaUrl.startsWith("data:application/pdf") && (
                      <a href={m.mediaUrl} target="_blank" rel="noopener noreferrer" className="mb-1 flex items-center gap-2 rounded-md bg-black/20 px-3 py-2 font-medium underline">
                        📄 Abrir comprobante (PDF)
                      </a>
                    )}
                    {m.mediaUrl && m.mediaUrl.startsWith("data:image") && (
                      <a href={m.mediaUrl} target="_blank" rel="noopener noreferrer">
                        <img src={m.mediaUrl} alt="Imagen" className="mb-1 max-h-64 w-full rounded-md object-cover" />
                      </a>
                    )}
                    {m.body && <div className="whitespace-pre-wrap break-words">{m.body}</div>}
                    {!m.body && !m.mediaUrl && <div className="italic opacity-60">[mensaje no soportado]</div>}
                    {m.direction === "out" && m.status === "failed" && (
                      <div className="mt-1 text-[11px] font-semibold text-rose-700">
                        ⚠ No entregado{m.error ? ` — ${m.error}` : ""}
                      </div>
                    )}
                    <div className={`mt-1 flex items-center gap-1 text-[10px] ${m.direction === "out" ? (m.status === "failed" ? "text-rose-700/80" : "text-slate-800/70") : "text-slate-400"}`}>
                      {fmtDate(m.createdAt)}
                      {m.direction === "out" && <AckTicks status={m.status} />}
                    </div>
                  </div>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>

            {/* ---- Plantillas (fuera de la ventana de 24h) ---- */}
            {needTemplate && (
              <div className="border-t border-amber-800 bg-amber-950/30 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs text-amber-200">Fuera de la ventana de 24 h. Reabrí la conversación con una plantilla aprobada.</span>
                  <button type="button" onClick={() => setNeedTemplate(false)} className="text-xs text-slate-400 hover:text-white">Cerrar</button>
                </div>
                {templates.length === 0 ? (
                  <p className="text-xs text-slate-400">No hay plantillas aprobadas en esta línea (o no es Cloud API). Creá/aprobá plantillas en el Business Manager de Meta.</p>
                ) : (
                  <div className="max-h-48 space-y-2 overflow-y-auto">
                    {templates.map((t) => {
                      const vals = tplInputs[t.name] ?? Array(t.bodyParams).fill("");
                      const ready = vals.slice(0, t.bodyParams).every((v) => v.trim());
                      return (
                        <div key={`${t.name}-${t.language}`} className="rounded-md border border-slate-700 bg-slate-900/60 p-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-medium text-slate-200">{t.name} <span className="text-slate-500">({t.language})</span></span>
                            <Button type="button" disabled={!ready} onClick={() => void sendTemplate(t, vals.slice(0, t.bodyParams))}>Enviar</Button>
                          </div>
                          {t.bodyParams > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {Array.from({ length: t.bodyParams }).map((_, i) => (
                                <input key={i} value={vals[i] ?? ""} placeholder={`{{${i + 1}}}`}
                                  onChange={(e) => setTplInputs((p) => { const arr = [...(p[t.name] ?? Array(t.bodyParams).fill(""))]; arr[i] = e.target.value; return { ...p, [t.name]: arr }; })}
                                  className="w-28 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-100" />
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* ---- Compositor ---- */}
            <div className="relative border-t border-slate-800">
              {showEmoji && (
                <div className="absolute bottom-full left-2 mb-2 grid w-72 grid-cols-8 gap-1 rounded-lg border border-slate-700 bg-slate-900 p-2 shadow-xl">
                  {EMOJIS.map((e) => (
                    <button key={e} type="button" className="rounded p-1 text-lg hover:bg-slate-700" onClick={() => { setDraft((d) => d + e); }}>{e}</button>
                  ))}
                </div>
              )}
              {showQuick && (
                <div className="absolute bottom-full left-2 mb-2 w-80 rounded-lg border border-slate-700 bg-slate-900 p-2 shadow-xl">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-300">Mensajes guardados</span>
                    {!qForm && <button type="button" onClick={() => setQForm({ title: "", body: "" })} className="text-xs font-medium text-wa-green hover:underline">+ Nuevo</button>}
                  </div>
                  {qForm ? (
                    <div className="space-y-2">
                      <input value={qForm.title} onChange={(e) => setQForm({ ...qForm, title: e.target.value })} placeholder="Título (ej: Bienvenida)" className="w-full rounded border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs text-slate-100 outline-none focus:border-wa-green" />
                      <textarea value={qForm.body} onChange={(e) => setQForm({ ...qForm, body: e.target.value })} placeholder="Texto del mensaje — podés usar saltos de línea y párrafos" rows={6} className="w-full resize-y rounded border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs text-slate-100 outline-none focus:border-wa-green" />
                      <div className="flex justify-end gap-2">
                        <button type="button" onClick={() => setQForm(null)} className="text-xs text-slate-400 hover:text-white">Cancelar</button>
                        <button type="button" onClick={() => void saveQuick()} className="rounded bg-wa-green px-3 py-1 text-xs font-semibold text-slate-900">Guardar</button>
                      </div>
                    </div>
                  ) : quick.length === 0 ? (
                    <p className="px-1 py-2 text-xs text-slate-500">Sin mensajes guardados. Creá uno con "+ Nuevo".</p>
                  ) : (
                    <div className="max-h-60 space-y-1 overflow-y-auto">
                      {quick.map((q) => (
                        <div key={q.id} className="group flex items-start gap-2 rounded px-2 py-1.5 hover:bg-slate-800">
                          <button type="button" className="min-w-0 flex-1 text-left" onClick={() => { setDraft((d) => (d ? d + " " : "") + q.body); setShowQuick(false); }}>
                            <div className="text-xs font-medium text-slate-200">{q.title}</div>
                            <div className="truncate text-[11px] text-slate-500">{q.body}</div>
                          </button>
                          <button type="button" onClick={() => delQuick(q.id)} className="mt-0.5 text-slate-500 opacity-0 transition group-hover:opacity-100 hover:text-rose-400">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {showAudios && (
                <div className="absolute bottom-full left-2 mb-2 w-80 rounded-lg border border-slate-700 bg-slate-900 p-2 shadow-xl">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-300">Biblioteca de audios</span>
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => startRec("lib")} disabled={recording} className="flex items-center gap-1 text-xs font-medium text-wa-green hover:underline disabled:opacity-50">
                        <Mic className="h-3.5 w-3.5" /> Grabar
                      </button>
                      <button type="button" onClick={() => fileRef.current?.click()} className="flex items-center gap-1 text-xs font-medium text-wa-green hover:underline">
                        <Upload className="h-3.5 w-3.5" /> Subir
                      </button>
                    </div>
                  </div>
                  <p className="mb-2 px-1 text-[10px] leading-tight text-slate-500">Cada envío sale como un audio único (no se detecta como el mismo repetido).</p>
                  {audioClips.length === 0 ? (
                    <p className="px-1 py-2 text-xs text-slate-500">Sin audios. Grabá uno o subí un archivo.</p>
                  ) : (
                    <div className="max-h-72 space-y-1 overflow-y-auto">
                      {audioClips.map((a) => (
                        <ClipRow key={a.id} clip={a} disabled={sending || !selected} onSend={sendAudioClip} onDelete={delClip} />
                      ))}
                    </div>
                  )}
                </div>
              )}

              <form onSubmit={send} className="flex items-end gap-1.5 px-3 pt-2.5" style={{ paddingBottom: "calc(0.6rem + env(safe-area-inset-bottom))" }}>
                <input ref={fileRef} type="file" accept="audio/*" onChange={onFilePicked} className="hidden" />
                <button type="button" title="Emojis" onClick={() => { setShowEmoji((v) => !v); setShowQuick(false); setShowAudios(false); }} className={`rounded p-2 ${showEmoji ? "bg-slate-700 text-wa-green" : "text-slate-400 hover:bg-slate-800 hover:text-white"}`}>
                  {showEmoji ? <X className="h-5 w-5" /> : <Smile className="h-5 w-5" />}
                </button>
                <button type="button" title="Mensajes guardados" onClick={() => { setShowQuick((v) => !v); setShowEmoji(false); setShowAudios(false); }} className={`rounded p-2 ${showQuick ? "bg-slate-700 text-wa-green" : "text-slate-400 hover:bg-slate-800 hover:text-white"}`}>
                  <MessageSquareText className="h-5 w-5" />
                </button>
                <button type="button" title="Biblioteca de audios" onClick={() => { setShowAudios((v) => !v); setShowEmoji(false); setShowQuick(false); }} className={`rounded p-2 ${showAudios ? "bg-slate-700 text-wa-green" : "text-slate-400 hover:bg-slate-800 hover:text-white"}`}>
                  <Music className="h-5 w-5" />
                </button>
                <textarea
                  ref={draftRef}
                  rows={1}
                  placeholder="Escribí un mensaje…"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
                  className="max-h-36 min-h-[46px] flex-1 resize-none rounded-2xl border border-slate-700 bg-slate-800 px-4 py-3 text-base text-slate-100 placeholder-slate-500 outline-none focus:border-wa-green"
                />
                {recording ? (
                  <button type="button" title="Detener" onClick={stopRec} className="flex items-center gap-1 rounded bg-rose-500 px-3 py-2 text-sm font-medium text-white">
                    <Square className="h-4 w-4" /> <span className="animate-pulse">grabando…</span>
                  </button>
                ) : draft.trim() ? (
                  <Button type="submit" disabled={sending}>{sending ? "…" : <Send className="h-4 w-4" />}</Button>
                ) : (
                  <button type="button" title="Grabar audio" onClick={() => startRec()} className="rounded p-2 text-slate-400 hover:bg-slate-800 hover:text-white">
                    <Mic className="h-5 w-5" />
                  </button>
                )}
              </form>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
