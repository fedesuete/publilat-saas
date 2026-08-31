import { useEffect, useState, type FormEvent } from "react";
import { api, apiError } from "../lib/api";
import { Button, Input, Card, ErrorMsg } from "../components/ui";

type Mode = "nativo" | "webhook" | "kommo";

interface Integration {
  mode: Mode;
  webhookUrl: string | null;
  secret: string | null;
  onLead: boolean;
  onPurchase: boolean;
  enabled: boolean;
  inboundPurchaseUrl?: string | null;
  // Conexión nativa con Kommo (webhooks nativos + API): sin Salesbot, todo automático.
  kommoBaseUrl?: string | null;
  kommoTokenSet?: boolean;
  kommoWebhookUrl?: string | null;
  // Formularios de Meta (Lead Ads): captura del lead + respuesta automática por WhatsApp.
  metaPageId?: string | null;
  metaPageTokenSet?: boolean;
  leadgenEnabled?: boolean;
  leadgenLineId?: string | null;
  leadgenReply?: string | null;
  leadgenReplies?: Variant[];
  leadgenWebhookUrl?: string | null;
  leadgenVerifyToken?: string | null;
}

interface LineOpt { id: string; label: string | null; phone: string }
interface ClipOpt { id: string; title: string }
// Una variante de la respuesta automática: texto o audio de la biblioteca.
type Variant = { kind: "text"; body: string } | { kind: "audio"; clipId: string };
const DEFAULT_LEAD_REPLY =
  "¡Hola {{nombre}}! 👋 Gracias por dejarnos tus datos. Te escribo para contarte cómo seguimos, ¿te viene bien ahora?";

const MODE_HELP: Record<Mode, string> = {
  nativo: "Sin webhook saliente. Los eventos quedan solo en Publi.lat.",
  webhook: "POST genérico a tu URL por cada lead y/o compra.",
  kommo: "Mismo payload, pensado para un webhook entrante de Kommo.",
};

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-md border border-slate-700 bg-slate-800 px-3 py-2">
      <span className="text-sm text-slate-200">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-wa-green"
      />
    </label>
  );
}

export default function IntegrationsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  const [mode, setMode] = useState<Mode>("nativo");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [onLead, setOnLead] = useState(true);
  const [onPurchase, setOnPurchase] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [inboundUrl, setInboundUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // Conexión nativa con Kommo
  const [kommoUrl, setKommoUrl] = useState("");
  const [kommoToken, setKommoToken] = useState("");
  const [kommoTokenSet, setKommoTokenSet] = useState(false);
  const [kommoWebhook, setKommoWebhook] = useState<string | null>(null);
  const [kommoSaving, setKommoSaving] = useState(false);
  const [kommoCopied, setKommoCopied] = useState(false);
  const [kommoOk, setKommoOk] = useState<string | null>(null);
  // Formularios de Meta (Lead Ads)
  const [pageId, setPageId] = useState("");
  const [pageToken, setPageToken] = useState("");
  const [pageTokenSet, setPageTokenSet] = useState(false);
  const [lgEnabled, setLgEnabled] = useState(false);
  const [lgLineId, setLgLineId] = useState("");
  const [lgReply, setLgReply] = useState("");
  const [variants, setVariants] = useState<Variant[]>([]);
  const [clips, setClips] = useState<ClipOpt[]>([]);
  const [lgHook, setLgHook] = useState<{ url: string | null; verify: string | null }>({ url: null, verify: null });
  const [lgSaving, setLgSaving] = useState(false);
  const [lgOk, setLgOk] = useState<string | null>(null);
  const [lgCopied, setLgCopied] = useState<string | null>(null);
  const [lines, setLines] = useState<LineOpt[]>([]);

  useEffect(() => {
    api.get<{ lines: LineOpt[] }>("/api/wa/lines")
      .then(({ data }) => setLines(data.lines ?? []))
      .catch(() => undefined); // sin líneas el selector queda en "la que esté activa"
    api.get<{ items: ClipOpt[] }>("/api/inbox/audio-clips")
      .then(({ data }) => setClips(data.items ?? []))
      .catch(() => undefined); // sin audios, solo se pueden agregar variantes de texto
  }, []);

  const saveLeadgen = async () => {
    setLgSaving(true);
    setError(null);
    setLgOk(null);
    try {
      const { data } = await api.put<{ integration: Integration }>("/api/integrations", {
        metaPageId: pageId.trim() ? pageId.trim() : null,
        ...(pageToken.trim() ? { metaPageToken: pageToken.trim() } : {}), // vacío = no tocar el guardado
        leadgenEnabled: lgEnabled,
        leadgenLineId: lgLineId ? lgLineId : null,
        leadgenReply: lgReply.trim() ? lgReply.trim() : null,
        leadgenReplies: variants.filter((v) => (v.kind === "text" ? v.body.trim() : v.clipId)),
      });
      applyIntegration(data.integration);
      setPageToken("");
      setLgOk("Guardado ✔");
    } catch (err) {
      setError(apiError(err));
    } finally {
      setLgSaving(false);
    }
  };

  const applyIntegration = (i: Integration) => {
    setMode(i.mode);
    setWebhookUrl(i.webhookUrl ?? "");
    setSecret(i.secret ?? "");
    setOnLead(i.onLead);
    setOnPurchase(i.onPurchase);
    setEnabled(i.enabled);
    setInboundUrl(i.inboundPurchaseUrl ?? null);
    setKommoUrl(i.kommoBaseUrl ?? "");
    setKommoTokenSet(Boolean(i.kommoTokenSet));
    setKommoWebhook(i.kommoWebhookUrl ?? null);
    setPageId(i.metaPageId ?? "");
    setPageTokenSet(Boolean(i.metaPageTokenSet));
    setLgEnabled(Boolean(i.leadgenEnabled));
    setLgLineId(i.leadgenLineId ?? "");
    setLgReply(i.leadgenReply ?? "");
    setVariants(Array.isArray(i.leadgenReplies) ? i.leadgenReplies : []);
    setLgHook({ url: i.leadgenWebhookUrl ?? null, verify: i.leadgenVerifyToken ?? null });
  };

  const saveKommo = async () => {
    setKommoSaving(true);
    setError(null);
    setKommoOk(null);
    try {
      const { data } = await api.put<{ integration: Integration }>("/api/integrations", {
        kommoBaseUrl: kommoUrl.trim() ? kommoUrl.trim() : null,
        // El token solo se manda si el usuario escribió uno nuevo (vacío = no tocar el guardado).
        ...(kommoToken.trim() ? { kommoToken: kommoToken.trim() } : {}),
      });
      applyIntegration(data.integration);
      setKommoToken("");
      setKommoOk("Guardado. Ahora pegá el webhook en Kommo (paso 3).");
    } catch (err) {
      setError(apiError(err));
    } finally {
      setKommoSaving(false);
    }
  };

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get<{ integration: Integration }>("/api/integrations");
      applyIntegration(data.integration);
    } catch (err) {
      setError(apiError(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setTestResult(null);
    try {
      const trimmedUrl = webhookUrl.trim();
      const trimmedSecret = secret.trim();
      const { data } = await api.put<{ integration: Integration }>("/api/integrations", {
        mode,
        webhookUrl: trimmedUrl ? trimmedUrl : null,
        secret: trimmedSecret ? trimmedSecret : null,
        onLead,
        onPurchase,
        enabled,
      });
      applyIntegration(data.integration);
    } catch (err) {
      setError(apiError(err));
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    setError(null);
    setTestResult(null);
    try {
      const { data } = await api.post<{ ok: boolean; status: number }>(
        "/api/integrations/test"
      );
      if (data.ok) {
        setTestResult(`OK — el endpoint respondió ${data.status}.`);
      } else {
        setError(`La prueba falló (status ${data.status}).`);
      }
    } catch (err) {
      setError(apiError(err));
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="p-6">
      <h1 className="mb-2 text-xl font-bold">Integraciones</h1>
      <p className="mb-5 text-sm text-slate-400">
        Reenviá leads y compras a un CRM externo. El webhook/Kommo solo se dispara cuando
        está <span className="text-slate-200">Activado</span> y el modo es{" "}
        <span className="text-slate-200">webhook</span> o{" "}
        <span className="text-slate-200">kommo</span>.
      </p>

      {error && (
        <div className="mb-4">
          <ErrorMsg>{error}</ErrorMsg>
        </div>
      )}

      {testResult && (
        <div className="mb-4 rounded-md border border-emerald-800 bg-emerald-900/40 px-3 py-2 text-sm text-emerald-200">
          {testResult}
        </div>
      )}

      {loading ? (
        <p className="text-slate-400">Cargando…</p>
      ) : (
        <Card className="max-w-lg">
          <form onSubmit={save} className="space-y-4">
            <div>
              <label className="mb-1 block text-xs text-slate-400">Modo</label>
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value as Mode)}
                className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 outline-none focus:border-wa-green"
              >
                <option value="nativo">nativo</option>
                <option value="webhook">webhook</option>
                <option value="kommo">kommo</option>
              </select>
              <p className="mt-1 text-xs text-slate-500">{MODE_HELP[mode]}</p>
            </div>

            <div>
              <label className="mb-1 block text-xs text-slate-400">URL del webhook</label>
              <Input
                type="url"
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
                placeholder="https://tu-crm.com/webhook"
              />
              <p className="mt-1 text-xs text-slate-500">
                Dejala vacía para no enviar a ninguna URL.
              </p>
            </div>

            <div>
              <label className="mb-1 block text-xs text-slate-400">Secret (opcional)</label>
              <Input
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder="firma HMAC-SHA256"
              />
              <p className="mt-1 text-xs text-slate-500">
                Si lo cargás, se firma el payload con HMAC-SHA256 en el header{" "}
                <span className="font-mono text-slate-400">X-Publilat-Signature</span>.
              </p>
            </div>

            <div className="space-y-2">
              <Toggle label="Enviar en Lead" checked={onLead} onChange={setOnLead} />
              <Toggle label="Enviar en Compra" checked={onPurchase} onChange={setOnPurchase} />
              <Toggle label="Activado" checked={enabled} onChange={setEnabled} />
            </div>

            <div className="flex gap-2">
              <Button type="submit" disabled={saving}>
                {saving ? "Guardando…" : "Guardar"}
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={testing}
                onClick={() => void test()}
              >
                {testing ? "Probando…" : "Probar"}
              </Button>
            </div>
          </form>
        </Card>
      )}

      {/* Formularios de Meta (Lead Ads): el lead entra solo y le contestamos por WhatsApp al instante. */}
      {!loading && (
        <Card className="mt-6 max-w-lg">
          <div className="mb-1 text-sm font-semibold text-slate-100">
            Formularios de Meta (Lead Ads) {lgEnabled && pageTokenSet && <span className="text-emerald-400">· activo ✓</span>}
          </div>
          <p className="mb-3 text-xs text-slate-400">
            Cuando alguien completa tu formulario en Facebook/Instagram, el contacto entra solo al CRM y le
            mandamos el WhatsApp automáticamente — sin esperar a que alguien lo vea.
          </p>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs text-slate-400">ID de tu página de Facebook</label>
              <Input value={pageId} onChange={(e) => setPageId(e.target.value)} placeholder="1121925017675878" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400">
                Token de la página {pageTokenSet && <span className="text-emerald-400">(ya cargado — pegá uno nuevo solo para reemplazarlo)</span>}
              </label>
              <Input type="password" value={pageToken} onChange={(e) => setPageToken(e.target.value)} placeholder={pageTokenSet ? "••••••••••••" : "Page access token"} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400">Responder desde la línea</label>
              <select
                value={lgLineId}
                onChange={(e) => setLgLineId(e.target.value)}
                className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 outline-none focus:border-wa-green"
              >
                <option value="">La que esté activa (automático)</option>
                {lines.map((l) => (
                  <option key={l.id} value={l.id}>{l.label || l.phone}</option>
                ))}
              </select>
            </div>
            {/* Variantes ROTATIVAS: por cada lead se manda UNA al azar (texto o audio). Mandar el
                mismo mensaje a decenas de números es un patrón que WhatsApp marca como spam. */}
            <div>
              <label className="mb-1 block text-xs text-slate-400">
                Mensajes automáticos (se manda uno al azar por cada lead)
              </label>
              <div className="space-y-2">
                {variants.map((v, i) => (
                  <div key={i} className="rounded-md border border-slate-700 bg-slate-800/60 p-2">
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-[11px] font-semibold text-slate-400">
                        {v.kind === "text" ? `📝 Texto ${i + 1}` : `🎤 Audio ${i + 1}`}
                      </span>
                      <button
                        type="button"
                        onClick={() => setVariants(variants.filter((_, j) => j !== i))}
                        className="text-xs text-rose-400 hover:text-rose-300"
                      >
                        Quitar
                      </button>
                    </div>
                    {v.kind === "text" ? (
                      <textarea
                        value={v.body}
                        onChange={(e) => setVariants(variants.map((x, j) => (j === i ? { kind: "text", body: e.target.value } : x)))}
                        rows={2}
                        placeholder={DEFAULT_LEAD_REPLY}
                        className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 outline-none focus:border-wa-green"
                      />
                    ) : (
                      <select
                        value={v.clipId}
                        onChange={(e) => setVariants(variants.map((x, j) => (j === i ? { kind: "audio", clipId: e.target.value } : x)))}
                        className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 outline-none focus:border-wa-green"
                      >
                        <option value="">— elegí un audio de tu biblioteca —</option>
                        {clips.map((c) => (<option key={c.id} value={c.id}>{c.title}</option>))}
                      </select>
                    )}
                  </div>
                ))}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button type="button" variant="secondary" onClick={() => setVariants([...variants, { kind: "text", body: "" }])}>
                  + Agregar texto
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={!clips.length}
                  onClick={() => setVariants([...variants, { kind: "audio", clipId: clips[0]?.id ?? "" }])}
                >
                  + Agregar audio
                </Button>
              </div>
              <p className="mt-2 text-[11px] text-slate-500">
                Variables para los textos: <span className="font-mono">{"{{nombre}}"}</span>,{" "}
                <span className="font-mono">{"{{nombre_completo}}"}</span>,{" "}
                <span className="font-mono">{"{{email}}"}</span>,{" "}
                <span className="font-mono">{"{{respuesta}}"}</span> (lo que eligió en el formulario).
                <br />Los audios salen de <b>Inbox → biblioteca de audios</b>, y cada envío va con una copia
                única (WhatsApp no los ve como el mismo archivo repetido).
                {!clips.length && <><br /><b>No tenés audios cargados todavía</b> — subilos desde el Inbox y aparecen acá.</>}
                <br />Sin ningún mensaje cargado, el lead se guarda igual pero NO se le escribe.
              </p>
            </div>
            <Toggle label="Activar captura y respuesta automática" checked={lgEnabled} onChange={setLgEnabled} />
            <Button type="button" disabled={lgSaving} onClick={() => void saveLeadgen()}>
              {lgSaving ? "Guardando…" : "Guardar"}
            </Button>
            {lgOk && <p className="text-xs text-emerald-300">{lgOk}</p>}
          </div>
          {lgHook.url && (
            <div className="mt-4 border-t border-slate-800 pt-3">
              <p className="mb-2 text-xs text-slate-400">
                Estos dos datos se cargan UNA vez en tu app de Meta (Webhooks → Página → campo <span className="font-mono">leadgen</span>):
              </p>
              {[{ k: "URL de devolución", v: lgHook.url }, { k: "Token de verificación", v: lgHook.verify }].map((row) => (
                <div key={row.k} className="mb-2">
                  <label className="mb-1 block text-[11px] text-slate-500">{row.k}</label>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 break-all rounded-md border border-slate-700 bg-slate-900/60 px-3 py-2 text-xs text-slate-200">{row.v || "—"}</code>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => {
                        if (!row.v) return;
                        void navigator.clipboard.writeText(row.v);
                        setLgCopied(row.k);
                        setTimeout(() => setLgCopied(null), 1500);
                      }}
                    >
                      {lgCopied === row.k ? "¡Listo!" : "Copiar"}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* Conexión NATIVA con Kommo (automática, estilo ScaleOS): URL + token y un webhook. */}
      {!loading && (
        <Card className="mt-6 max-w-lg">
          <div className="mb-1 text-sm font-semibold text-slate-100">
            Conexión con Kommo (automática) {kommoTokenSet && <span className="text-emerald-400">· conectada ✓</span>}
          </div>
          <ol className="mb-4 list-decimal space-y-1 pl-4 text-xs text-slate-400">
            <li>
              En Kommo: <b>Configuración → Integraciones → API</b> → creá un{" "}
              <b>token de larga duración</b> (lectura de leads, contactos y mensajes).
            </li>
            <li>Pegá acá tu URL de Kommo y ese token, y guardá.</li>
            <li>
              En Kommo: <b>Configuración → Webhooks → Agregar webhook</b> → pegá la URL de abajo.
            </li>
            <li>
              Tildá los eventos <b>“Etapa del lead modificada”</b> y <b>“Mensaje entrante”</b>.
            </li>
            <li>
              Listo: cuando un lead pase a una etapa <b>ganada/compró</b>, la venta se registra sola y
              se envía el <b>Purchase</b> a Meta con la atribución del anuncio.
            </li>
          </ol>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs text-slate-400">URL de tu Kommo</label>
              <Input
                type="url"
                value={kommoUrl}
                onChange={(e) => setKommoUrl(e.target.value)}
                placeholder="https://tuempresa.kommo.com"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400">
                Token de larga duración {kommoTokenSet && <span className="text-emerald-400">(ya cargado — pegá uno nuevo solo para reemplazarlo)</span>}
              </label>
              <Input
                type="password"
                value={kommoToken}
                onChange={(e) => setKommoToken(e.target.value)}
                placeholder={kommoTokenSet ? "••••••••••••" : "pegá el token acá"}
              />
            </div>
            <Button type="button" disabled={kommoSaving} onClick={() => void saveKommo()}>
              {kommoSaving ? "Guardando…" : "Guardar conexión"}
            </Button>
            {kommoOk && <p className="text-xs text-emerald-300">{kommoOk}</p>}
          </div>
          {kommoWebhook && (
            <div className="mt-4">
              <label className="mb-1 block text-xs text-slate-400">Webhook para pegar en Kommo (paso 3)</label>
              <div className="flex items-center gap-2">
                <code className="flex-1 break-all rounded-md border border-slate-700 bg-slate-900/60 px-3 py-2 text-xs text-slate-200">
                  {kommoWebhook}
                </code>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    void navigator.clipboard.writeText(kommoWebhook);
                    setKommoCopied(true);
                    setTimeout(() => setKommoCopied(false), 1500);
                  }}
                >
                  {kommoCopied ? "¡Listo!" : "Copiar"}
                </Button>
              </div>
              <p className="mt-2 text-[11px] text-slate-500">
                El monto de la venta sale del <b>presupuesto (precio)</b> del lead en Kommo — cargalo antes
                de moverlo a la etapa ganada. Detectamos como “ganada” la etapa <i>Logrado con éxito</i> de
                Kommo o cualquier etapa cuyo nombre incluya <i>ganado / compró / venta / aprobado / pagado</i>.
                La URL lleva tu token secreto — no la compartas.
              </p>
            </div>
          )}
        </Card>
      )}

      {/* Webhook ENTRANTE: Kommo/otro CRM → Publi.lat dispara el Purchase al cerrar la venta. */}
      {!loading && inboundUrl && (
        <Card className="mt-6 max-w-lg">
          <div className="mb-1 text-sm font-semibold text-slate-100">
            Webhook de compra (Kommo → Publi.lat)
          </div>
          <p className="mb-3 text-xs text-slate-400">
            Pegá esta URL en un <b>Salesbot de Kommo</b> que se dispare cuando la venta pasa a
            “ganada”, y enviá un <span className="font-mono">POST</span>. Tenés dos formas de
            identificar la venta:
            <br />• <b>Simple (recomendado):</b> por <span className="font-mono">phone</span> (el
            teléfono del cliente) — casi todos los CRM lo tienen a mano.
            <br />• <b>Preciso:</b> por <span className="font-mono">ref</span> (el código que llegó
            en el primer mensaje, ej. <span className="font-mono">ref: 28C4B…</span>).
            <br />Publi.lat matchea el contacto y dispara el <b>Purchase</b> a Meta con el mismo identificador.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 break-all rounded-md border border-slate-700 bg-slate-900/60 px-3 py-2 text-xs text-slate-200">
              {inboundUrl}
            </code>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                void navigator.clipboard.writeText(inboundUrl);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? "¡Listo!" : "Copiar"}
            </Button>
          </div>
          <p className="mt-2 text-[11px] text-slate-500">
            Ejemplo simple: <span className="font-mono">{`{"phone":"5491112345678","amount":15000}`}</span>{" "}
            · o por código: <span className="font-mono">{`{"ref":"28C4B1A2","amount":15000}`}</span>.
            La moneda es <span className="font-mono">ARS</span> por defecto. La URL lleva tu token secreto — no la compartas.
          </p>
        </Card>
      )}
    </div>
  );
}
