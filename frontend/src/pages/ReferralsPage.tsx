import { useEffect, useState } from "react";
import { api, apiError } from "../lib/api";
import { fmtDate } from "../lib/format";
import { Button, Card, ErrorMsg } from "../components/ui";

interface ReferralRow {
  id: string;
  referido: string;
  days: number;
  commissionUsd: number;
  status: "pending" | "paid";
  createdAt: string;
  paidAt: string | null;
}
interface ReferralsResponse {
  code: string;
  eligible: boolean;
  summary: { count: number; pendingUsd: number; paidUsd: number };
  referrals: ReferralRow[];
}

export default function ReferralsPage() {
  const [data, setData] = useState<ReferralsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api
      .get<ReferralsResponse>("/api/referrals/me")
      .then(({ data }) => setData(data))
      .catch((e) => setError(apiError(e)))
      .finally(() => setLoading(false));
  }, []);

  const link = data ? `${window.location.origin}/login?ref=${data.code}` : "";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard bloqueado: el usuario puede copiar a mano */
    }
  };

  if (loading) return <div className="p-6 text-slate-400">Cargando…</div>;

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-bold">Referidos</h1>
        <p className="mt-1 text-sm text-slate-400">
          Invitá a otros a Publi.lat y ganá el <strong className="text-wa-green">10%</strong> de su
          primera compra, en <strong>USDT</strong>. Te lo pagamos a mano cuando tu referido hace su
          primer pago.
        </p>
      </div>

      {error && <ErrorMsg>{error}</ErrorMsg>}

      {/* Tu link */}
      <Card>
        <h2 className="mb-2 text-sm font-semibold text-slate-300">Tu link de invitación</h2>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            readOnly
            value={link}
            onFocus={(e) => e.currentTarget.select()}
            className="flex-1 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200"
          />
          <Button onClick={copy} className="shrink-0">
            {copied ? "¡Copiado!" : "Copiar link"}
          </Button>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Tu código: <span className="font-mono text-slate-300">{data?.code}</span>
        </p>
        {data && !data.eligible && (
          <p className="mt-2 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
            Podés compartir tu link igual, pero la comisión se acredita recién cuando vos también
            seas cliente (tengas al menos una compra).
          </p>
        )}
      </Card>

      {/* Resumen */}
      <div className="grid grid-cols-3 gap-3">
        <Card>
          <div className="text-xs text-slate-400">Referidos</div>
          <div className="text-2xl font-bold">{data?.summary.count ?? 0}</div>
        </Card>
        <Card>
          <div className="text-xs text-slate-400">Pendiente</div>
          <div className="text-2xl font-bold text-wa-green">
            ${(data?.summary.pendingUsd ?? 0).toFixed(2)}
          </div>
        </Card>
        <Card>
          <div className="text-xs text-slate-400">Cobrado</div>
          <div className="text-2xl font-bold">${(data?.summary.paidUsd ?? 0).toFixed(2)}</div>
        </Card>
      </div>

      {/* Listado */}
      <Card>
        <h2 className="mb-3 text-sm font-semibold text-slate-300">Tus referidos</h2>
        {!data || data.referrals.length === 0 ? (
          <p className="text-sm text-slate-500">
            Todavía no hay referidos. Compartí tu link y cuando alguien se registre y haga su primera
            compra, vas a ver acá tu comisión.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr>
                  <th className="py-2 pr-2">Referido</th>
                  <th className="py-2 pr-2">Días</th>
                  <th className="py-2 pr-2">Comisión</th>
                  <th className="py-2 pr-2">Estado</th>
                  <th className="py-2">Fecha</th>
                </tr>
              </thead>
              <tbody>
                {data.referrals.map((r) => (
                  <tr key={r.id} className="border-t border-slate-800">
                    <td className="py-2 pr-2">{r.referido}</td>
                    <td className="py-2 pr-2">{r.days}</td>
                    <td className="py-2 pr-2 font-semibold text-wa-green">
                      ${r.commissionUsd.toFixed(2)}
                    </td>
                    <td className="py-2 pr-2">
                      {r.status === "paid" ? (
                        <span className="rounded bg-slate-700 px-2 py-0.5 text-xs">Pagado</span>
                      ) : (
                        <span className="rounded bg-amber-500/20 px-2 py-0.5 text-xs text-amber-300">
                          Pendiente
                        </span>
                      )}
                    </td>
                    <td className="py-2 text-slate-400">{fmtDate(r.createdAt)}</td>
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
