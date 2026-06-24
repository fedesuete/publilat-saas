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

export default function DashboardPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [series, setSeries] = useState<Series | null>(null);
  const [days, setDays] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [ov, ts, cr] = await Promise.all([
        api.get<Overview>("/api/analytics/overview"),
        api.get<Series>("/api/analytics/timeseries?days=30"),
        api.get<{ days: number }>("/api/billing/credit"),
      ]);
      setData(ov.data);
      setSeries(ts.data);
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

  return (
    <div className="p-6">
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-xl font-bold">Dashboard</h1>
        <div className="flex items-center gap-3">
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
      ) : !t || !wins ? (
        <Card><p className="text-slate-300">No hay datos para mostrar.</p></Card>
      ) : (
        <div className="space-y-6">
          {/* Clics: hoy / semana / mes + líneas activas */}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <StatCard label="Clics hoy" value={String(wins.today.clicks)} sub="tocaron el anuncio" accent="text-sky-300" />
            <StatCard label="Clics esta semana" value={String(wins.week.clicks)} accent="text-sky-300" />
            <StatCard label="Clics este mes" value={String(wins.month.clicks)} accent="text-sky-300" />
            <StatCard label="Líneas activas" value={String(data.activeLines)} sub="en rotación ahora" accent="text-amber-300" />
          </div>

          {/* Chats: hoy / semana / mes + click→chat */}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <StatCard label="Chats hoy" value={String(wins.today.chats)} sub="mensajes WA recibidos" accent="text-violet-300" />
            <StatCard label="Chats esta semana" value={String(wins.week.chats)} accent="text-violet-300" />
            <StatCard label="Chats este mes" value={String(wins.month.chats)} accent="text-violet-300" />
            <StatCard label="Click→Chat hoy" value={pct(wins.today.clickToChat)} sub={`${wins.today.chats} chats / ${wins.today.clicks} clics`} accent="text-violet-300" />
          </div>

          {/* Ventas: hoy / semana / mes + conversión del mes */}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <StatCard label="Ventas hoy" value={String(wins.today.sales)} sub={`${pct(wins.today.conversion)} conversión`} accent="text-wa-green" />
            <StatCard label="Ventas esta semana" value={String(wins.week.sales)} sub={`${pct(wins.week.conversion)} conversión`} accent="text-wa-green" />
            <StatCard label="Ventas este mes" value={String(wins.month.sales)} sub={fmtAmount(wins.month.revenue)} accent="text-wa-green" />
            <StatCard label="Conversión del mes" value={pct(wins.month.conversion)} sub={`${wins.month.sales} ventas / ${wins.month.clicks} clics`} accent="text-rose-300" />
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
