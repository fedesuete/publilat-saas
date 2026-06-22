import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, apiError } from "../lib/api";
import { Button, Card, ErrorMsg } from "../components/ui";

interface SetupStatus { pixel: boolean; landing: boolean; whatsapp: boolean; }
type Mode = "nativo" | "webhook" | "kommo";
type PayMode = "off" | "assisted" | "auto";

const PAY_MODES: Array<{ key: PayMode; label: string; desc: string }> = [
  { key: "off", label: "Manual", desc: "Marcás la compra a mano en Agenda/Leads. No detecta nada del chat." },
  {
    key: "assisted",
    label: "Semi-automático",
    desc: "Detecta el pago en el chat (texto o comprobante por imagen) y te lo resalta con el monto pre-cargado. Confirmás con 1 clic. Recomendado.",
  },
  {
    key: "auto",
    label: "Automático",
    desc: "Al detectar el comprobante con monto y confianza alta, marca COMPRÓ y dispara el Purchase a Meta solo, sin tocar nada.",
  },
];

const STEPS: Array<{ key: keyof SetupStatus; title: string; desc: string; to: string; cta: string }> = [
  { key: "pixel", title: "Cargá tu Pixel", desc: "Tu Pixel ID + token de CAPI para atribuir a tu cuenta de Meta.", to: "/pixel", cta: "Ir a Mi Pixel" },
  { key: "landing", title: "Publicá una landing", desc: "Una landing rastreada con el Pixel y el botón de WhatsApp.", to: "/landings", cta: "Ir a Landings" },
  { key: "whatsapp", title: "Conectá WhatsApp", desc: "Escaneá el QR para conectar tu línea y recibir los chats.", to: "/whatsapp", cta: "Ir a WhatsApp" },
];

const MODES: Array<{ key: Mode; label: string; desc: string }> = [
  { key: "nativo", label: "Nativo", desc: "Sin webhook saliente. Todo se maneja en Publi.lat." },
  { key: "webhook", label: "Webhook", desc: "POST a tu URL por cada lead y compra (con firma HMAC)." },
  { key: "kommo", label: "Kommo", desc: "Mismo payload, para un webhook entrante de Kommo." },
];

export default function SetupPage() {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [mode, setMode] = useState<Mode>("nativo");
  const [payMode, setPayMode] = useState<PayMode>("off");
  const [payAi, setPayAi] = useState(false);
  const [savingPay, setSavingPay] = useState(false);
  const [loading, setLoading] = useState(true);
  const [savingMode, setSavingMode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, i, p] = await Promise.all([
        api.get<SetupStatus>("/api/setup/status"),
        api.get<{ integration: { mode: Mode } }>("/api/integrations"),
        api.get<{ mode: PayMode; aiEnabled: boolean }>("/api/setup/payment-detection"),
      ]);
      setStatus(s.data);
      setMode(i.data.integration.mode);
      setPayMode(p.data.mode);
      setPayAi(p.data.aiEnabled);
    } catch (err) {
      setError(apiError(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const saveMode = async (m: Mode) => {
    setSavingMode(true);
    setError(null);
    setSavedMsg(null);
    try {
      await api.put("/api/integrations", { mode: m });
      setMode(m);
      setSavedMsg("Modo de integración guardado.");
    } catch (err) {
      setError(apiError(err));
    } finally {
      setSavingMode(false);
    }
  };

  const savePayMode = async (m: PayMode) => {
    setSavingPay(true);
    setError(null);
    setSavedMsg(null);
    try {
      await api.put("/api/setup/payment-detection", { mode: m });
      setPayMode(m);
      setSavedMsg("Modo de detección de pago guardado.");
    } catch (err) {
      setError(apiError(err));
    } finally {
      setSavingPay(false);
    }
  };

  const done = status ? [status.pixel, status.landing, status.whatsapp].filter(Boolean).length : 0;

  return (
    <div className="p-6">
      <h1 className="mb-1 text-xl font-bold">Configuración</h1>
      <p className="mb-5 text-sm text-slate-400">Completá estos pasos para dejar el loop de atribución listo.</p>

      {error && <div className="mb-4"><ErrorMsg>{error}</ErrorMsg></div>}

      {loading ? (
        <p className="text-slate-400">Cargando…</p>
      ) : (
        <div className="space-y-6">
          {/* Checklist */}
          <Card>
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-semibold text-slate-200">Primeros pasos</div>
              <div className="text-xs text-slate-400">{done}/3 completados</div>
            </div>
            <div className="space-y-2">
              {STEPS.map((step) => {
                const ok = status?.[step.key] ?? false;
                return (
                  <div key={step.key} className="flex items-center gap-3 rounded-md border border-slate-800 bg-slate-900/40 px-3 py-2.5">
                    <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${ok ? "bg-wa-green text-slate-900" : "bg-slate-700 text-slate-300"}`}>
                      {ok ? "✓" : ""}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-slate-100">{step.title}</div>
                      <div className="truncate text-xs text-slate-500">{step.desc}</div>
                    </div>
                    {ok ? (
                      <span className="shrink-0 text-xs font-medium text-wa-green">Listo</span>
                    ) : (
                      <Link to={step.to} className="shrink-0">
                        <Button variant="secondary">{step.cta}</Button>
                      </Link>
                    )}
                  </div>
                );
              })}
            </div>
            {done === 3 && (
              <p className="mt-3 rounded-md border border-emerald-800 bg-emerald-900/40 px-3 py-2 text-sm text-emerald-200">
                🎉 ¡Todo listo! Tu loop de atribución está operativo.
              </p>
            )}
          </Card>

          {/* Modo de integración */}
          <Card>
            <div className="mb-1 text-sm font-semibold text-slate-200">Modo de integración con CRM</div>
            <p className="mb-3 text-xs text-slate-500">
              Cómo se reparten los leads/compras a un CRM externo. Configurá la URL y el secret en{" "}
              <Link to="/integraciones" className="text-wa-green hover:underline">Integraciones</Link>.
            </p>
            <div className="grid gap-2 md:grid-cols-3">
              {MODES.map((m) => (
                <button
                  key={m.key}
                  onClick={() => void saveMode(m.key)}
                  disabled={savingMode}
                  className={`rounded-md border p-3 text-left transition disabled:opacity-60 ${
                    mode === m.key ? "border-wa-green bg-wa-green/10" : "border-slate-700 bg-slate-900/40 hover:border-slate-600"
                  }`}
                >
                  <div className="text-sm font-semibold text-slate-100">{m.label}</div>
                  <div className="mt-0.5 text-xs text-slate-500">{m.desc}</div>
                </button>
              ))}
            </div>
            {savedMsg && <p className="mt-2 text-xs text-emerald-300">{savedMsg}</p>}
          </Card>

          {/* Detección de pago en el chat */}
          <Card>
            <div className="mb-1 text-sm font-semibold text-slate-200">Detección de pago en el chat</div>
            <p className="mb-3 text-xs text-slate-500">
              El CRM puede detectar cuándo un cliente pagó leyendo el chat: por texto
              (“ya pagué”, “te paso el comprobante”) y por <b>comprobante en imagen con IA</b>.
              Elegí cómo querés que actúe.
            </p>
            <div className="grid gap-2 md:grid-cols-3">
              {PAY_MODES.map((m) => (
                <button
                  key={m.key}
                  onClick={() => void savePayMode(m.key)}
                  disabled={savingPay}
                  className={`rounded-md border p-3 text-left transition disabled:opacity-60 ${
                    payMode === m.key ? "border-wa-green bg-wa-green/10" : "border-slate-700 bg-slate-900/40 hover:border-slate-600"
                  }`}
                >
                  <div className="text-sm font-semibold text-slate-100">{m.label}</div>
                  <div className="mt-0.5 text-xs text-slate-500">{m.desc}</div>
                </button>
              ))}
            </div>
            {payMode !== "off" && !payAi && (
              <p className="mt-2 rounded-md border border-amber-800 bg-amber-900/30 px-3 py-2 text-xs text-amber-200">
                ⚠️ La lectura de comprobantes por imagen necesita una clave de IA
                (<code>ANTHROPIC_API_KEY</code>) en el servidor. Sin ella, la detección por
                <b> texto</b> igual funciona.
              </p>
            )}
            {payMode === "auto" && (
              <p className="mt-2 text-xs text-slate-500">
                En automático sólo se dispara el Purchase cuando la IA lee el monto con
                confianza alta. Si no, queda como “pago a confirmar”.
              </p>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
