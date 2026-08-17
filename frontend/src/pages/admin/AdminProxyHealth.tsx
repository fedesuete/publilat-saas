import { useCallback, useEffect, useState } from "react";
import { api, apiError } from "../../lib/api";
import { fmtDate } from "../../lib/format";
import { Button, ErrorMsg } from "../../components/ui";

// Fase 5 — Estabilidad de proxies (test IPRoyal). Muestra, por línea de prueba y ventana de tiempo:
// cambios de IP, caídas/reconexiones, uptime %, IP actual y un timeline de la sesión + cortes.
interface TimelinePoint { ts: string; ip: string | null; state: string | null; err: string | null; ipChanged: boolean; flaps: number }
interface LineHealth {
  lineId: string; label: string | null; phone: string | null;
  currentIp: string | null; currentState: string | null; lastSampleAt: string | null;
  samples: number; ipChanges: number; flaps: number;
  workingSamples: number; restrictedSamples: number; uptimePct: number;
  timeline: TimelinePoint[];
}

const WINDOWS = [
  { h: 24, label: "24 h" },
  { h: 48, label: "48 h" },
  { h: 168, label: "7 días" },
];

// Color del segmento del timeline según el estado/erro de la muestra.
function tone(p: TimelinePoint): string {
  if (p.err === "515_restricted") return "#f97316"; // naranja: restringida por WhatsApp
  if (p.state === "WORKING" || p.state === "open") return "#22c55e"; // verde: conectada
  if (p.state === "SCAN_QR_CODE" || p.state === "connecting") return "#eab308"; // amarillo: esperando QR
  if (p.err === "probe_fail") return "#64748b"; // gris: no salió a internet
  return "#ef4444"; // rojo: caída/desconectada
}

function uptimeColor(pct: number): string {
  if (pct >= 98) return "text-emerald-400";
  if (pct >= 90) return "text-amber-400";
  return "text-rose-400";
}

interface IproyalBalance { enabled: boolean; availableGb?: number; lowThreshold: number; low?: boolean; subusers?: number; error?: string }

export default function AdminProxyHealth() {
  const [hours, setHours] = useState(24);
  const [lines, setLines] = useState<LineHealth[]>([]);
  const [balance, setBalance] = useState<IproyalBalance | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setError(null);
    try {
      const { data } = await api.get<{ hours: number; lines: LineHealth[] }>(`/api/admin/proxy-health?hours=${hours}`);
      setLines(data.lines);
    } catch (e) {
      setError(apiError(e));
    } finally {
      setLoading(false);
    }
    // Saldo de GB de la cuenta IPRoyal (best-effort, no bloquea el panel).
    try {
      const { data } = await api.get<IproyalBalance>(`/api/admin/iproyal-balance`);
      setBalance(data);
    } catch { /* no-op */ }
  }, [hours]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 60_000); // refresco cada 1 min
    return () => clearInterval(t);
  }, [load]);

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Estabilidad de proxies</h1>
          <p className="text-sm text-slate-400">Test IPRoyal residencial AR (sticky 7d). Menos cambios de IP y menos caídas = mejor.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex overflow-hidden rounded-lg border border-slate-700">
            {WINDOWS.map((w) => (
              <button key={w.h} onClick={() => setHours(w.h)}
                className={`px-3 py-1.5 text-xs font-medium ${hours === w.h ? "bg-wa-green text-slate-900" : "bg-slate-900 text-slate-300 hover:bg-slate-800"}`}>
                {w.label}
              </button>
            ))}
          </div>
          <Button onClick={() => void load()}>Actualizar</Button>
        </div>
      </div>

      {error && <ErrorMsg>{error}</ErrorMsg>}

      {/* Saldo de tráfico IPRoyal (GB restantes). Verde/ámbar/rojo según el umbral. */}
      {balance?.enabled && (
        <div className={`mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4 ${
          balance.availableGb == null
            ? "border-slate-700 bg-slate-900/60"
            : balance.low
              ? "border-rose-500/50 bg-rose-950/30"
              : balance.availableGb < balance.lowThreshold * 2
                ? "border-amber-500/40 bg-amber-950/20"
                : "border-emerald-600/40 bg-emerald-950/20"
        }`}>
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-400">Saldo IPRoyal (tráfico)</div>
            {balance.availableGb == null ? (
              <div className="text-sm text-slate-400">{balance.error ?? "No se pudo leer el saldo"}</div>
            ) : (
              <div className="flex items-baseline gap-2">
                <span className={`text-3xl font-bold ${balance.low ? "text-rose-400" : balance.availableGb < balance.lowThreshold * 2 ? "text-amber-400" : "text-emerald-400"}`}>
                  {balance.availableGb.toFixed(2)}
                </span>
                <span className="text-sm text-slate-400">GB restantes</span>
              </div>
            )}
          </div>
          {balance.low && (
            <a href="https://dashboard.iproyal.com" target="_blank" rel="noreferrer"
              className="rounded-lg bg-rose-500 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-400">
              ⚠️ Cargar GB (bajo umbral {balance.lowThreshold} GB)
            </a>
          )}
        </div>
      )}

      {!loading && lines.length === 0 && (
        <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-8 text-center text-sm text-slate-400">
          Todavía no hay líneas de prueba con proxy IPRoyal. Cuando se levanten las líneas shadow (Fase 6), acá vas a ver
          la IP, los cambios y las caídas de cada una en vivo.
        </div>
      )}

      <div className="space-y-4">
        {lines.map((l) => {
          const name = l.label || l.phone || l.lineId.slice(0, 8);
          return (
            <div key={l.lineId} className="rounded-xl border border-slate-700 bg-slate-900/60 p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="font-semibold text-slate-100">{name}</div>
                  <div className="text-xs text-slate-400">
                    IP actual: <span className="font-mono text-slate-200">{l.currentIp ?? "—"}</span>
                    <span className="ml-2 rounded bg-slate-800 px-1.5 py-0.5">{l.currentState ?? "?"}</span>
                    {l.lastSampleAt && <span className="ml-2">· últ. muestra {fmtDate(l.lastSampleAt)}</span>}
                  </div>
                </div>
                <div className="flex gap-4 text-center">
                  <Stat value={l.ipChanges} label="cambios IP" tone={l.ipChanges === 0 ? "text-emerald-400" : "text-amber-400"} />
                  <Stat value={l.flaps} label="caídas" tone={l.flaps === 0 ? "text-emerald-400" : l.flaps > 20 ? "text-rose-400" : "text-amber-400"} />
                  <Stat value={`${l.uptimePct}%`} label="uptime" tone={uptimeColor(l.uptimePct)} />
                  <Stat value={l.samples} label="muestras" tone="text-slate-300" />
                </div>
              </div>

              {/* Timeline: una barrita por muestra (cada 5 min), coloreada por estado. */}
              {l.timeline.length > 0 ? (
                <div className="flex h-6 w-full overflow-hidden rounded" style={{ gap: 1 }}>
                  {l.timeline.map((p, i) => (
                    <div key={i} title={`${fmtDate(p.ts)}\n${p.ip ?? "sin IP"} · ${p.state ?? "?"}${p.err && p.err !== "none" ? " · " + p.err : ""}${p.ipChanged ? " · CAMBIÓ IP" : ""}${p.flaps ? ` · ${p.flaps} caídas` : ""}`}
                      className="flex-1"
                      style={{ background: tone(p), minWidth: 2, boxShadow: p.ipChanged ? "inset 0 0 0 2px #fff" : undefined }} />
                  ))}
                </div>
              ) : (
                <div className="text-xs text-slate-500">Sin muestras en la ventana.</div>
              )}
              <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-slate-500">
                <Legend color="#22c55e" text="conectada" />
                <Legend color="#eab308" text="esperando QR" />
                <Legend color="#f97316" text="restringida" />
                <Legend color="#ef4444" text="caída" />
                <Legend color="#64748b" text="sin salida" />
                <span className="ml-auto">borde blanco = cambió la IP</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Stat({ value, label, tone }: { value: number | string; label: string; tone: string }) {
  return (
    <div>
      <div className={`text-lg font-bold ${tone}`}>{value}</div>
      <div className="text-[11px] text-slate-500">{label}</div>
    </div>
  );
}

function Legend({ color, text }: { color: string; text: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: color }} /> {text}
    </span>
  );
}
