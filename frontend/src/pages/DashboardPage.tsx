import { useEffect, useState } from "react";
import { api, apiError } from "../lib/api";
import type { Stage } from "../lib/types";
import { fmtAmount } from "../lib/format";
import { Button, Card, ErrorMsg, StageBadge } from "../components/ui";

interface Totals {
  leads: number;
  nuevo: number;
  contactado: number;
  interesado: number;
  compro: number;
  perdido: number;
  revenue: number;
  conversionRate: number;
}

interface GroupRow {
  key: string;
  leads: number;
  contactados: number;
  compras: number;
  revenue: number;
}

interface Overview {
  totals: Totals;
  byCampaign: GroupRow[];
  bySource: GroupRow[];
}

const FUNNEL: Array<{ stage: Stage; field: keyof Totals }> = [
  { stage: "NUEVO", field: "nuevo" },
  { stage: "CONTACTADO", field: "contactado" },
  { stage: "INTERESADO", field: "interesado" },
  { stage: "COMPRO", field: "compro" },
  { stage: "PERDIDO", field: "perdido" },
];

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 text-2xl font-bold text-slate-100">{value}</div>
    </Card>
  );
}

function GroupTable({ title, rows }: { title: string; rows: GroupRow[] }) {
  return (
    <div>
      <h2 className="mb-2 text-sm font-semibold text-slate-200">{title}</h2>
      {rows.length === 0 ? (
        <Card>
          <p className="text-sm text-slate-400">Sin datos todavía.</p>
        </Card>
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

export default function DashboardPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get<Overview>("/api/analytics/overview");
      setData(data);
    } catch (err) {
      setError(apiError(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const t = data?.totals;

  return (
    <div className="p-6">
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-xl font-bold">Dashboard</h1>
        <Button variant="secondary" onClick={() => void load()}>
          Actualizar
        </Button>
      </div>

      {error && <ErrorMsg>{error}</ErrorMsg>}

      {loading ? (
        <p className="text-slate-400">Cargando…</p>
      ) : !t ? (
        <Card>
          <p className="text-slate-300">No hay datos para mostrar.</p>
        </Card>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
            <StatCard label="Leads" value={String(t.leads)} />
            <StatCard label="Contactados" value={String(t.contactado)} />
            <StatCard label="Interesados" value={String(t.interesado)} />
            <StatCard label="Compras" value={String(t.compro)} />
            <StatCard label="Facturación" value={fmtAmount(t.revenue)} />
            <StatCard
              label="Conversión"
              value={`${(t.conversionRate * 100).toFixed(1)}%`}
            />
          </div>

          <Card>
            <h2 className="mb-3 text-sm font-semibold text-slate-200">Embudo</h2>
            <div className="flex flex-wrap gap-4">
              {FUNNEL.map(({ stage, field }) => (
                <div key={stage} className="flex items-center gap-2">
                  <StageBadge stage={stage} />
                  <span className="text-lg font-bold text-slate-100">
                    {t[field]}
                  </span>
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
