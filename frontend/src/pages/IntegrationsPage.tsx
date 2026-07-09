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
}

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

  const applyIntegration = (i: Integration) => {
    setMode(i.mode);
    setWebhookUrl(i.webhookUrl ?? "");
    setSecret(i.secret ?? "");
    setOnLead(i.onLead);
    setOnPurchase(i.onPurchase);
    setEnabled(i.enabled);
    setInboundUrl(i.inboundPurchaseUrl ?? null);
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

      {/* Webhook ENTRANTE: Kommo/otro CRM → Publi.lat dispara el Purchase al cerrar la venta. */}
      {!loading && inboundUrl && (
        <Card className="mt-6 max-w-lg">
          <div className="mb-1 text-sm font-semibold text-slate-100">
            Webhook de compra (Kommo → Publi.lat)
          </div>
          <p className="mb-3 text-xs text-slate-400">
            Pegá esta URL en un <b>Salesbot de Kommo</b> que se dispare cuando la venta pasa a
            “ganada”. Enviá un <span className="font-mono">POST</span> con{" "}
            <span className="font-mono">{`{ ref, amount }`}</span> (el <span className="font-mono">ref</span> es el
            código que llegó en el primer mensaje, ej. <span className="font-mono">ref: 28C4B…</span>). Publi.lat
            matchea el contacto y dispara el <b>Purchase</b> a Meta con el mismo identificador.
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
            Cuerpo de ejemplo: <span className="font-mono">{`{"ref":"28C4B1A2","amount":15000,"currency":"PYG"}`}</span>.
            La URL lleva tu token secreto — no la compartas.
          </p>
        </Card>
      )}
    </div>
  );
}
