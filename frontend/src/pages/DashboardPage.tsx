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
  conversion: number; clickToChat: number;
}
interface Overview {
  totals: Totals;
  windows: { today: WindowMetrics; week: WindowMetrics; month: WindowMetrics };
  activeLines: number;
  byCampaign: GroupRow[];
  bySource: GroupRow[];
}
interface Series { days: number; series: Array<{ date: string; leads: number }>; }

type Period = "today" | "week" | "month";
const PERIODS: Array<{ key: Period; label: string }> = [
  { key: "today", label: "Hoy" },
  { key: "week", label: "Semana" },
  { key: "month", label: "Mes" },
];

const FUNNEL: Array<{ stage: Stage; field: keyof Totals }> = [
  { stage: "NUEVO", field: "nuevo" },
  { stage: "CONTACTADO", field: "contactado" },
  { stage: "INTERESADO", field: "interesado" },
  { stage: "COMPRO", field: "compro" },
  { stage: "PERDIDO", field: "perdido" },
];

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 text-2xl font-bold text-slate-100">{value}</div>
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

export default function DashboardPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [series, setSeries] = useState<Series | null>(null);
  const [period, setPeriod] = useState<Period>("month");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [ov, ts] = await Promise.all([
        api.get<Overview>("/api/analytics/overview"),
        api.get<Series>("/api/analytics/timeseries?days=30"),
      ]);
      setData(ov.data);
      setSeries(ts.data);
    } catch (err) {
      setError(apiError(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const t = data?.totals;
  const w = data?.windows[period];

  return (
    <div className="p-6">
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-xl font-bold">Dashboard</h1>
        <Button variant="secondary" onClick={() => void load()}>Actualizar</Button>
      </div>

      {error && <ErrorMsg>{error}</ErrorMsg>}

      {loading ? (
        <p className="text-slate-400">Cargando…</p>
      ) : !t || !w ? (
        <Card><p className="text-slate-300">No hay datos para mostrar.</p></Card>
      ) : (
        <div className="space-y-6">
          {/* Selector de período */}
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-md bg-slate-900 p-1 text-sm">
              {PERIODS.map((p) => (
                <button
                  key={p.key}
                  onClick={() => setPeriod(p.key)}
                  className={`rounded px-3 py-1 font-medium transition ${
                    period === p.key ? "bg-wa-green text-slate-900" : "text-slate-300 hover:text-white"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <span className="text-xs text-slate-500">métricas del período seleccionado</span>
          </div>

          {/* Tarjetas por ventana de tiempo */}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
            <StatCard label="Clics" value={String(w.clicks)} sub="contactos del link" />
            <StatCard label="Chats reales" value={String(w.chats)} sub="llegaron a chatear" />
            <StatCard label="Click→Chat" value={pct(w.clickToChat)} />
            <StatCard label="Ventas" value={String(w.sales)} sub={fmtAmount(w.revenue)} />
            <StatCard label="Conversión" value={pct(w.conversion)} sub="ventas / clics" />
            <StatCard label="Líneas activas" value={String(data.activeLines)} sub="en rotación" />
          </div>

          {/* Gráfico 30 días */}
          <Card>
            <h2 className="mb-3 text-sm font-semibold text-slate-200">Leads — últimos 30 días</h2>
            <LineChart data={series?.series ?? []} />
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
    <div>
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
