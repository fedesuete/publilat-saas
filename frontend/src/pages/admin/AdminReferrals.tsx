import { useEffect, useState } from "react";
import { api, apiError } from "../../lib/api";
import { fmtDate } from "../../lib/format";
import { Button, Card, ErrorMsg } from "../../components/ui";

interface Party {
  name: string | null;
  email: string;
  slug: string;
}
interface AdminReferral {
  id: string;
  status: "pending" | "paid";
  referrer: Party | null;
  referred: Party | null;
  days: number;
  commissionUsd: number;
  amount: number | null;
  currency: string;
  createdAt: string;
  paidAt: string | null;
  paidNote: string | null;
}

export default function AdminReferrals() {
  const [rows, setRows] = useState<AdminReferral[]>([]);
  const [pendingUsd, setPendingUsd] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = () => {
    api
      .get<{ referrals: AdminReferral[]; pendingUsd: number }>("/api/admin/referrals")
      .then(({ data }) => {
        setRows(data.referrals);
        setPendingUsd(data.pendingUsd);
      })
      .catch((e) => setError(apiError(e)));
  };
  useEffect(load, []);

  const markPaid = async (r: AdminReferral) => {
    const note = window.prompt(
      `Marcar como PAGADO el 10% ($${r.commissionUsd.toFixed(2)} USDT) a ${r.referrer?.email ?? "—"}.\n\nOpcional: hash / nota de la transferencia:`,
      "",
    );
    if (note === null) return; // canceló
    setBusy(r.id);
    try {
      await api.post(`/api/admin/referrals/${r.id}/paid`, { note: note || undefined });
      load();
    } catch (e) {
      setError(apiError(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold">Referidos</h1>
          <p className="mt-1 text-sm text-slate-400">
            10% de la primera compra de cada referido, en USDT (pago manual).
          </p>
        </div>
        <Card className="text-right">
          <div className="text-xs text-slate-400">Pendiente de pago</div>
          <div className="text-2xl font-bold text-wa-green">${pendingUsd.toFixed(2)}</div>
        </Card>
      </div>

      {error && <ErrorMsg>{error}</ErrorMsg>}

      <Card>
        {rows.length === 0 ? (
          <p className="text-sm text-slate-500">Todavía no hay comisiones de referidos.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr>
                  <th className="py-2 pr-3">Referidor (cobra)</th>
                  <th className="py-2 pr-3">Referido</th>
                  <th className="py-2 pr-3">Días</th>
                  <th className="py-2 pr-3">Comisión</th>
                  <th className="py-2 pr-3">Estado</th>
                  <th className="py-2 pr-3">Fecha</th>
                  <th className="py-2"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-slate-800">
                    <td className="py-2 pr-3">
                      <div>{r.referrer?.name || r.referrer?.slug || "—"}</div>
                      <div className="text-xs text-slate-500">{r.referrer?.email}</div>
                    </td>
                    <td className="py-2 pr-3">
                      <div>{r.referred?.name || r.referred?.slug || "—"}</div>
                      <div className="text-xs text-slate-500">{r.referred?.email}</div>
                    </td>
                    <td className="py-2 pr-3">{r.days}</td>
                    <td className="py-2 pr-3 font-semibold text-wa-green">
                      ${r.commissionUsd.toFixed(2)}
                    </td>
                    <td className="py-2 pr-3">
                      {r.status === "paid" ? (
                        <span
                          className="rounded bg-slate-700 px-2 py-0.5 text-xs"
                          title={r.paidNote ?? undefined}
                        >
                          Pagado {r.paidAt ? `· ${fmtDate(r.paidAt)}` : ""}
                        </span>
                      ) : (
                        <span className="rounded bg-amber-500/20 px-2 py-0.5 text-xs text-amber-300">
                          Pendiente
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-slate-400">{fmtDate(r.createdAt)}</td>
                    <td className="py-2">
                      {r.status === "pending" && (
                        <Button onClick={() => markPaid(r)} disabled={busy === r.id} className="text-xs">
                          {busy === r.id ? "…" : "Marcar pagado"}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
