import { useEffect, useState } from "react";
import { api, apiError } from "../../lib/api";
import { ErrorMsg } from "../../components/ui";

interface Metrics {
  proxyPool: { total: number; healthy: number; byProvider: Array<{ provider: string; total: number; healthy: number }> };
  lineStats: { total: number; conProxy: number; conectadas: number; baneadas: number; waitingProxy: number };
  proxyEvents: Array<{ type: string; n: number }>;
  metaByDay: Array<{ day: string; Lead: number; Purchase: number; CompleteRegistration: number }>;
  metaByStatus: Array<{ eventName: string; status: string; n: number }>;
}

const EVENT_LABEL: Record<string, string> = {
  assigned: "Asignado", rotated: "IP rotada", line_down: "Caída", reconnected: "Reconectada",
  banned: "Baneada", proxy_unhealthy: "Proxy caído / espera",
};
const STATUS_COLOR: Record<string, string> = {
  sent: "text-wa-green", failed: "text-rose-400", no_pixel: "text-amber-400", pending: "text-slate-400",
};

function Card({ value, label, color }: { value: number | string; label: string; color?: string }) {
  return (
    <div className="rounded-lg bg-slate-900 p-3">
      <div className={`text-2xl font-bold ${color ?? ""}`}>{value}</div>
      <div className="text-xs text-slate-400">{label}</div>
    </div>
  );
}

export default function AdminMetrics() {
  const [m, setM] = useState<Metrics | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    try {
      const { data } = await api.get<Metrics>("/api/admin/metrics");
      setM(data);
    } catch (e) {
      setError(apiError(e));
    }
  };
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, []);

  if (error) return <div className="p-4 md:p-6"><ErrorMsg>{error}</ErrorMsg></div>;
  if (!m) return <div className="p-4 text-slate-400 md:p-6">Cargando métricas…</div>;

  const maxLead = Math.max(1, ...m.metaByDay.map((d) => d.Lead));

  return (
    <div className="p-4 md:p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold">Métricas</h1>
        <button className="text-xs text-slate-400 hover:text-white" onClick={() => void load()}>↻ Actualizar</button>
      </div>

      {/* Proxies y líneas */}
      <div className="mb-2 text-sm font-semibold text-slate-200">Proxies y líneas (ahora)</div>
      <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Card value={`${m.proxyPool.healthy}/${m.proxyPool.total}`} label="proxies sanos" color="text-wa-green" />
        <Card value={m.lineStats.conProxy} label="líneas con proxy" />
        <Card value={m.lineStats.conectadas} label="líneas conectadas" color="text-wa-green" />
        <Card value={m.lineStats.total} label="líneas Baileys" />
        <Card value={m.lineStats.waitingProxy} label="esperando proxy" color="text-amber-400" />
        <Card value={m.lineStats.baneadas} label="baneadas" color="text-rose-400" />
      </div>
      <div className="mb-6 flex flex-wrap gap-2 text-xs">
        {m.proxyPool.byProvider.map((b) => (
          <span key={b.provider} className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-slate-300">
            {b.provider}: <span className={b.healthy === b.total ? "text-wa-green" : "text-rose-400"}>{b.healthy}</span>/{b.total} sanos
          </span>
        ))}
        {m.proxyPool.byProvider.length === 0 && <span className="text-slate-500">Sin proxies en el pool.</span>}
      </div>

      {/* Embudo Meta por día */}
      <div className="mb-2 text-sm font-semibold text-slate-200">Embudo Meta — últimos 14 días (enviados)</div>
      <div className="mb-6 overflow-x-auto rounded-lg border border-slate-800">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-slate-800 text-left text-xs uppercase text-slate-500">
            <th className="px-3 py-2">Día</th><th className="px-3 py-2">Lead</th><th className="px-3 py-2">Registro</th><th className="px-3 py-2">Compra</th><th className="w-1/3 px-3 py-2">Leads</th>
          </tr></thead>
          <tbody>
            {m.metaByDay.map((d) => (
              <tr key={d.day} className="border-b border-slate-800/60 last:border-0">
                <td className="px-3 py-1.5 text-slate-400">{d.day.slice(5)}</td>
                <td className="px-3 py-1.5 font-medium">{d.Lead}</td>
                <td className="px-3 py-1.5">{d.CompleteRegistration || <span className="text-slate-600">0</span>}</td>
                <td className="px-3 py-1.5 text-wa-green">{d.Purchase || <span className="text-slate-600">0</span>}</td>
                <td className="px-3 py-1.5"><div className="h-2 rounded bg-wa-green/40" style={{ width: `${(d.Lead / maxLead) * 100}%` }} /></td>
              </tr>
            ))}
            {m.metaByDay.length === 0 && <tr><td colSpan={5} className="px-3 py-4 text-center text-slate-500">Sin eventos en el período.</td></tr>}
          </tbody>
        </table>
      </div>

      {/* Meta por estado */}
      <div className="mb-2 text-sm font-semibold text-slate-200">Eventos Meta por estado — últimos 30 días</div>
      <div className="mb-6 flex flex-wrap gap-2 text-xs">
        {[...m.metaByStatus].sort((a, b) => b.n - a.n).map((e, i) => (
          <span key={i} className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-slate-300">
            {e.eventName} <span className={STATUS_COLOR[e.status] ?? "text-slate-400"}>{e.status}</span>: {e.n}
          </span>
        ))}
        {m.metaByStatus.length === 0 && <span className="text-slate-500">Sin eventos.</span>}
      </div>

      {/* Actividad de proxies */}
      <div className="mb-2 text-sm font-semibold text-slate-200">Actividad de proxies — últimos 7 días</div>
      <div className="flex flex-wrap gap-2 text-xs">
        {m.proxyEvents.map((e) => (
          <span key={e.type} className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-slate-300">
            {EVENT_LABEL[e.type] ?? e.type}: <span className="font-semibold text-slate-100">{e.n}</span>
          </span>
        ))}
        {m.proxyEvents.length === 0 && <span className="text-slate-500">Sin actividad de proxies en 7 días.</span>}
      </div>
    </div>
  );
}
