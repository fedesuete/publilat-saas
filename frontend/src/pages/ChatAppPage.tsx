// Inbox del Chat App (canal jugador↔cajero) — SEPARADO del Inbox de WhatsApp. Abre un
// SEGUNDO socket al namespace "/chat" SOLO en esta página; no toca el socket default.
import { useEffect, useRef, useState, type FormEvent } from "react";
import { io, type Socket } from "socket.io-client";
import { QRCodeCanvas } from "qrcode.react";
import { api, apiError } from "../lib/api";
import { API_BASE } from "../lib/config";
import { fmtDate } from "../lib/format";
import { Button, Input, Card, ErrorMsg } from "../components/ui";

const CHAT_PWA_URL = (import.meta.env.VITE_CHAT_PWA_URL as string | undefined) ?? "https://chat.publi.lat";

interface Conv { id: string; playerId: string; player: string; username: string; status: string; unread: number; preview: string; lastAt: string }
interface Msg { id: string; senderType: "player" | "operator" | "system"; body: string | null; metadata?: Record<string, unknown>; createdAt: string }
interface Invite { id: string; code: string; label: string | null; isActive: boolean; createdAt: string }

// Agrega un mensaje evitando duplicados por id (optimistic add + echo del socket).
function appendUnique(list: Msg[], m: Msg): Msg[] {
  if (list.some((x) => x.id === m.id)) return list;
  return [...list, m];
}

export default function ChatAppPage() {
  const [tab, setTab] = useState<"chats" | "invites" | "brand" | "avisos">("chats");
  const [convs, setConvs] = useState<Conv[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [activeLine, setActiveLine] = useState(true); // ¿hay línea WA activa para operar el Chat App?
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

  useEffect(() => {
    void loadConvs();
    // Estado de línea: si no hay línea WA activa, el Chat App queda en solo-lectura.
    api.get<{ activeLine: boolean }>("/api/chat/status").then(({ data }) => setActiveLine(data.activeLine)).catch(() => undefined);
  }, []);
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
          <h1 className="text-xl font-bold">Chat App</h1>
          <p className="text-sm text-slate-400">Canal directo con tus jugadores (app instalable). Separado del WhatsApp.</p>
        </div>
        <div className="inline-flex rounded-md bg-slate-900 p-1 text-sm">
          <button onClick={() => setTab("chats")} className={`rounded px-3 py-1 font-medium ${tab === "chats" ? "bg-wa-green text-slate-900" : "text-slate-300"}`}>Conversaciones</button>
          <button onClick={() => setTab("invites")} className={`rounded px-3 py-1 font-medium ${tab === "invites" ? "bg-wa-green text-slate-900" : "text-slate-300"}`}>Mi Invitación</button>
          <button onClick={() => setTab("brand")} className={`rounded px-3 py-1 font-medium ${tab === "brand" ? "bg-wa-green text-slate-900" : "text-slate-300"}`}>Marca</button>
          <button onClick={() => setTab("avisos")} className={`rounded px-3 py-1 font-medium ${tab === "avisos" ? "bg-wa-green text-slate-900" : "text-slate-300"}`}>Avisos</button>
        </div>
      </div>

      {!activeLine && (
        <div className="mb-3 rounded-lg border border-amber-600/50 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          ⚠️ <b>Chat App en solo-lectura.</b> No tenés una línea de WhatsApp activa, así que no podés
          responder, enviar avisos ni mostrar el popup. Recargá días y activá una línea en{" "}
          <a href="/whatsapp" className="underline">WhatsApp</a> para reactivarlo.
        </div>
      )}

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
      ) : tab === "invites" ? (
        <InvitesTab />
      ) : tab === "brand" ? (
        <BrandingTab />
      ) : (
        <AvisosTab />
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
              {inv.isActive && <InviteQr url={linkFor(inv.code)} code={inv.code} />}
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

// QR del link de invitación + botón para descargarlo como imagen (PNG) y poder mandarlo/imprimir.
// El canvas se renderiza a 256px (nítido para descargar) pero se muestra chico (72px) por CSS.
function InviteQr({ url, code }: { url: string; code: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [saved, setSaved] = useState(false);
  const download = () => {
    const canvas = ref.current;
    if (!canvas) return;
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = `qr-${code}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };
  return (
    <div className="flex shrink-0 flex-col items-center gap-1">
      <div className="rounded bg-white p-1.5">
        <QRCodeCanvas ref={ref} value={url} size={256} marginSize={2} className="!h-[72px] !w-[72px]" />
      </div>
      <button onClick={download} className="text-[11px] text-slate-400 underline hover:text-slate-200">
        {saved ? "¡Descargado!" : "Descargar QR"}
      </button>
    </div>
  );
}

// Sub-sección "Marca": branding white-label de la PWA del jugador (logo, colores, textos).
interface Brand {
  brandName: string | null; logoUrl: string | null; primaryColor: string | null; accentColor: string | null;
  welcomeText: string | null; welcomeMsgText: string | null; welcomeMsgImage: string | null;
}
const EMPTY_BRAND: Brand = { brandName: null, logoUrl: null, primaryColor: null, accentColor: null, welcomeText: null, welcomeMsgText: null, welcomeMsgImage: null };

function BrandingTab() {
  const [form, setForm] = useState<Brand>(EMPTY_BRAND);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [uploading, setUploading] = useState<"logo" | "welcome" | null>(null);

  useEffect(() => {
    api.get<{ branding: Brand }>("/api/chat/branding")
      .then(({ data }) => setForm({ ...EMPTY_BRAND, ...data.branding }))
      .catch((e) => setError(apiError(e)))
      .finally(() => setLoading(false));
  }, []);

  const set = (k: keyof Brand, v: string | null) => { setForm((f) => ({ ...f, [k]: v })); setOk(false); };

  // Lee el archivo como data URL y lo sube; el backend devuelve la URL (CDN si hay S3, si no el data URL).
  const upload = async (file: File, field: "logoUrl" | "welcomeMsgImage", which: "logo" | "welcome") => {
    if (file.size > 700 * 1024) { setError("La imagen supera 700 KB. Comprimila o usá una más liviana."); return; }
    setUploading(which); setError(null);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader(); r.onload = () => resolve(String(r.result ?? "")); r.onerror = reject; r.readAsDataURL(file);
      });
      const { data } = await api.post<{ url: string }>("/api/chat/branding/logo", { dataUrl });
      set(field, data.url);
    } catch (e) { setError(apiError(e)); } finally { setUploading(null); }
  };

  const save = async () => {
    setSaving(true); setError(null); setOk(false);
    try { await api.patch("/api/chat/branding", form); setOk(true); }
    catch (e) { setError(apiError(e)); } finally { setSaving(false); }
  };

  if (loading) return <p className="text-sm text-slate-500">Cargando…</p>;
  const primary = form.primaryColor || "#22c55e";

  return (
    <div className="grid max-w-5xl gap-6 lg:grid-cols-[1fr_20rem]">
      {/* Formulario */}
      <div className="space-y-5">
        {error && <ErrorMsg>{error}</ErrorMsg>}

        <Card>
          <div className="mb-3 text-sm font-semibold text-slate-100">Identidad</div>
          <label className="mb-1 block text-xs text-slate-400">Nombre de la marca</label>
          <Input value={form.brandName ?? ""} onChange={(e) => set("brandName", e.target.value || null)} placeholder="Ej: La Gran Jugada" className="mb-4" />

          <label className="mb-1 block text-xs text-slate-400">Logo</label>
          <div className="mb-4 flex items-center gap-3">
            {form.logoUrl && <img src={form.logoUrl} alt="logo" className="h-12 w-12 rounded-lg object-cover" />}
            <label className="cursor-pointer rounded-md border border-slate-700 px-3 py-2 text-xs text-slate-300 hover:bg-slate-800">
              {uploading === "logo" ? "Subiendo…" : form.logoUrl ? "Cambiar logo" : "Subir logo"}
              <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f, "logoUrl", "logo"); e.target.value = ""; }} />
            </label>
            {form.logoUrl && <button onClick={() => set("logoUrl", null)} className="text-xs text-rose-400 hover:underline">Quitar</button>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-xs text-slate-400">Color principal</label>
              <div className="flex items-center gap-2">
                <input type="color" value={primary} onChange={(e) => set("primaryColor", e.target.value)} className="h-9 w-12 cursor-pointer rounded border border-slate-700 bg-transparent" />
                <Input value={form.primaryColor ?? ""} onChange={(e) => set("primaryColor", e.target.value || null)} placeholder="#22c55e" className="flex-1" />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400">Color de acento</label>
              <div className="flex items-center gap-2">
                <input type="color" value={form.accentColor || "#16a34a"} onChange={(e) => set("accentColor", e.target.value)} className="h-9 w-12 cursor-pointer rounded border border-slate-700 bg-transparent" />
                <Input value={form.accentColor ?? ""} onChange={(e) => set("accentColor", e.target.value || null)} placeholder="#16a34a" className="flex-1" />
              </div>
            </div>
          </div>
        </Card>

        <Card>
          <div className="mb-3 text-sm font-semibold text-slate-100">Textos de bienvenida</div>
          <label className="mb-1 block text-xs text-slate-400">Subtítulo (pantalla de registro)</label>
          <Input value={form.welcomeText ?? ""} onChange={(e) => set("welcomeText", e.target.value || null)} placeholder="Ej: Registrate y chateá con nosotros" className="mb-4" />

          <label className="mb-1 block text-xs text-slate-400">Primer mensaje automático</label>
          <textarea value={form.welcomeMsgText ?? ""} onChange={(e) => set("welcomeMsgText", e.target.value || null)}
            placeholder="Ej: ¡Hola! Gracias por escribirnos. ¿En qué te ayudamos?" rows={3}
            className="mb-4 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-wa-green" />

          <label className="mb-1 block text-xs text-slate-400">Imagen del primer mensaje (opcional)</label>
          <div className="flex items-center gap-3">
            {form.welcomeMsgImage && <img src={form.welcomeMsgImage} alt="bienvenida" className="h-12 w-12 rounded-lg object-cover" />}
            <label className="cursor-pointer rounded-md border border-slate-700 px-3 py-2 text-xs text-slate-300 hover:bg-slate-800">
              {uploading === "welcome" ? "Subiendo…" : form.welcomeMsgImage ? "Cambiar imagen" : "Subir imagen"}
              <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f, "welcomeMsgImage", "welcome"); e.target.value = ""; }} />
            </label>
            {form.welcomeMsgImage && <button onClick={() => set("welcomeMsgImage", null)} className="text-xs text-rose-400 hover:underline">Quitar</button>}
          </div>
        </Card>

        <div className="flex items-center gap-3">
          <Button onClick={() => void save()} disabled={saving}>{saving ? "Guardando…" : "Guardar cambios"}</Button>
          {ok && <span className="text-sm text-wa-green">✓ Guardado</span>}
        </div>
      </div>

      {/* Vista previa (mock de la PWA del jugador) */}
      <div className="lg:sticky lg:top-6 lg:self-start">
        <div className="mb-2 text-xs text-slate-500">Vista previa</div>
        <div className="mx-auto w-full max-w-[18rem] overflow-hidden rounded-3xl border-4 border-slate-800 bg-slate-950 shadow-xl">
          <div className="flex flex-col items-center px-6 py-10 text-center">
            {form.logoUrl ? <img src={form.logoUrl} alt="" className="mb-4 h-20 w-20 rounded-2xl object-cover" /> :
              <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-2xl text-2xl font-bold text-slate-900" style={{ background: primary }}>{(form.brandName || "C").charAt(0).toUpperCase()}</div>}
            <div className="text-lg font-bold text-slate-100">{form.brandName || "Tu marca"}</div>
            {form.welcomeText && <p className="mt-1 text-xs text-slate-400">{form.welcomeText}</p>}
            <div className="mt-6 w-full rounded-full py-2.5 text-sm font-semibold text-slate-900" style={{ background: primary }}>Empezar a chatear</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Sub-sección "Avisos": notificaciones push (a todos o a un jugador) + popup con imagen al entrar.
interface PopupForm {
  popupActive: boolean; popupImageUrl: string | null; popupTitle: string | null; popupText: string | null; popupLink: string | null;
  popupFrom: string | null; popupUntil: string | null; // ISO (UTC); ventana de programación opcional
}
const EMPTY_POPUP: PopupForm = { popupActive: false, popupImageUrl: null, popupTitle: null, popupText: null, popupLink: null, popupFrom: null, popupUntil: null };

// Conversión entre ISO (UTC, lo que guarda el backend) y el valor del <input datetime-local> (hora LOCAL).
function isoToLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
function localToIso(local: string): string | null {
  return local ? new Date(local).toISOString() : null;
}

// Lee un archivo de imagen y lo sube (reusa /branding/logo, que devuelve una URL corta servida por el backend).
async function uploadImage(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const r = new FileReader(); r.onload = () => resolve(String(r.result ?? "")); r.onerror = reject; r.readAsDataURL(file);
  });
  const { data } = await api.post<{ url: string }>("/api/chat/branding/logo", { dataUrl });
  return data.url;
}

interface PushStats {
  totalPlayers: number;
  playersWithPush: number;
  players: { id: string; username: string; name: string | null; hasPush: boolean; createdAt: string }[];
}
interface Broadcast { id: string; title: string; body: string; image: string | null; target: string; sent: number; createdAt: string }

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <Card>
      <div className="text-2xl font-bold text-slate-100">{value}</div>
      <div className="text-xs text-slate-400">{label}</div>
    </Card>
  );
}

function AvisosTab() {
  const [convs, setConvs] = useState<Conv[]>([]);
  const [stats, setStats] = useState<PushStats | null>(null);
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [pTitle, setPTitle] = useState("");
  const [pBody, setPBody] = useState("");
  const [pImage, setPImage] = useState<string | null>(null);
  const [target, setTarget] = useState("all");
  const [sending, setSending] = useState(false);
  const [sentMsg, setSentMsg] = useState<string | null>(null);
  const [upPush, setUpPush] = useState(false);

  const [popup, setPopup] = useState<PopupForm>(EMPTY_POPUP);
  const [savingPopup, setSavingPopup] = useState(false);
  const [popupOk, setPopupOk] = useState(false);
  const [upPopup, setUpPopup] = useState(false);

  const loadMetrics = () => {
    void api.get<PushStats>("/api/chat/push/stats").then(({ data }) => setStats(data)).catch(() => undefined);
    void api.get<{ broadcasts: Broadcast[] }>("/api/chat/broadcasts").then(({ data }) => setBroadcasts(data.broadcasts)).catch(() => undefined);
  };

  useEffect(() => {
    void api.get<{ conversations: Conv[] }>("/api/chat/conversations").then(({ data }) => setConvs(data.conversations)).catch(() => undefined);
    void api.get<{ popup: PopupForm | null }>("/api/chat/popup").then(({ data }) => { if (data.popup) setPopup({ ...EMPTY_POPUP, ...data.popup }); }).catch(() => undefined);
    loadMetrics();
  }, []);

  const pick = async (file: File, onUrl: (u: string) => void, setBusy: (b: boolean) => void) => {
    if (file.size > 700 * 1024) { setError("La imagen supera 700 KB. Comprimila o usá una más liviana."); return; }
    setBusy(true); setError(null);
    try { onUrl(await uploadImage(file)); } catch (e) { setError(apiError(e)); } finally { setBusy(false); }
  };

  const sendPush = async () => {
    if (!pTitle.trim() || !pBody.trim()) return;
    setSending(true); setError(null); setSentMsg(null);
    try {
      const body: Record<string, unknown> = { title: pTitle.trim(), body: pBody.trim() };
      if (pImage) body.image = pImage;
      if (target !== "all") body.playerId = target;
      const { data } = await api.post<{ sent: number }>("/api/chat/push/broadcast", body);
      setSentMsg(`Enviada a ${data.sent} dispositivo(s).`);
      setPTitle(""); setPBody(""); setPImage(null);
      loadMetrics();
    } catch (e) { setError(apiError(e)); } finally { setSending(false); }
  };

  const setP = (patch: Partial<PopupForm>) => { setPopup((p) => ({ ...p, ...patch })); setPopupOk(false); };
  const savePopup = async () => {
    setSavingPopup(true); setError(null); setPopupOk(false);
    try { await api.patch("/api/chat/popup", popup); setPopupOk(true); }
    catch (e) { setError(apiError(e)); } finally { setSavingPopup(false); }
  };

  return (
    <div className="grid max-w-5xl gap-6 lg:grid-cols-2">
      {error && <div className="lg:col-span-2"><ErrorMsg>{error}</ErrorMsg></div>}

      {/* Notificación push */}
      <Card>
        <div className="mb-1 text-sm font-semibold text-slate-100">🔔 Enviar notificación</div>
        <p className="mb-3 text-xs text-slate-500">Le llega al celular de tus jugadores (aun con la app cerrada, si activaron las notificaciones).</p>
        <label className="mb-1 block text-xs text-slate-400">Para</label>
        <select value={target} onChange={(e) => setTarget(e.target.value)} className="mb-3 w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 outline-none focus:border-wa-green">
          <option value="all">Todos mis jugadores</option>
          {convs.map((c) => <option key={c.playerId} value={c.playerId}>{c.player} ({c.username})</option>)}
        </select>
        <label className="mb-1 block text-xs text-slate-400">Título</label>
        <Input value={pTitle} onChange={(e) => setPTitle(e.target.value)} placeholder="Ej: ¡Promo de hoy!" maxLength={80} className="mb-3" />
        <label className="mb-1 block text-xs text-slate-400">Mensaje</label>
        <textarea value={pBody} onChange={(e) => setPBody(e.target.value)} placeholder="Escribí el aviso…" rows={3} maxLength={240}
          className="mb-3 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-wa-green" />
        <label className="mb-1 block text-xs text-slate-400">Imagen (opcional)</label>
        <div className="mb-3 flex items-center gap-3">
          {pImage && <img src={pImage} alt="" className="h-12 w-12 rounded object-cover" />}
          <label className="cursor-pointer rounded-md border border-slate-700 px-3 py-2 text-xs text-slate-300 hover:bg-slate-800">
            {upPush ? "Subiendo…" : pImage ? "Cambiar" : "Subir imagen"}
            <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void pick(f, setPImage, setUpPush); e.target.value = ""; }} />
          </label>
          {pImage && <button onClick={() => setPImage(null)} className="text-xs text-rose-400 hover:underline">Quitar</button>}
        </div>
        <div className="flex items-center gap-3">
          <Button onClick={() => void sendPush()} disabled={sending || !pTitle.trim() || !pBody.trim()}>{sending ? "Enviando…" : "Enviar notificación"}</Button>
          {sentMsg && <span className="text-sm text-wa-green">{sentMsg}</span>}
        </div>
      </Card>

      {/* Popup al entrar */}
      <Card>
        <div className="mb-1 flex items-center justify-between">
          <div className="text-sm font-semibold text-slate-100">🖼️ Popup al entrar</div>
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input type="checkbox" checked={popup.popupActive} onChange={(e) => setP({ popupActive: e.target.checked })} /> Activo
          </label>
        </div>
        <p className="mb-3 text-xs text-slate-500">Aparece una vez cuando el jugador abre la app (se vuelve a mostrar cada vez que lo cambiás). Ideal para una promo con imagen.</p>
        <label className="mb-1 block text-xs text-slate-400">Imagen</label>
        <div className="mb-3 flex items-center gap-3">
          {popup.popupImageUrl && <img src={popup.popupImageUrl} alt="" className="h-16 w-16 rounded object-cover" />}
          <label className="cursor-pointer rounded-md border border-slate-700 px-3 py-2 text-xs text-slate-300 hover:bg-slate-800">
            {upPopup ? "Subiendo…" : popup.popupImageUrl ? "Cambiar" : "Subir imagen"}
            <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void pick(f, (u) => setP({ popupImageUrl: u }), setUpPopup); e.target.value = ""; }} />
          </label>
          {popup.popupImageUrl && <button onClick={() => setP({ popupImageUrl: null })} className="text-xs text-rose-400 hover:underline">Quitar</button>}
        </div>
        <label className="mb-1 block text-xs text-slate-400">Título (opcional)</label>
        <Input value={popup.popupTitle ?? ""} onChange={(e) => setP({ popupTitle: e.target.value || null })} placeholder="Ej: ¡Bienvenido!" maxLength={80} className="mb-3" />
        <label className="mb-1 block text-xs text-slate-400">Texto (opcional)</label>
        <textarea value={popup.popupText ?? ""} onChange={(e) => setP({ popupText: e.target.value || null })} rows={2} maxLength={500}
          className="mb-3 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-wa-green" />
        <label className="mb-1 block text-xs text-slate-400">Link del botón (opcional)</label>
        <Input value={popup.popupLink ?? ""} onChange={(e) => setP({ popupLink: e.target.value || null })} placeholder="https://..." className="mb-3" />

        <div className="mb-3 grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs text-slate-400">Mostrar desde (opcional)</label>
            <input type="datetime-local" value={isoToLocal(popup.popupFrom)} onChange={(e) => setP({ popupFrom: localToIso(e.target.value) })}
              className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-wa-green" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">Hasta (opcional)</label>
            <input type="datetime-local" value={isoToLocal(popup.popupUntil)} onChange={(e) => setP({ popupUntil: localToIso(e.target.value) })}
              className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-wa-green" />
          </div>
        </div>
        <p className="mb-3 text-[11px] text-slate-600">Si dejás las fechas vacías, el popup se muestra siempre (mientras esté activo). Con fechas, solo aparece dentro de esa ventana.</p>

        <div className="flex items-center gap-3">
          <Button onClick={() => void savePopup()} disabled={savingPopup}>{savingPopup ? "Guardando…" : "Guardar popup"}</Button>
          {popupOk && <span className="text-sm text-wa-green">✓ Guardado</span>}
        </div>
      </Card>

      {/* Métricas */}
      {stats && (
        <div className="space-y-4 lg:col-span-2">
          <div className="grid grid-cols-3 gap-3">
            <StatCard label="Jugadores (clientes)" value={stats.totalPlayers} />
            <StatCard label="Con notificaciones activas" value={stats.playersWithPush} />
            <StatCard label="% activación" value={stats.totalPlayers ? `${Math.round((100 * stats.playersWithPush) / stats.totalPlayers)}%` : "—"} />
          </div>

          <Card>
            <div className="mb-2 text-sm font-semibold text-slate-100">Últimos avisos enviados</div>
            {broadcasts.length === 0 ? (
              <p className="text-xs text-slate-500">Todavía no enviaste avisos.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="text-slate-500">
                    <tr><th className="py-1 pr-3 font-medium">Fecha</th><th className="pr-3 font-medium">Título</th><th className="pr-3 font-medium">Para</th><th className="text-right font-medium">Recibieron</th></tr>
                  </thead>
                  <tbody>
                    {broadcasts.map((b) => (
                      <tr key={b.id} className="border-t border-slate-800">
                        <td className="py-1.5 pr-3 text-slate-400">{fmtDate(b.createdAt)}</td>
                        <td className="pr-3 text-slate-200">{b.title}</td>
                        <td className="pr-3 text-slate-400">{b.target}</td>
                        <td className="text-right font-semibold text-slate-100">{b.sent}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card>
            <div className="mb-2 text-sm font-semibold text-slate-100">Jugadores — quién activó las notificaciones</div>
            {stats.players.length === 0 ? (
              <p className="text-xs text-slate-500">Todavía no tenés jugadores registrados.</p>
            ) : (
              <div className="max-h-72 space-y-0.5 overflow-y-auto">
                {stats.players.map((p) => (
                  <div key={p.id} className="flex items-center justify-between border-b border-slate-800/60 py-1.5 text-sm">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className={`h-2 w-2 shrink-0 rounded-full ${p.hasPush ? "bg-wa-green" : "bg-slate-600"}`} />
                      <span className="truncate text-slate-200">{p.name || p.username}</span>
                    </span>
                    <span className={`shrink-0 text-xs ${p.hasPush ? "text-wa-green" : "text-slate-500"}`}>{p.hasPush ? "🔔 activas" : "sin notificaciones"}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
