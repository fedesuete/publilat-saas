import { useEffect, useState } from "react";
import { api, apiError } from "../lib/api";
import type { Stage } from "../lib/types";
import { fmtAmount } from "../lib/format";
import { Button, Card, ErrorMsg, StageBadge } from "../components/ui";

interface Totals {
  leads: number; nuevo: number; contactado: number; interesado: number;
  compro: number; perdido: number; revenue: number; conversionRate: number;
}
interface GroupRow { key: string; leads: number; contactados: number; compras: number; revenue: number; }
interface WindowMetrics {
  clicks: number; chats: number; sales: number; revenue: number;
  conversion: number; clickToChat: number; closeRate: number;
}
interface ChatApp { players: number; installs: number; openConversations: number; newPlayersMonth: number }
interface Overview {
  totals: Totals;
  windows: { today: WindowMetrics; week: WindowMetrics; month: WindowMetrics };
  activeLines: number;
  chatApp?: ChatApp;
  byCampaign: GroupRow[];
  bySource: GroupRow[];
}
interface Series { days: number; series: Array<{ date: string; leads: number }>; }
interface Heat { days: number; tz: string; total: number; matrix: number[][]; byHour: number[]; byDow: number[]; }

const DOW = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const DOW_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Lun..Dom (orden LatAm)

// Heatmap 7x24: a qué días y horas llegan más mensajes (intensidad = volumen).
function HeatMap({ heat }: { heat: Heat }) {
  const { matrix, total, tz } = heat;
  if (total === 0) return <p className="text-sm text-slate-500">Todavía no hay mensajes entrantes en el período.</p>;
  let max = 1;
  let peak = { d: 0, h: 0, n: 0 };
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      const v = matrix[d]?.[h] ?? 0;
      if (v > max) max = v;
      if (v > peak.n) peak = { d, h, n: v };
    }
  }
  const color = (v: number) => (v === 0 ? "rgba(148,163,184,.06)" : `rgba(37,211,102,${0.18 + 0.82 * (v / max)})`);
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[660px]">
        <div className="flex">
          <div className="w-9 shrink-0" />
          {Array.from({ length: 24 }).map((_, h) => (
            <div key={h} className="flex-1 text-center text-[9px] text-slate-500">{h % 3 === 0 ? h : ""}</div>
          ))}
        </div>
        {DOW_ORDER.map((d) => (
          <div key={d} className="flex items-center">
            <div className="w-9 shrink-0 text-[11px] text-slate-400">{DOW[d]}</div>
            {Array.from({ length: 24 }).map((_, h) => {
              const v = matrix[d]?.[h] ?? 0;
              return (
                <div key={h} className="flex-1 px-[1px] py-[1px]">
                  <div title={`${DOW[d]} ${h}:00 · ${v} mensaje${v === 1 ? "" : "s"}`} className="h-5 rounded-sm" style={{ background: color(v) }} />
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
        <span>🔥 Pico: <b className="text-wa-green">{DOW[peak.d]} {peak.h}:00–{peak.h + 1}:00</b> ({peak.n} mensajes)</span>
        <span className="flex items-center gap-1">
          menos
          <span className="inline-block h-3 w-3 rounded-sm" style={{ background: "rgba(37,211,102,.25)" }} />
          <span className="inline-block h-3 w-3 rounded-sm" style={{ background: "rgba(37,211,102,.6)" }} />
          <span className="inline-block h-3 w-3 rounded-sm" style={{ background: "rgba(37,211,102,1)" }} />
          más
        </span>
        <span>{total} mensajes · hora local ({tz})</span>
      </div>
    </div>
  );
}

const FUNNEL: Array<{ stage: Stage; field: keyof Totals }> = [
  { stage: "NUEVO", field: "nuevo" },
  { stage: "CONTACTADO", field: "contactado" },
  { stage: "INTERESADO", field: "interesado" },
  { stage: "COMPRO", field: "compro" },
  { stage: "PERDIDO", field: "perdido" },
];

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

function StatCard({
  label,
  value,
  sub,
  accent = "text-slate-100",
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: string;
}) {
  return (
    <Card>
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${accent}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
    </Card>
  );
}

// Gráfico de líneas simple en SVG (sin dependencias).
function LineChart({ data }: { data: Array<{ date: string; leads: number }> }) {
  const W = 720, H = 160, P = 24;
  if (data.length === 0) return <p className="text-sm text-slate-500">Sin datos.</p>;
  const max = Math.max(1, ...data.map((d) => d.leads));
  const stepX = (W - P * 2) / Math.max(1, data.length - 1);
  const y = (v: number) => H - P - (v / max) * (H - P * 2);
  const x = (i: number) => P + i * stepX;
  const pts = data.map((d, i) => `${x(i)},${y(d.leads)}`).join(" ");
  const area = `${P},${H - P} ${pts} ${x(data.length - 1)},${H - P}`;
  const total = data.reduce((s, d) => s + d.leads, 0);
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[480px]" preserveAspectRatio="none">
        <polygon points={area} fill="rgb(37 211 102 / 0.12)" />
        <polyline points={pts} fill="none" stroke="#25d366" strokeWidth="2" />
        {data.map((d, i) => (
          <circle key={d.date} cx={x(i)} cy={y(d.leads)} r="2" fill="#25d366" />
        ))}
      </svg>
      <div className="mt-1 flex justify-between text-xs text-slate-500">
        <span>{data[0]?.date}</span>
        <span>{total} leads en {data.length} días</span>
        <span>{data[data.length - 1]?.date}</span>
      </div>
    </div>
  );
}

type Period = "today" | "week" | "month";
const PERIODS: Array<{ key: Period; label: string }> = [
  { key: "today", label: "Hoy" },
  { key: "week", label: "7 días" },
  { key: "month", label: "30 días" },
];

export default function DashboardPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [series, setSeries] = useState<Series | null>(null);
  const [heat, setHeat] = useState<Heat | null>(null);
  const [days, setDays] = useState<number | null>(null);
  const [period, setPeriod] = useState<Period>("month");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
      const [ov, ts, hm, cr] = await Promise.all([
        api.get<Overview>("/api/analytics/overview"),
        api.get<Series>("/api/analytics/timeseries?days=30"),
        api.get<Heat>(`/api/analytics/heatmap?days=30&tz=${encodeURIComponent(tz)}`),
        api.get<{ days: number }>("/api/billing/credit"),
      ]);
      setData(ov.data);
      setSeries(ts.data);
      setHeat(hm.data);
      setDays(cr.data.days);
    } catch (err) {
      setError(apiError(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const t = data?.totals;
  const wins = data?.windows;
  const w = wins?.[period];

  return (
    <div className="overflow-x-hidden p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold">Analytics</h1>
        <div className="flex items-center gap-3">
          {/* Selector de período (Hoy / 7 días / 30 días) */}
          <div className="inline-flex rounded-lg border border-slate-700 bg-slate-800/60 p-0.5">
            {PERIODS.map((p) => (
              <button
                key={p.key}
                onClick={() => setPeriod(p.key)}
                className={`rounded-md px-3 py-1 text-sm font-semibold transition ${
                  period === p.key ? "bg-wa-green text-slate-900" : "text-slate-300 hover:text-white"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          {days != null && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-wa-green/30 bg-wa-green/10 px-3 py-1 text-sm font-semibold text-wa-green">
              {days} {days === 1 ? "día" : "días"}
            </span>
          )}
          <Button variant="secondary" onClick={() => void load()}>Actualizar</Button>
        </div>
      </div>

      {error && <ErrorMsg>{error}</ErrorMsg>}

      {loading ? (
        <p className="text-slate-400">Cargando…</p>
      ) : !t || !wins || !w ? (
        <Card><p className="text-slate-300">No hay datos para mostrar.</p></Card>
      ) : (
        <div className="space-y-6">
          {/* 4 tarjetas limpias según el período elegido (estilo claro: clic ≠ chat ≠ venta) */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Clics en el período" value={String(w.clicks)} sub="personas que tocaron el anuncio" accent="text-sky-300" />
            <StatCard label="Chats reales" value={String(w.chats)} sub="personas que te escribieron" accent="text-violet-300" />
            <StatCard label="Ventas en el período" value={String(w.sales)} sub={`${pct(w.closeRate)} de cierre · ${fmtAmount(w.revenue)}`} accent="text-wa-green" />
            <StatCard label="Líneas activas" value={String(data.activeLines)} sub="en rotación ahora" accent="text-amber-300" />
          </div>

          {/* Chat App: descargas/instalaciones de tu aplicación (PWA jugador↔cajero) */}
          {data.chatApp && data.chatApp.players > 0 && (
            <div>
              <h2 className="mb-2 text-sm font-semibold text-slate-200">📱 Chat App — tu aplicación</h2>
              <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                <StatCard label="Instalaron la app" value={String(data.chatApp.installs)} sub="descargaron + activaron notif." accent="text-emerald-300" />
                <StatCard label="Jugadores" value={String(data.chatApp.players)} sub={`${data.chatApp.newPlayersMonth} nuevos (30 días)`} accent="text-sky-300" />
                <StatCard label="% activación" value={pct(data.chatApp.players ? data.chatApp.installs / data.chatApp.players : 0)} sub="instalaron / total" accent="text-violet-300" />
                <StatCard label="Conversaciones abiertas" value={String(data.chatApp.openConversations)} sub="chats en curso" accent="text-amber-300" />
              </div>
            </div>
          )}

          {/* Gráfico 30 días */}
          <Card>
            <h2 className="mb-3 text-sm font-semibold text-slate-200">Leads — últimos 30 días</h2>
            <LineChart data={series?.series ?? []} />
          </Card>

          {/* Heatmap: cuándo llegan los mensajes (día x hora) */}
          <Card>
            <h2 className="text-sm font-semibold text-slate-200">¿Cuándo te escriben? — últimos 30 días</h2>
            <p className="mb-3 text-xs text-slate-500">Días y horas con más mensajes entrantes. Usalo para decidir cuándo anunciar y cuándo tener gente atendiendo.</p>
            {heat ? <HeatMap heat={heat} /> : <p className="text-sm text-slate-500">Cargando…</p>}
          </Card>

          {/* Totales históricos */}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
            <StatCard label="Leads (total)" value={String(t.leads)} />
            <StatCard label="Compras (total)" value={String(t.compro)} />
            <StatCard label="Facturación (total)" value={fmtAmount(t.revenue)} />
            <StatCard label="Conversión total" value={pct(t.conversionRate)} />
          </div>

          <Card>
            <h2 className="mb-3 text-sm font-semibold text-slate-200">Embudo</h2>
            <div className="flex flex-wrap gap-4">
              {FUNNEL.map(({ stage, field }) => (
                <div key={stage} className="flex items-center gap-2">
                  <StageBadge stage={stage} />
                  <span className="text-lg font-bold text-slate-100">{t[field]}</span>
                </div>
              ))}
            </div>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <GroupTable title="Por campaña" rows={data.byCampaign} />
            <GroupTable title="Por fuente" rows={data.bySource} />
          </div>
        </div>
      )}
    </div>
  );
}

function GroupTable({ title, rows }: { title: string; rows: GroupRow[] }) {
  return (
    // min-w-0: como ítem de grilla, deja que la tabla scrollee DENTRO de su recuadro en vez de
    // crecer y arrastrar toda la página de costado.
    <div className="min-w-0">
      <h2 className="mb-2 text-sm font-semibold text-slate-200">{title}</h2>
      {rows.length === 0 ? (
        <Card><p className="text-sm text-slate-400">Sin datos todavía.</p></Card>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-800">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-800/80 text-left text-slate-300">
              <tr>
                <th className="px-3 py-2">Clave</th>
                <th className="px-3 py-2">Leads</th>
                <th className="px-3 py-2">Contactados</th>
                <th className="px-3 py-2">Compras</th>
                <th className="px-3 py-2">Facturación</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className="border-t border-slate-800">
                  <td className="px-3 py-2 font-medium text-slate-200">{row.key}</td>
                  <td className="px-3 py-2">{row.leads}</td>
                  <td className="px-3 py-2">{row.contactados}</td>
                  <td className="px-3 py-2">{row.compras}</td>
                  <td className="px-3 py-2 text-wa-green">{fmtAmount(row.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
