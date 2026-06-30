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

export default function WhatsappPage() {
  const [lines, setLines] = useState<Line[]>([]);
  const [qrs, setQrs] = useState<Record<string, string>>({});
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [activateDays, setActivateDays] = useState<Record<string, string>>({});
  const [activatingId, setActivatingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ id: string; text: string } | null>(null);
  // Alta: tipo de conexión + datos de Cloud API (CTWA).
  const [provider, setProvider] = useState<"baileys" | "cloud">("baileys");
  const [cloud, setCloud] = useState({ phoneNumberId: "", wabaId: "", accessToken: "", verifyToken: "", phone: "" });
  // Embedded Signup (Tech Provider).
  const [esConfig, setEsConfig] = useState<EsConfig | null>(null);
  const [fbReady, setFbReady] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [needsRetry, setNeedsRetry] = useState(false); // 409: WABA sin número verificado aún
  const esSessionRef = useRef<{ phoneNumberId?: string; wabaId?: string }>({});
  const lastAttemptRef = useRef<{ code: string; phoneNumberId?: string; wabaId?: string } | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get<{ lines: Line[] }>("/api/wa/lines");
      setLines(data.lines);
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
          // [DIAG] mensaje no-JSON del SDK: lo logueamos pero seguimos.
          console.log("[ES] message no-JSON ignorado <-", event.origin, ":", event.data);
          return;
        }
      }
      // [DIAG] todo lo que llega del popup, para ver qué falta (type/event/ids).
      console.log("[ES] message <-", event.origin, {
        type: data?.type,
        event: data?.event,
        phone_number_id: data?.data?.phone_number_id,
        waba_id: data?.data?.waba_id,
      });
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
        // [DIAG] qué tenemos al cerrar el popup: code + ids capturados por postMessage.
        console.log("[ES] FB.login callback", {
          hasCode: !!code,
          phoneNumberId: sess.phoneNumberId,
          wabaId: sess.wabaId,
        });
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
      }
    };
    socket.on("wa:qr", onQr);
    socket.on("wa:status", onStatus);
    return () => {
      socket.off("wa:qr", onQr);
      socket.off("wa:status", onStatus);
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
          : { label: label || undefined };
      const { data } = await api.post<{ line: Line; qr: string | null }>("/api/wa/lines", payload);
      setLines((prev) => [...prev, data.line]);
      if (data.qr) setQrs((prev) => ({ ...prev, [data.line.id]: data.qr! }));
      setLabel("");
      setCloud({ phoneNumberId: "", wabaId: "", accessToken: "", verifyToken: "", phone: "" });
    } catch (err) {
      setError(apiError(err));
    } finally {
      setCreating(false);
    }
  };

  const connect = async (id: string) => {
    setError(null);
    try {
      const { data } = await api.post<{ qr: string | null; pairingCode: string | null }>(
        `/api/wa/lines/${id}/connect`
      );
      if (data.qr) setQrs((prev) => ({ ...prev, [id]: data.qr! }));
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

  const activate = async (id: string) => {
    const raw = activateDays[id] ?? "1";
    const n = parseInt(raw, 10);
    if (!Number.isInteger(n) || n <= 0) {
      setError("Ingresá una cantidad de días válida (entero mayor a 0).");
      return;
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
        Conectá por QR (Baileys) o con la API oficial (Cloud API) para anuncios Click-to-WhatsApp.
      </p>

      <Card className="mb-6 max-w-xl">
        {/* Selector de tipo de conexión */}
        <div className="mb-4 grid grid-cols-2 gap-2">
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
          ) : (
            <Button type="submit" disabled={creating}>
              {creating ? "…" : "Crear línea"}
            </Button>
          )}
        </form>
      </Card>

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
                      </div>
                      <div className="text-xs text-slate-400">
                        {line.phone || "Sin número"} ·{" "}
                        <span
                          className={
                            line.status === "active"
                              ? "font-semibold text-wa-green"
                              : line.status === "paused"
                                ? "font-semibold text-amber-400"
                                : "text-slate-500"
                          }
                        >
                          {line.status === "active" ? "activa" : line.status === "paused" ? "pausada" : line.status}
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
                  </div>
                ) : line.connected ? (
                  <div className="mb-3 rounded-md border border-wa-green/40 bg-wa-green/10 px-3 py-2 text-sm text-wa-green">
                    Línea conectada
                  </div>
                ) : qr ? (
                  <div className="mb-3 flex justify-center rounded-md bg-white p-2">
                    <img src={qr} alt="QR" className="h-44 w-44" />
                  </div>
                ) : null}

                <div className="flex flex-wrap gap-2">
                  {!isCloud && (
                    <>
                      <Button variant="secondary" onClick={() => void connect(line.id)}>
                        Conectar / Ver QR
                      </Button>
                      <Button variant="secondary" onClick={() => void checkStatus(line.id)}>
                        Estado
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
                  {!isCloud && (
                    <Button variant="ghost" onClick={() => void logout(line.id)}>
                      Desvincular
                    </Button>
                  )}
                  <Button variant="danger" onClick={() => void remove(line.id)}>
                    Borrar
                  </Button>
                </div>

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
                      {activatingId === line.id ? "…" : "Activar (días)"}
                    </Button>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    1 día = 24 h de línea activa. Consume días del crédito.
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
