import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, apiError } from "../lib/api";
import { getSocket, type WaQrPayload, type WaStatusPayload } from "../lib/socket";
import type { Line } from "../lib/types";
import { fmtDate, fmtRemaining, isExpired } from "../lib/format";
import { Button, Input, ErrorMsg, Card, StatusDot } from "../components/ui";

// FB JS SDK (Embedded Signup) — tipado mínimo del global.
declare global {
  interface Window {
    FB?: { init: (o: Record<string, unknown>) => void; login: (cb: (r: any) => void, o: Record<string, unknown>) => void };
    fbAsyncInit?: () => void;
  }
}

interface ActivateResponse {
  line: { id: string; status: string; expiresAt: string | null };
  creditDays: number;
}

interface EsConfig {
  appId: string | null;
  configId: string | null;
  graphVersion: string;
}

// Saludo automático con botones para chats de anuncio (CTWA / Cloud API). Replica el "saludo
// automático + botones" que ve el jugador al escribir desde un anuncio, sin salir de WhatsApp.
interface WelcomeCfg {
  waWelcomeEnabled: boolean; waWelcomeText: string | null; waWelcomeButtons: string | null;
  waAutoEnabled: boolean; waAutoWelcome: string | null; waAutoFollowup: string | null; waAutoBtnLabel: string | null; waAutoBtnUrl: string | null;
}
function WelcomeConfig() {
  const [enabled, setEnabled] = useState(false);
  const [text, setText] = useState("");
  const [btns, setBtns] = useState<string[]>(["", "", ""]);
  // Auto-responder con botón CTA (link).
  const [aEnabled, setAEnabled] = useState(false);
  const [aWelcome, setAWelcome] = useState("");
  const [aFollowup, setAFollowup] = useState("");
  const [aBtnLabel, setABtnLabel] = useState("");
  const [aBtnUrl, setABtnUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [ok, setOk] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false); // panel plegado: se abre al tocar "Configurar"

  useEffect(() => {
    api.get<{ welcome: WelcomeCfg | null }>("/api/wa/welcome")
      .then(({ data }) => {
        const w = data.welcome;
        if (w) {
          setEnabled(w.waWelcomeEnabled);
          setText(w.waWelcomeText ?? "");
          const parts = (w.waWelcomeButtons ?? "").split("|");
          setBtns([parts[0] ?? "", parts[1] ?? "", parts[2] ?? ""]);
          setAEnabled(w.waAutoEnabled); setAWelcome(w.waAutoWelcome ?? ""); setAFollowup(w.waAutoFollowup ?? "");
          setABtnLabel(w.waAutoBtnLabel ?? ""); setABtnUrl(w.waAutoBtnUrl ?? "");
          if (w.waWelcomeEnabled || w.waAutoEnabled) setOpen(true); // ya lo usa: no se lo escondemos
        }
      })
      .catch((e) => setError(apiError(e)))
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true); setError(null); setOk(false);
    try {
      const buttons = btns.map((b) => b.trim()).filter(Boolean).join("|");
      await api.patch("/api/wa/welcome", {
        waWelcomeEnabled: enabled, waWelcomeText: text.trim() || null, waWelcomeButtons: buttons || null,
        waAutoEnabled: aEnabled, waAutoWelcome: aWelcome.trim() || null, waAutoFollowup: aFollowup.trim() || null,
        waAutoBtnLabel: aBtnLabel.trim() || null, waAutoBtnUrl: aBtnUrl.trim() || null,
      });
      setOk(true); setTimeout(() => setOk(false), 2000);
    } catch (e) { setError(apiError(e)); }
    finally { setSaving(false); }
  };

  if (loading) return null;

  // Estas dos configuraciones son avanzadas y sólo aplican a líneas Cloud API: abiertas de entrada
  // tapaban lo importante (conectar el número). Van plegadas detrás de un botón; si el cliente ya
  // tiene alguna activa, se abren solas para que no queden "escondidas".
  if (!open) {
    const activas = [enabled, aEnabled].filter(Boolean).length;
    return (
      <Card className="mb-6 max-w-xl">
        <button type="button" onClick={() => setOpen(true)} className="flex w-full items-center gap-3 text-left">
          <span className="text-xl">💬</span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-slate-100">Respuestas automáticas</span>
            <span className="block text-xs text-slate-500">
              Saludo con botones y auto-respuesta para anuncios (líneas Cloud API).
            </span>
          </span>
          {activas > 0 && (
            <span className="shrink-0 rounded-full bg-wa-green/15 px-2 py-0.5 text-[11px] font-bold text-wa-green">
              {activas} activa{activas > 1 ? "s" : ""}
            </span>
          )}
          <span className="shrink-0 text-slate-400">Configurar ›</span>
        </button>
      </Card>
    );
  }

  return (
    <Card className="mb-6 max-w-xl">
      <button type="button" onClick={() => setOpen(false)} className="mb-3 text-xs font-medium text-slate-400 hover:text-slate-200">
        ‹ Ocultar respuestas automáticas
      </button>
      <div className="mb-1 flex items-center justify-between">
        <div className="text-sm font-semibold text-slate-100">💬 Saludo automático con botones (anuncios)</div>
        <label className="flex items-center gap-2 text-xs text-slate-400">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Activo
        </label>
      </div>
      <p className="mb-3 text-xs text-slate-500">
        Cuando alguien te escribe desde un anuncio (Click-to-WhatsApp) por una línea <b>Cloud API</b>, se le
        manda solo este saludo con botones. Máx 3 botones de 20 caracteres.
      </p>
      {error && <div className="mb-2"><ErrorMsg>{error}</ErrorMsg></div>}
      <label className="mb-1 block text-xs text-slate-400">Mensaje de saludo</label>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2}
        placeholder="Ej: ¡Hola! ¿Cómo podemos ayudarte?"
        className="mb-3 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-wa-green" />
      <label className="mb-1 block text-xs text-slate-400">Botones (hasta 3)</label>
      <div className="mb-3 space-y-2">
        {btns.map((b, i) => (
          <Input key={i} value={b} maxLength={20}
            onChange={(e) => setBtns((p) => p.map((x, j) => (j === i ? e.target.value : x)))}
            placeholder={i === 0 ? "Ej: Crear nuevo Usuario" : i === 1 ? "Ej: Ya tengo un usuario" : "Botón 3 (opcional)"} />
        ))}
      </div>
      <div className="my-4 border-t border-slate-800 pt-4">
        <div className="mb-1 flex items-center justify-between">
          <div className="text-sm font-semibold text-slate-100">🔗 Auto-responder con botón de link (Cloud API)</div>
          <label className="flex items-center gap-2 text-xs text-slate-400">
            <input type="checkbox" checked={aEnabled} onChange={(e) => setAEnabled(e.target.checked)} /> Activo
          </label>
        </div>
        <p className="mb-3 text-xs text-slate-500">
          Responde AUTOMÁTICO a cada mensaje con un botón que abre un link (ej. "Hablar con Meli"): el 1er mensaje
          usa la bienvenida, los siguientes el follow-up. ⚠️ En la Cloud API oficial mantené el texto <b>neutro</b>
          (sin casino/cargas/bono) y funneleá con el botón — el texto de casino te banea la cuenta.
        </p>
        <label className="mb-1 block text-xs text-slate-400">Bienvenida (1er mensaje)</label>
        <textarea value={aWelcome} onChange={(e) => setAWelcome(e.target.value)} rows={2}
          placeholder="Ej: ¡Hola! 👋 Tocá el botón y te atendemos al toque 👇"
          className="mb-3 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-wa-green" />
        <label className="mb-1 block text-xs text-slate-400">Follow-up (mensajes siguientes)</label>
        <textarea value={aFollowup} onChange={(e) => setAFollowup(e.target.value)} rows={2}
          placeholder="Ej: Ya te pasamos el contacto 👇"
          className="mb-3 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-wa-green" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_2fr]">
          <div>
            <label className="mb-1 block text-xs text-slate-400">Texto del botón (≤20)</label>
            <Input value={aBtnLabel} maxLength={20} onChange={(e) => setABtnLabel(e.target.value)} placeholder="Ej: Hablar con Meli" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">Link del botón</label>
            <Input value={aBtnUrl} onChange={(e) => setABtnUrl(e.target.value)} placeholder="https://wa.me/549... o https://chat.publi.lat/r/tu-cuenta" />
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button onClick={() => void save()} disabled={saving}>{saving ? "Guardando…" : "Guardar"}</Button>
        {ok && <span className="text-xs text-wa-green">✓ Guardado</span>}
      </div>
    </Card>
  );
}

export default function WhatsappPage() {
  const [lines, setLines] = useState<Line[]>([]);
  const [qrs, setQrs] = useState<Record<string, string>>({});
  // Líneas cuya sesión está ARRANCANDO (todavía sin QR): se muestra "generando…" y se re-pide solo.
  const [qrPending, setQrPending] = useState<Record<string, boolean>>({});
  const pendingTriesRef = useRef<Record<string, number>>({});
  const [pairingCodes, setPairingCodes] = useState<Record<string, string>>({});
  const [numberInputs, setNumberInputs] = useState<Record<string, string>>({});
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [activateDays, setActivateDays] = useState<Record<string, string>>({});
  const [activatingId, setActivatingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ id: string; text: string } | null>(null);
  // Días de crédito disponibles (encabezado de la sección).
  const [credit, setCredit] = useState<number | null>(null);
  useEffect(() => {
    api.get<{ days: number }>("/api/billing/credit").then(({ data }) => setCredit(data.days)).catch(() => undefined);
  }, []);
  // Alta: tipo de conexión + datos de Cloud API (CTWA).
  const [provider, setProvider] = useState<"baileys" | "cloud" | "external">("baileys");
  const [cloud, setCloud] = useState({ phoneNumberId: "", wabaId: "", accessToken: "", verifyToken: "", phone: "" });
  // Número externo (el WhatsApp vive en otro sistema, ej. Kommo): solo destino + tracking.
  const [externalPhone, setExternalPhone] = useState("");
  // Embedded Signup (Tech Provider).
  const [esConfig, setEsConfig] = useState<EsConfig | null>(null);
  const [fbReady, setFbReady] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [needsRetry, setNeedsRetry] = useState(false); // 409: WABA sin número verificado aún
  const [registeringId, setRegisteringId] = useState<string | null>(null);
  const [registerMsg, setRegisterMsg] = useState<{ id: string; ok: boolean; text: string } | null>(null);
  const [subscribingId, setSubscribingId] = useState<string | null>(null);
  const [subscribeMsg, setSubscribeMsg] = useState<{ id: string; ok: boolean; text: string } | null>(null);
  // Rampa de calentamiento por línea (los proxies son 100% del admin, no se ven acá).
  const [warmupBusyId, setWarmupBusyId] = useState<string | null>(null);
  const [showAntiBan, setShowAntiBan] = useState<Record<string, boolean>>({});
  const [engine, setEngine] = useState<string>("evolution");
  const esSessionRef = useRef<{ phoneNumberId?: string; wabaId?: string }>({});
  const lastAttemptRef = useRef<{ code: string; phoneNumberId?: string; wabaId?: string } | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get<{ lines: Line[]; engine?: string }>("/api/wa/lines");
      setLines(data.lines);
      if (data.engine) setEngine(data.engine);
    } catch (err) {
      setError(apiError(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // Config del Embedded Signup (appId/configId de nuestro Tech Provider).
    api
      .get<EsConfig>("/api/wa/cloud/config")
      .then(({ data }) => setEsConfig(data))
      .catch(() => undefined);
  }, []);

  // Carga el FB JS SDK una vez que tenemos el appId.
  useEffect(() => {
    if (!esConfig?.appId) return;
    if (window.FB) {
      setFbReady(true);
      return;
    }
    if (document.getElementById("fb-jssdk")) return;
    window.fbAsyncInit = () => {
      window.FB?.init({
        appId: esConfig.appId!,
        autoLogAppEvents: true,
        xfbml: false,
        version: esConfig.graphVersion,
      });
      setFbReady(true);
    };
    const s = document.createElement("script");
    s.id = "fb-jssdk";
    s.async = true;
    s.defer = true;
    s.crossOrigin = "anonymous";
    s.src = "https://connect.facebook.net/en_US/sdk.js";
    document.body.appendChild(s);
  }, [esConfig?.appId, esConfig?.graphVersion]);

  // Captura los datos que el popup de Embedded Signup manda por postMessage.
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (typeof event.origin !== "string" || !event.origin.endsWith("facebook.com")) return;
      // El SDK manda objetos o strings JSON. Solo parseamos si es string.
      let data: any = event.data;
      if (typeof data === "string") {
        try {
          data = JSON.parse(data);
        } catch {
          // mensajes no-JSON del SDK: se ignoran
          return;
        }
      }
      // Aceptamos cualquier evento del Embedded Signup (FINISH, FINISH_ONLY_WABA, etc.)
      // y vamos acumulando lo que venga: a veces el waba_id llega sin el phone_number_id.
      if (data?.type === "WA_EMBEDDED_SIGNUP") {
        const d = data.data ?? {};
        esSessionRef.current = {
          phoneNumberId: d.phone_number_id ?? esSessionRef.current.phoneNumberId,
          wabaId: d.waba_id ?? esSessionRef.current.wabaId,
        };
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  const finishConnect = async (code: string, phoneNumberId?: string, wabaId?: string) => {
    // Guardamos el último intento para poder reintentar el MISMO code (caso 409).
    lastAttemptRef.current = { code, phoneNumberId, wabaId };
    setConnecting(true);
    setError(null);
    setNeedsRetry(false);
    try {
      // El backend resuelve la WABA y el número con SOLO el code; lo demás es best-effort.
      const { data } = await api.post<{ line: Line }>("/api/wa/cloud/connect", {
        code,
        phoneNumberId: phoneNumberId || undefined,
        wabaId: wabaId || undefined,
        label: label || undefined,
      });
      await load(); // refresca la lista desde el server (aparece sí o sí)
      setLabel("");
      setNotice({ id: data.line.id, text: "WhatsApp conectado ✓" });
    } catch (err) {
      // 409: la WABA todavía no se compartió / no tiene número -> ofrecer reintento (mismo code).
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 409) setNeedsRetry(true);
      setError(apiError(err));
    } finally {
      setConnecting(false);
    }
  };

  const retryConnect = () => {
    const a = lastAttemptRef.current;
    if (a) void finishConnect(a.code, a.phoneNumberId, a.wabaId);
  };

  // Reintenta el registro del número de una línea Cloud en la Cloud API (saca de "Pendiente").
  const registerNumber = async (id: string) => {
    setRegisteringId(id);
    setRegisterMsg(null);
    try {
      const { data } = await api.post<{ registered: boolean; error?: string; line?: Line }>(
        `/api/wa/lines/${id}/register`,
      );
      if (data.line) setLines((prev) => prev.map((l) => (l.id === id ? data.line! : l)));
      setRegisterMsg({ id, ok: true, text: "Número registrado ✓" });
    } catch (err) {
      const body = (err as { response?: { data?: { error?: string; line?: Line } } })?.response?.data;
      if (body?.line) setLines((prev) => prev.map((l) => (l.id === id ? body.line! : l)));
      setRegisterMsg({ id, ok: false, text: body?.error ?? apiError(err) });
    } finally {
      setRegisteringId(null);
    }
  };

  // (Re)suscribe la WABA al webhook de la app: sin esto los mensajes entrantes no llegan.
  const subscribeWebhook = async (id: string) => {
    setSubscribingId(id);
    setSubscribeMsg(null);
    try {
      const { data } = await api.post<{ subscribed: boolean; error?: string }>(`/api/wa/lines/${id}/subscribe`);
      setSubscribeMsg({
        id,
        ok: data.subscribed,
        text: data.subscribed ? "Webhook reconectado ✓ (WABA suscrita)" : data.error ?? "La WABA no quedó suscrita",
      });
    } catch (err) {
      const body = (err as { response?: { data?: { error?: string } } })?.response?.data;
      setSubscribeMsg({ id, ok: false, text: body?.error ?? apiError(err) });
    } finally {
      setSubscribingId(null);
    }
  };

  const launchSignup = () => {
    if (!window.FB || !esConfig?.configId) {
      setError("Embedded Signup no está disponible todavía.");
      return;
    }
    setError(null);
    setNeedsRetry(false);
    esSessionRef.current = {};
    window.FB.login(
      (response: any) => {
        const code = response?.authResponse?.code;
        const sess = esSessionRef.current;
        // Con el `code` alcanza: el backend resuelve la WABA y el número.
        // phoneNumberId/wabaId del postMessage son best-effort (si llegaron, los mandamos).
        if (code) {
          void finishConnect(code, sess.phoneNumberId, sess.wabaId);
        } else {
          setError("No se completó la conexión (Meta no devolvió el código de autorización).");
        }
      },
      {
        config_id: esConfig.configId,
        response_type: "code",
        override_default_response_type: true,
        extras: { setup: {}, featureType: "", sessionInfoVersion: "3" },
      },
    );
  };

  useEffect(() => {
    const socket = getSocket();
    const onQr = (p: WaQrPayload) => {
      setQrs((prev) => ({ ...prev, [p.lineId]: p.qr }));
    };
    const onStatus = (p: WaStatusPayload) => {
      setLines((prev) =>
        prev.map((l) =>
          l.id === p.lineId ? { ...l, status: p.state, connected: p.connected } : l
        )
      );
      if (p.connected) {
        setQrs((prev) => {
          const next = { ...prev };
          delete next[p.lineId];
          return next;
        });
        setQrPending((prev) => {
          const next = { ...prev };
          delete next[p.lineId];
          return next;
        });
        setPairingCodes((prev) => {
          const next = { ...prev };
          delete next[p.lineId];
          return next;
        });
      }
    };
    const onHealth = (p: { lineId: string; connected: boolean; qualityRating: string | null }) => {
      setLines((prev) => prev.map((l) => (l.id === p.lineId ? { ...l, connected: p.connected, qualityRating: p.qualityRating } : l)));
    };
    socket.on("wa:qr", onQr);
    socket.on("wa:status", onStatus);
    socket.on("wa:health", onHealth);
    return () => {
      socket.off("wa:qr", onQr);
      socket.off("wa:status", onStatus);
      socket.off("wa:health", onHealth);
    };
  }, []);

  const createLine = async (e: FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      const payload =
        provider === "cloud"
          ? {
              provider: "cloud" as const,
              label: label || undefined,
              phone: cloud.phone || undefined,
              wabaPhoneNumberId: cloud.phoneNumberId,
              wabaId: cloud.wabaId || undefined,
              accessToken: cloud.accessToken,
              verifyToken: cloud.verifyToken,
            }
          : provider === "external"
            ? { provider: "external" as const, label: label || undefined, phone: externalPhone }
            : { label: label || undefined };
      const { data } = await api.post<{ line: Line; qr: string | null }>("/api/wa/lines", payload);
      setLines((prev) => [...prev, data.line]);
      if (data.qr) setQrs((prev) => ({ ...prev, [data.line.id]: data.qr! }));
      else if (data.line.provider === "baileys") setQrPending((prev) => ({ ...prev, [data.line.id]: true })); // el QR llega en segundos
      setLabel("");
      setExternalPhone("");
      setCloud({ phoneNumberId: "", wabaId: "", accessToken: "", verifyToken: "", phone: "" });
    } catch (err) {
      setError(apiError(err));
    } finally {
      setCreating(false);
    }
  };

  const quitarPending = (id: string) => {
    setQrPending((prev) => { const n = { ...prev }; delete n[id]; return n; });
    pendingTriesRef.current[id] = 0;
  };

  const connect = async (id: string, number?: string) => {
    setError(null);
    try {
      const { data } = await api.post<{
        qr: string | null; pairingCode: string | null; alreadyConnected?: boolean; status?: string; detail?: string | null;
      }>(`/api/wa/lines/${id}/connect`, number ? { number } : {});
      if (data.alreadyConnected) {
        // Ya estaba conectada: no hay QR que mostrar (y tocarla la desvincularía).
        quitarPending(id);
        setLines((prev) => prev.map((l) => (l.id === id ? { ...l, connected: true } : l)));
        setNotice({ id, text: "Esta línea ya está conectada ✓" });
        return;
      }
      if (data.qr) {
        setQrs((prev) => ({ ...prev, [id]: data.qr! }));
        quitarPending(id);
      }
      if (data.pairingCode) {
        setPairingCodes((prev) => ({ ...prev, [id]: data.pairingCode! }));
        // al vincular por número no usamos el QR
        setQrs((prev) => { const n = { ...prev }; delete n[id]; return n; });
        quitarPending(id);
      }
      if (!data.qr && !data.pairingCode) {
        if (data.status === "failed") {
          quitarPending(id);
          setError(data.detail || "WhatsApp rechazó la sesión. Probá «Reiniciar conexión».");
        } else {
          // La sesión todavía está arrancando: "generando…" y el poll de abajo lo vuelve a pedir.
          setQrPending((prev) => ({ ...prev, [id]: true }));
        }
      }
    } catch (err) {
      setError(apiError(err));
    }
  };

  // Auto-refresco del QR: el QR de Baileys/NOWEB se cicla cada ~20s; si el panel no lo refresca, se
  // vence antes de que el cliente lo escanee. Mientras una línea baileys muestra QR y sigue
  // desconectada, pedimos un QR fresco cada 18s. Refs para no re-crear el intervalo en cada render.
  const qrsRef = useRef(qrs); qrsRef.current = qrs;
  const linesRef = useRef(lines); linesRef.current = lines;
  useEffect(() => {
    const iv = window.setInterval(() => {
      for (const id of Object.keys(qrsRef.current)) {
        const l = linesRef.current.find((x) => x.id === id);
        if (l && !l.connected && l.provider === "baileys") void connect(id);
      }
    }, 18000);
    return () => window.clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // "Generando el código…": mientras una línea está en qrPending (sesión arrancando), re-pedimos el QR
  // cada 4 s hasta 15 veces (~1 min). El server ya NO reinicia nada al pedirlo, así que insistir es
  // seguro. Antes: la primera respuesta venía sin QR y no pasaba nada más → "no me genera el QR".
  const pendingRef = useRef(qrPending); pendingRef.current = qrPending;
  useEffect(() => {
    const iv = window.setInterval(() => {
      for (const id of Object.keys(pendingRef.current)) {
        const l = linesRef.current.find((x) => x.id === id);
        if (!l || l.connected || l.provider !== "baileys") { quitarPending(id); continue; }
        const tries = (pendingTriesRef.current[id] ?? 0) + 1;
        pendingTriesRef.current[id] = tries;
        if (tries > 15) {
          quitarPending(id);
          setError("La sesión no llegó a generar el código. Probá «Reiniciar conexión».");
          continue;
        }
        void connect(id);
      }
    }, 4000);
    return () => window.clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const linkByNumber = async (id: string) => {
    const raw = (numberInputs[id] ?? "").replace(/\D/g, "");
    if (raw.length < 8) {
      setError("Ingresá el número con código de país (ej: 549294xxxxxxx).");
      return;
    }
    setPairingCodes((prev) => { const n = { ...prev }; delete n[id]; return n; });
    await connect(id, raw);
  };

  // Reinicia una línea trabada (se desconectó varias veces): recrea la instancia limpia.
  const resetLine = async (id: string) => {
    setError(null);
    setPairingCodes((prev) => { const n = { ...prev }; delete n[id]; return n; });
    setQrs((prev) => { const n = { ...prev }; delete n[id]; return n; });
    try {
      const { data } = await api.post<{ ok: boolean; qr: string | null }>(`/api/wa/lines/${id}/reset`);
      if (data.qr) setQrs((prev) => ({ ...prev, [id]: data.qr! }));
      else setQrPending((prev) => ({ ...prev, [id]: true })); // todavía arrancando: el poll lo trae
      setNotice({ id, text: "Conexión reiniciada. Escaneá el QR o vinculá por número de nuevo." });
    } catch (err) {
      setError(apiError(err));
    }
  };

  const checkStatus = async (id: string) => {
    setError(null);
    try {
      const { data } = await api.get<{ state: string; connected: boolean; line: Line }>(
        `/api/wa/lines/${id}/status`
      );
      setLines((prev) => prev.map((l) => (l.id === id ? data.line : l)));
    } catch (err) {
      setError(apiError(err));
    }
  };

  const logout = async (id: string) => {
    setError(null);
    try {
      const { data } = await api.post<{ ok: boolean; line: Line }>(
        `/api/wa/lines/${id}/logout`
      );
      setLines((prev) => prev.map((l) => (l.id === id ? data.line : l)));
    } catch (err) {
      setError(apiError(err));
    }
  };

  const remove = async (id: string) => {
    setError(null);
    try {
      await api.delete(`/api/wa/lines/${id}`);
      setLines((prev) => prev.filter((l) => l.id !== id));
    } catch (err) {
      setError(apiError(err));
    }
  };

  const setStatus = async (id: string, action: "pause" | "resume") => {
    setError(null);
    try {
      const { data } = await api.post<{ line: { id: string; status: string } }>(`/api/wa/lines/${id}/${action}`);
      setLines((prev) => prev.map((l) => (l.id === id ? { ...l, status: data.line.status } : l)));
    } catch (err) {
      setError(apiError(err));
    }
  };


  // Activa/desactiva la rampa de calentamiento de la línea.
  const toggleWarmup = async (line: Line) => {
    setWarmupBusyId(line.id);
    setError(null);
    try {
      const { data } = await api.post<{ line: { id: string; warmupEnabled: boolean }; warmup: Line["warmup"] }>(
        `/api/wa/lines/${line.id}/warmup`,
        { enabled: !(line.warmupEnabled ?? true) },
      );
      setLines((prev) =>
        prev.map((l) => (l.id === line.id ? { ...l, warmupEnabled: data.line.warmupEnabled, warmup: data.warmup } : l)),
      );
    } catch (err) {
      setError(apiError(err));
    } finally {
      setWarmupBusyId(null);
    }
  };

  const activate = async (id: string) => {
    const raw = activateDays[id] ?? "1";
    const n = parseInt(raw, 10);
    if (!Number.isInteger(n) || n <= 0) {
      setError("Ingresá una cantidad de días válida (entero mayor a 0).");
      return;
    }
    // Aviso si la línea YA está activa: cada "Activar" SUMA días (se descuentan del crédito). Sin esto,
    // tocar el botón dos veces gastaba días sin querer (caso freydis: 2 clicks -> 2 días de una).
    const line = lines.find((l) => l.id === id);
    if (line?.expiresAt && new Date(line.expiresAt) > new Date()) {
      const hasta = new Date(line.expiresAt).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
      if (!window.confirm(`Esta línea YA está activa hasta el ${hasta}. Cada activación suma días (se descuentan de tu crédito). ¿Sumar ${n} día${n === 1 ? "" : "s"} más?`)) return;
    }
    setActivatingId(id);
    setError(null);
    setNotice(null);
    try {
      const { data } = await api.post<ActivateResponse>(
        `/api/wa/lines/${id}/activate`,
        { days: n }
      );
      setLines((prev) =>
        prev.map((l) =>
          l.id === id
            ? { ...l, status: data.line.status, expiresAt: data.line.expiresAt }
            : l
        )
      );
      setNotice({
        id,
        text: `Línea activada. Crédito restante: ${data.creditDays} día${
          data.creditDays === 1 ? "" : "s"
        }.`,
      });
    } catch (err) {
      setError(apiError(err));
    } finally {
      setActivatingId(null);
    }
  };

  return (
    <div className="p-6">
      <h1 className="mb-2 text-xl font-bold">WhatsApp</h1>
      <p className="mb-5 text-sm text-slate-400">
        Conecte su número por QR o con la API oficial de Meta para anuncios Click-to-WhatsApp.
      </p>

      {/* Días disponibles arriba de todo: es lo que define si el servicio está prendido. */}
      <div className="mb-5 flex max-w-xl flex-wrap items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
        <div>
          <div className="text-xs text-slate-400">Días disponibles</div>
          <div className={`text-2xl font-extrabold ${credit != null && credit <= 3 ? "text-rose-400" : "text-slate-100"}`}>
            {credit ?? "—"}
          </div>
        </div>
        <p className="min-w-[180px] flex-1 text-xs text-slate-500">
          Cada día activa <b className="text-slate-300">una línea por 24 horas</b>. Si tiene 2 líneas prendidas,
          consume 2 días por jornada.
        </p>
        <a href="/billing" className="rounded-lg bg-wa-green px-4 py-2 text-sm font-bold text-slate-900 transition hover:brightness-110">
          + Agregar días
        </a>
      </div>

      {/* Guía corta de conexión: lo primero que necesita quien entra por primera vez. */}
      <div className="mb-5 max-w-xl rounded-xl border border-slate-800 bg-slate-900/40 p-4">
        <div className="mb-2 text-sm font-semibold text-slate-100">📲 Cómo conectar su número</div>
        <ol className="space-y-1.5 text-xs text-slate-400">
          <li><b className="text-slate-300">1.</b> Agregue el número abajo (con código de país, sin + ni espacios).</li>
          <li><b className="text-slate-300">2.</b> Asígnele días para activarlo.</li>
          <li><b className="text-slate-300">3.</b> Toque <b className="text-slate-300">Conectar QR</b> y escanee desde ese teléfono: WhatsApp → Dispositivos vinculados → Vincular un dispositivo.</li>
          <li><b className="text-slate-300">4.</b> Listo: los mensajes entran en la sección Mensajes y quedan registrados en el CRM.</li>
        </ol>
        <p className="mt-2 text-[11px] text-slate-500">
          Importante: mantenga el teléfono con internet. Si se desconecta, vuelva a escanear el QR desde esta pantalla.
        </p>
      </div>

      <WelcomeConfig />

      <Card className="mb-6 max-w-xl">
        {/* Selector de tipo de conexión */}
        <div className="mb-4 grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => setProvider("baileys")}
            className={`rounded-md border p-3 text-left transition ${
              provider === "baileys" ? "border-wa-green bg-wa-green/10" : "border-slate-700 bg-slate-900/40 hover:border-slate-600"
            }`}
          >
            <div className="text-sm font-semibold text-slate-100">Conexión por QR</div>
            <div className="mt-0.5 text-xs text-slate-500">Baileys — escaneás el QR. Para el flujo de landing.</div>
          </button>
          <button
            type="button"
            onClick={() => setProvider("cloud")}
            className={`rounded-md border p-3 text-left transition ${
              provider === "cloud" ? "border-wa-green bg-wa-green/10" : "border-slate-700 bg-slate-900/40 hover:border-slate-600"
            }`}
          >
            <div className="text-sm font-semibold text-slate-100">API oficial (Cloud API)</div>
            <div className="mt-0.5 text-xs text-slate-500">Para anuncios Click-to-WhatsApp (CTWA).</div>
          </button>
          <button
            type="button"
            onClick={() => setProvider("external")}
            className={`rounded-md border p-3 text-left transition ${
              provider === "external" ? "border-wa-green bg-wa-green/10" : "border-slate-700 bg-slate-900/40 hover:border-slate-600"
            }`}
          >
            <div className="text-sm font-semibold text-slate-100">Número externo</div>
            <div className="mt-0.5 text-xs text-slate-500">Tu WhatsApp vive en otro sistema (Kommo, etc.). Solo destino + tracking.</div>
          </button>
        </div>

        <div className="rounded-lg border border-sky-800/50 bg-sky-500/10 px-3 py-2 text-xs text-sky-200">
          📶 Podés tener hasta <b>5 líneas</b>. ¿Necesitás más? <b>Escribinos a soporte</b> y te lo ampliamos.
        </div>

        <form onSubmit={createLine} className="space-y-2">
          <Input
            placeholder="Etiqueta de la línea (ej: Ventas)"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />

          {provider === "cloud" ? (
            <div className="space-y-3">
              {esConfig?.appId && esConfig?.configId ? (
                <>
                  <Button type="button" onClick={launchSignup} disabled={!fbReady || connecting} className="w-full">
                    {connecting ? "Conectando…" : fbReady ? "Conectar WhatsApp (oficial)" : "Cargando…"}
                  </Button>
                  <p className="text-xs text-slate-500">
                    Se abre un popup de Meta para elegir/crear tu cuenta de WhatsApp Business y
                    autorizar a Publi. No tenés que copiar ningún token.
                  </p>
                </>
              ) : (
                <p className="rounded-md border border-amber-800 bg-amber-900/30 px-3 py-2 text-xs text-amber-200">
                  ⚠️ El registro oficial (Embedded Signup) todavía no está configurado en el
                  servidor. Mientras tanto podés cargar las credenciales a mano (Avanzado).
                </p>
              )}

              <button
                type="button"
                onClick={() => setShowAdvanced((v) => !v)}
                className="text-xs text-slate-400 underline hover:text-slate-200"
              >
                {showAdvanced ? "Ocultar carga manual" : "Avanzado: cargar credenciales manualmente"}
              </button>

              {showAdvanced && (
                <div className="space-y-2 rounded-md border border-slate-800 bg-slate-900/40 p-3">
                  <Input
                    placeholder="Phone Number ID"
                    value={cloud.phoneNumberId}
                    onChange={(e) => setCloud((c) => ({ ...c, phoneNumberId: e.target.value }))}
                  />
                  <Input
                    placeholder="WhatsApp Business Account ID (opcional)"
                    value={cloud.wabaId}
                    onChange={(e) => setCloud((c) => ({ ...c, wabaId: e.target.value }))}
                  />
                  <Input
                    placeholder="Access Token (permanente, del System User)"
                    value={cloud.accessToken}
                    onChange={(e) => setCloud((c) => ({ ...c, accessToken: e.target.value }))}
                  />
                  <Input
                    placeholder="Verify Token (lo inventás vos; lo pegás en Meta)"
                    value={cloud.verifyToken}
                    onChange={(e) => setCloud((c) => ({ ...c, verifyToken: e.target.value }))}
                  />
                  <Input
                    placeholder="Número de la línea (opcional, ej 595…)"
                    value={cloud.phone}
                    onChange={(e) => setCloud((c) => ({ ...c, phone: e.target.value }))}
                  />
                  <Button type="submit" disabled={creating}>
                    {creating ? "…" : "Conectar Cloud API (manual)"}
                  </Button>
                </div>
              )}
            </div>
          ) : provider === "external" ? (
            <div className="space-y-2">
              <Input
                placeholder="Número de WhatsApp con código de país (ej: 595971234567)"
                value={externalPhone}
                onChange={(e) => setExternalPhone(e.target.value)}
              />
              <p className="text-xs text-slate-500">
                Es el número que ya usás en tu otro sistema (ej. Kommo). Publi.lat NO lo conecta ni
                recibe sus chats: lo usa como destino del link rastreado y dispara el Lead con tu
                pixel. Consume días igual que una línea propia.
              </p>
              <Button type="submit" disabled={creating || externalPhone.replace(/\D/g, "").length < 6}>
                {creating ? "…" : "Agregar número externo"}
              </Button>
            </div>
          ) : (
            <Button type="submit" disabled={creating}>
              {creating ? "…" : "Crear línea"}
            </Button>
          )}
        </form>
      </Card>

      {/* Post-migración de motor: las sesiones no viajan, hay que re-escanear UNA vez. */}
      {engine === "waha" && lines.some((l) => l.provider === "baileys" && !l.connected) && (
        <div className="mb-4 max-w-3xl rounded-md border border-amber-700 bg-amber-900/30 px-4 py-3 text-sm text-amber-100">
          <b>⚙️ Actualizamos el motor de WhatsApp para mejorar la entrega de mensajes.</b>{" "}
          Reconectá tu número una sola vez: tocá <b>"Conectar / Ver QR"</b> en tu línea y escaneá
          el código (o vinculá por número). Tus chats, contactos e historial no se pierden.
        </div>
      )}

      {error && (
        <div className="mb-4">
          <ErrorMsg>{error}</ErrorMsg>
          {needsRetry && (
            <div className="mt-2">
              <Button type="button" onClick={retryConnect} disabled={connecting}>
                {connecting ? "Reintentando…" : "Reintentar conexión"}
              </Button>
            </div>
          )}
        </div>
      )}

      {loading ? (
        <p className="text-slate-400">Cargando…</p>
      ) : lines.length === 0 ? (
        <p className="text-slate-500">No tenés líneas todavía. Creá una arriba.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {lines.map((line) => {
            const qr = qrs[line.id];
            const isCloud = line.provider === "cloud";
            const isExternal = line.provider === "external";
            const isBaileys = line.provider === "baileys";
            return (
              <Card key={line.id}>
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <StatusDot ok={line.connected} />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{line.label || "Sin etiqueta"}</span>
                        {isCloud && (
                          <span className="rounded-full bg-wa-green/15 px-2 py-0.5 text-[10px] font-semibold text-wa-green">
                            Oficial / CTWA
                          </span>
                        )}
                        {isExternal && (
                          <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] font-semibold text-sky-300">
                            Número externo
                          </span>
                        )}
                        {line.qualityRating && (
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                            line.qualityRating === "GREEN" ? "bg-wa-green/15 text-wa-green"
                              : line.qualityRating === "YELLOW" ? "bg-amber-500/15 text-amber-300"
                              : "bg-rose-500/15 text-rose-300"}`}>
                            Calidad {line.qualityRating}
                          </span>
                        )}
                        {line.warmup?.active && (
                          <span
                            className="rounded-full bg-orange-500/15 px-2 py-0.5 text-[10px] font-semibold text-orange-300"
                            title={`Rampa anti-ban: la línea es nueva y tiene un cupo de envíos que sube con los días (hoy ${line.warmup.used ?? 0}/${line.warmup.cap} en 24 h).`}
                          >
                            🔥 Calentando día {line.warmup.day}/{line.warmup.totalDays} · {line.warmup.used ?? 0}/{line.warmup.cap}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-400">
                        {line.phone || "Sin número"} ·{" "}
                        <span
                          className={
                            line.status === "active"
                              ? "font-semibold text-wa-green"
                              : line.status === "recovering"
                                ? "font-semibold text-sky-400"
                                : line.status === "paused"
                                  ? "font-semibold text-amber-400"
                                  : "text-slate-500"
                          }
                        >
                          {line.status === "active"
                            ? "activa"
                            : line.status === "recovering"
                              ? "🔄 reconectando sola…"
                              : line.status === "paused"
                                ? "pausada"
                                : line.status}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="text-right text-xs">
                    {!line.expiresAt ? (
                      <span className="text-slate-500">sin días asignados</span>
                    ) : isExpired(line.expiresAt) ? (
                      <span className="font-semibold text-rose-400">vencida</span>
                    ) : (
                      <span className="text-slate-400">
                        <span className="block text-wa-green">
                          activa hasta {fmtDate(line.expiresAt)}
                        </span>
                        <span className="block text-slate-500">
                          {fmtRemaining(line.expiresAt)}
                        </span>
                      </span>
                    )}
                  </div>
                </div>

                {isCloud ? (
                  <div className="mb-3 space-y-2 rounded-md border border-slate-800 bg-slate-900/40 p-3 text-xs">
                    {/* Estado de registro en la Cloud API */}
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2">
                      {line.registered ? (
                        <span className="font-semibold text-wa-green">● Número registrado</span>
                      ) : (
                        <span className="font-semibold text-amber-400">● Pendiente de registro</span>
                      )}
                      {!line.registered && (
                        <Button
                          variant="secondary"
                          disabled={registeringId === line.id}
                          onClick={() => void registerNumber(line.id)}
                        >
                          {registeringId === line.id ? "Registrando…" : "Registrar número"}
                        </Button>
                      )}
                    </div>
                    {registerMsg && registerMsg.id === line.id && (
                      <p className={registerMsg.ok ? "text-wa-green" : "text-rose-400"}>{registerMsg.text}</p>
                    )}
                    <div>
                      <span className="text-slate-400">Phone Number ID: </span>
                      <code className="break-all text-slate-200">{line.wabaPhoneNumberId}</code>
                    </div>
                    <div>
                      <span className="text-slate-400">Verify Token: </span>
                      <code className="break-all text-slate-200">{line.verifyToken}</code>
                    </div>
                    <div className="text-slate-400">Webhook URL (pegar en Meta):</div>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 break-all rounded bg-slate-900 px-2 py-1 text-slate-200">{line.webhookUrl}</code>
                      <Button variant="secondary" onClick={() => void navigator.clipboard.writeText(line.webhookUrl ?? "")}>
                        Copiar
                      </Button>
                    </div>
                    {/* Re-suscribir la WABA al webhook (si no llegan los mensajes entrantes) */}
                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 pt-2">
                      <span className="text-slate-500">¿No llegan los mensajes al Inbox?</span>
                      <Button
                        variant="secondary"
                        disabled={subscribingId === line.id}
                        onClick={() => void subscribeWebhook(line.id)}
                      >
                        {subscribingId === line.id ? "Reconectando…" : "Reconectar webhook"}
                      </Button>
                    </div>
                    {subscribeMsg && subscribeMsg.id === line.id && (
                      <p className={subscribeMsg.ok ? "text-wa-green" : "text-rose-400"}>{subscribeMsg.text}</p>
                    )}
                  </div>
                ) : isExternal ? (
                  <div className="mb-3 rounded-md border border-sky-500/30 bg-sky-500/5 px-3 py-2 text-xs text-slate-300">
                    El WhatsApp de este número lo gestionás en tu otro sistema (ej. Kommo). Publi.lat lo usa como
                    destino del link rastreado y dispara el <b>Lead</b> con tu pixel. Los chats <b>no</b> entran al Inbox de acá.
                  </div>
                ) : line.connected ? (
                  <div className="mb-3 rounded-md border border-wa-green/40 bg-wa-green/10 px-3 py-2 text-sm text-wa-green">
                    Línea conectada
                  </div>
                ) : line.status === "recovering" ? (
                  <div className="mb-3 rounded-md border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-sm text-sky-200">
                    🔄 Se cayó un momento — el sistema la está <b>reconectando sola</b>. No hace falta que hagas nada.
                  </div>
                ) : qr ? (
                  <div className="mb-3 flex justify-center rounded-md bg-white p-2">
                    <img src={qr} alt="QR" className="h-44 w-44" />
                  </div>
                ) : qrPending[line.id] ? (
                  <div className="mb-3 flex items-center gap-2 rounded-md border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-sm text-sky-200">
                    <span className="inline-block h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-sky-300 border-t-transparent" />
                    Generando el código QR… tarda unos segundos.
                  </div>
                ) : null}

                {isBaileys && !line.connected && pairingCodes[line.id] && (
                  <div className="mb-3 rounded-md border border-wa-green/40 bg-slate-900/60 p-3 text-center">
                    <div className="text-xs text-slate-400">Código de vinculación</div>
                    <div className="my-1 text-2xl font-bold tracking-[0.3em] text-wa-green">{pairingCodes[line.id]}</div>
                    <div className="text-xs text-slate-500">
                      En WhatsApp: <b>Ajustes → Dispositivos vinculados → Vincular dispositivo → Vincular con número de teléfono</b>, y escribí este código.
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  {isBaileys && (
                    <>
                      <Button variant="secondary" onClick={() => void connect(line.id)}>
                        Conectar / Ver QR
                      </Button>
                      <Button variant="secondary" onClick={() => void checkStatus(line.id)}>
                        Estado
                      </Button>
                      <Button variant="ghost" onClick={() => void resetLine(line.id)}>
                        Reiniciar conexión
                      </Button>
                    </>
                  )}
                  {line.status === "paused" ? (
                    <Button variant="secondary" onClick={() => void setStatus(line.id, "resume")}>
                      Reanudar
                    </Button>
                  ) : (
                    <Button variant="ghost" onClick={() => void setStatus(line.id, "pause")}>
                      Pausar
                    </Button>
                  )}
                  {isBaileys && (
                    <Button variant="ghost" onClick={() => void logout(line.id)}>
                      Desvincular
                    </Button>
                  )}
                  <Button variant="danger" onClick={() => void remove(line.id)}>
                    Borrar
                  </Button>
                </div>

                {isBaileys && !line.connected && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Input
                      value={numberInputs[line.id] ?? ""}
                      onChange={(e) => setNumberInputs((p) => ({ ...p, [line.id]: e.target.value }))}
                      placeholder="Número con país (ej: 549294xxxxxxx)"
                      className="max-w-[240px]"
                    />
                    <Button variant="secondary" onClick={() => void linkByNumber(line.id)}>
                      Vincular por número
                    </Button>
                  </div>
                )}

                {isBaileys && (
                  <div className="mt-3 border-t border-slate-800 pt-3 text-xs">
                    <button
                      type="button"
                      onClick={() => setShowAntiBan((p) => ({ ...p, [line.id]: !p[line.id] }))}
                      className="text-slate-400 underline hover:text-slate-200"
                    >
                      {showAntiBan[line.id] ? "Ocultar anti-ban (proxy / calentamiento)" : "Anti-ban: proxy y calentamiento"}
                    </button>
                    {showAntiBan[line.id] && (
                      <div className="mt-2 space-y-3 rounded-md border border-slate-800 bg-slate-900/40 p-3">
                        {/* Rampa de calentamiento */}
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <div className="font-semibold text-slate-200">Calentamiento (rampa de envíos)</div>
                            <div className="text-slate-500">
                              {line.warmup?.active
                                ? `Día ${line.warmup.day} de ${line.warmup.totalDays}: cupo de ${line.warmup.cap} envíos/24 h (llevás ${line.warmup.used ?? 0}).`
                                : (line.warmupEnabled ?? true)
                                  ? "Activo. Limita los envíos los primeros días de una línea recién emparejada (anti-ban)."
                                  : "Desactivado: la línea envía sin cupo. Con números nuevos es riesgo de baneo/463."}
                            </div>
                          </div>
                          <Button
                            variant={line.warmupEnabled ?? true ? "ghost" : "secondary"}
                            disabled={warmupBusyId === line.id}
                            onClick={() => void toggleWarmup(line)}
                          >
                            {warmupBusyId === line.id ? "…" : (line.warmupEnabled ?? true) ? "Desactivar" : "Activar"}
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div className="mt-3 border-t border-slate-800 pt-3">
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={1}
                      step={1}
                      className="w-20"
                      value={activateDays[line.id] ?? "1"}
                      onChange={(e) =>
                        setActivateDays((prev) => ({
                          ...prev,
                          [line.id]: e.target.value,
                        }))
                      }
                    />
                    <Button
                      onClick={() => void activate(line.id)}
                      disabled={activatingId === line.id}
                    >
                      {activatingId === line.id
                        ? "…"
                        : `Activar +${parseInt(activateDays[line.id] ?? "1", 10) || 1} día${(parseInt(activateDays[line.id] ?? "1", 10) || 1) === 1 ? "" : "s"}`}
                    </Button>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    Cada día que agregás <b>usa 1 día de tu crédito</b> y mantiene la línea prendida
                    24 h más. Ej: <b>+7 = la línea anda una semana y usás 7 días de tu crédito.</b>
                  </p>
                  {notice && notice.id === line.id && (
                    <p className="mt-1 text-xs text-wa-green">{notice.text}</p>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
