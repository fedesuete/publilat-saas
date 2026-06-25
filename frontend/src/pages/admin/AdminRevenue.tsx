import { useEffect, useState } from "react";
import { api, apiError } from "../../lib/api";
import { fmtDate } from "../../lib/format";
import { Card, ErrorMsg } from "../../components/ui";

interface Revenue {
  byPeriod: Record<string, Array<{ currency: string; amount: number }>>;
  byGateway: Array<{ provider: string; currency: string; amount: number; count: number }>;
  topClients: Array<{ userId: string; email: string; name: string | null; facturacion: number; compras: number }>;
}
interface Payment {
  id: string; provider: string; amount: number; currency: string; status: string; createdAt: string;
  user: { email: string; name: string | null };
}

const PERIOD_LABEL: Record<string, string> = { today: "Hoy", d7: "7 días", d30: "30 días", total: "Total" };
const money = (arr: Array<{ currency: string; amount: number }>) =>
  arr.length ? arr.map((r) => `${r.amount.toLocaleString("es-AR")} ${r.currency}`).join(" · ") : "—";

export default function AdminRevenue() {
  const [rev, setRev] = useState<Revenue | null>(null);
  const [pays, setPays] = useState<Payment[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.get<Revenue>("/api/admin/revenue"), api.get<{ payments: Payment[] }>("/api/admin/payments")])
      .then(([r, p]) => { setRev(r.data); setPays(p.data.payments); })
      .catch((e) => setError(apiError(e)));
  }, []);

  if (error) return <div className="p-6"><ErrorMsg>{error}</ErrorMsg></div>;
  if (!rev) return <div className="p-6 text-slate-400">Cargando…</div>;

  return (
    <div className="p-6">
      <h1 className="mb-5 text-xl font-bold">Ingresos</h1>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {Object.entries(rev.byPeriod).map(([k, v]) => (
          <Card key={k}>
            <div className="text-xs uppercase tracking-wide text-slate-400">{PERIOD_LABEL[k] ?? k}</div>
            <div className="mt-1 text-lg font-bold text-wa-green">{money(v)}</div>
          </Card>
        ))}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 text-sm font-semibold text-slate-200">Por pasarela</h2>
          {rev.byGateway.length === 0 ? <p className="text-sm text-slate-500">Sin pagos aprobados.</p> : (
            <div className="space-y-1.5">
              {rev.byGateway.map((g, i) => (
                <div key={i} className="flex items-center justify-between text-sm">
                  <span className="text-slate-300">{g.provider} <span className="text-slate-500">({g.count})</span></span>
                  <span className="font-semibold text-wa-green">{g.amount.toLocaleString("es-AR")} {g.currency}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card>
          <h2 className="mb-3 text-sm font-semibold text-slate-200">Top clientes por facturación</h2>
          {rev.topClients.length === 0 ? <p className="text-sm text-slate-500">Sin datos.</p> : (
            <div className="space-y-1.5">
              {rev.topClients.map((c) => (
                <div key={c.userId} className="flex items-center justify-between text-sm">
                  <span className="truncate text-slate-300">{c.name || c.email}</span>
                  <span className="font-semibold text-slate-100">{c.facturacion.toLocaleString("es-AR")} <span className="text-xs text-slate-500">({c.compras})</span></span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <h2 className="mb-2 mt-6 text-sm font-semibold text-slate-200">Pagos recientes</h2>
      <div className="overflow-x-auto rounded-lg border border-slate-800">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-800/80 text-left text-slate-300">
            <tr><th className="px-3 py-2">Fecha</th><th className="px-3 py-2">Cliente</th><th className="px-3 py-2">Pasarela</th><th className="px-3 py-2">Monto</th><th className="px-3 py-2">Estado</th></tr>
          </thead>
          <tbody>
            {pays.map((p) => (
              <tr key={p.id} className="border-t border-slate-800">
                <td className="px-3 py-2 text-xs text-slate-400">{fmtDate(p.createdAt)}</td>
                <td className="px-3 py-2 text-slate-200">{p.user.name || p.user.email}</td>
                <td className="px-3 py-2">{p.provider}</td>
                <td className="px-3 py-2">{p.amount} {p.currency}</td>
                <td className={`px-3 py-2 font-medium ${p.status === "approved" ? "text-wa-green" : p.status === "rejected" ? "text-rose-400" : "text-amber-300"}`}>{p.status}</td>
              </tr>
            ))}
            {pays.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-500">Sin pagos.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
