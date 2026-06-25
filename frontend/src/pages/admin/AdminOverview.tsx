import { useEffect, useState } from "react";
import { api, apiError } from "../../lib/api";
import { Card, ErrorMsg } from "../../components/ui";

interface Overview {
  clients: { total: number; suspended: number; demo: number; active: number };
  lines: { total: number; active: number };
  revenue: { total: Array<{ currency: string; amount: number; count: number }>; month: Array<{ currency: string; amount: number }>; byMonth: Record<string, number> };
  days: { granted: number; consumed: number };
  attribution: { leads: number; compras: number; facturacion: number };
  capi: Record<string, number>;
  growth: { newByWeek: Record<string, number> };
  demos: { total: number; converted: number };
}

function KPI({ label, value, sub, accent = "text-slate-100" }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <Card>
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${accent}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
    </Card>
  );
}

const money = (arr: Array<{ currency: string; amount: number }>) =>
  arr.length ? arr.map((r) => `${r.amount.toLocaleString("es-AR")} ${r.currency}`).join(" · ") : "—";

export default function AdminOverview() {
  const [d, setD] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<Overview>("/api/admin/overview").then(({ data }) => setD(data)).catch((e) => setError(apiError(e)));
  }, []);

  if (error) return <div className="p-6"><ErrorMsg>{error}</ErrorMsg></div>;
  if (!d) return <div className="p-6 text-slate-400">Cargando…</div>;

  return (
    <div className="p-6">
      <h1 className="mb-5 text-xl font-bold">Resumen</h1>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <KPI label="Clientes" value={String(d.clients.total)} sub={`${d.clients.active} activos`} />
        <KPI label="En demo" value={String(d.clients.demo)} accent="text-amber-300" />
        <KPI label="Suspendidos" value={String(d.clients.suspended)} accent="text-rose-300" />
        <KPI label="Líneas activas" value={String(d.lines.active)} sub={`${d.lines.total} totales`} accent="text-wa-green" />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
        <KPI label="Ingresos del mes" value={money(d.revenue.month)} accent="text-wa-green" />
        <KPI label="Ingresos totales" value={money(d.revenue.total)} accent="text-wa-green" />
        <KPI label="Días vendidos" value={String(d.days.granted)} sub={`${d.days.consumed} consumidos`} />
        <KPI label="Demos → pago" value={`${d.demos.converted}/${d.demos.total}`} accent="text-violet-300" />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
        <KPI label="Leads (plataforma)" value={d.attribution.leads.toLocaleString("es-AR")} accent="text-sky-300" />
        <KPI label="Compras" value={d.attribution.compras.toLocaleString("es-AR")} accent="text-wa-green" />
        <KPI label="Facturación atribuida" value={d.attribution.facturacion.toLocaleString("es-AR")} />
        <KPI label="Eventos CAPI" value={`${d.capi.sent ?? 0} ok`} sub={`${d.capi.failed ?? 0} fallidos · ${d.capi.pending ?? 0} pend.`} accent={d.capi.failed ? "text-rose-300" : "text-slate-100"} />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 text-sm font-semibold text-slate-200">Ingresos por mes</h2>
          {Object.keys(d.revenue.byMonth).length === 0 ? (
            <p className="text-sm text-slate-500">Sin datos.</p>
          ) : (
            <div className="space-y-1.5">
              {Object.entries(d.revenue.byMonth).sort().map(([k, v]) => (
                <div key={k} className="flex items-center justify-between text-sm">
                  <span className="text-slate-400">{k}</span>
                  <span className="font-semibold text-wa-green">{v.toLocaleString("es-AR")}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card>
          <h2 className="mb-3 text-sm font-semibold text-slate-200">Nuevos clientes por semana</h2>
          {Object.keys(d.growth.newByWeek).length === 0 ? (
            <p className="text-sm text-slate-500">Sin datos.</p>
          ) : (
            <div className="space-y-1.5">
              {Object.entries(d.growth.newByWeek).sort().map(([k, v]) => (
                <div key={k} className="flex items-center justify-between text-sm">
                  <span className="text-slate-400">{k}</span>
                  <span className="font-semibold text-slate-100">{v}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
