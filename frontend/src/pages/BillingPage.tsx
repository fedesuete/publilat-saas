import { useEffect, useState, type FormEvent } from "react";
import { api, apiError } from "../lib/api";
import { fmtDate } from "../lib/format";
import { Button, Input, Card, ErrorMsg } from "../components/ui";

interface LedgerEntry {
  id: string;
  delta: number;
  reason: string;
  createdAt: string;
}

type Provider = "mercadopago" | "stripe" | "usdt";
interface Methods {
  mercadopago: boolean;
  stripe: boolean;
  usdt: boolean;
}
interface CreditResponse {
  days: number;
  ledger: LedgerEntry[];
  methods: Methods;
}

const PROVIDER_LABEL: Record<Provider, string> = {
  mercadopago: "MercadoPago",
  stripe: "Tarjeta (Stripe)",
  usdt: "USDT (cripto)",
};

export default function BillingPage() {
  const [days, setDays] = useState(0);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [addDays, setAddDays] = useState("1");
  const [adding, setAdding] = useState(false);

  const [buyDays, setBuyDays] = useState("1");
  const [buying, setBuying] = useState<Provider | null>(null);
  const [checkoutMsg, setCheckoutMsg] = useState<string | null>(null);
  const [methods, setMethods] = useState<Methods>({ mercadopago: false, stripe: false, usdt: false });

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get<CreditResponse>("/api/billing/credit");
      setDays(data.days);
      setLedger(data.ledger);
      if (data.methods) setMethods(data.methods);
    } catch (err) {
      setError(apiError(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const submitAdd = async (e: FormEvent) => {
    e.preventDefault();
    const n = parseInt(addDays, 10);
    if (!Number.isInteger(n) || n <= 0) {
      setError("Ingresá una cantidad de días válida (entero mayor a 0).");
      return;
    }
    setAdding(true);
    setError(null);
    try {
      await api.post<{ days: number }>("/api/billing/credit/add", { days: n });
      setAddDays("1");
      await load();
    } catch (err) {
      setError(apiError(err));
    } finally {
      setAdding(false);
    }
  };

  const buy = async (provider: Provider) => {
    const n = parseInt(buyDays, 10);
    if (!Number.isInteger(n) || n <= 0) {
      setError("Ingresá una cantidad de días válida (entero mayor a 0).");
      return;
    }
    setBuying(provider);
    setError(null);
    setCheckoutMsg(null);
    try {
      const { data } = await api.post<
        | { stub: true; provider: Provider; amount: number; currency: string; message: string }
        | { stub: false; provider: Provider; url: string; paymentId: string }
      >("/api/billing/checkout", { days: n, provider });
      if (data.stub) {
        setCheckoutMsg(`${data.message} (${data.amount} ${data.currency})`);
      } else {
        window.open(data.url, "_blank");
        setCheckoutMsg(`Te abrimos el checkout de ${PROVIDER_LABEL[provider]} en otra pestaña.`);
      }
    } catch (err) {
      setError(apiError(err));
    } finally {
      setBuying(null);
    }
  };

  return (
    <div className="p-6">
      <h1 className="mb-2 text-xl font-bold">Créditos</h1>
      <p className="mb-5 text-sm text-slate-400">
        1 día = 1 línea activa por 24 h. Activá líneas consumiendo días del crédito.
        Al vencer, la línea sale de rotación automáticamente.
      </p>

      {error && (
        <div className="mb-4">
          <ErrorMsg>{error}</ErrorMsg>
        </div>
      )}

      {loading ? (
        <p className="text-slate-400">Cargando…</p>
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <div className="text-sm text-slate-400">Días disponibles</div>
            <div className="mt-1 text-5xl font-bold text-wa-green">{days}</div>
            <div className="mt-1 text-xs text-slate-500">
              {days === 1 ? "1 día de línea activa" : `${days} días de línea activa`}
            </div>
          </Card>

          <Card>
            <div className="mb-2 text-sm font-semibold">Agregar días</div>
            <form onSubmit={submitAdd} className="flex gap-2">
              <Input
                type="number"
                min={1}
                step={1}
                value={addDays}
                onChange={(e) => setAddDays(e.target.value)}
                placeholder="Días"
              />
              <Button type="submit" disabled={adding}>
                {adding ? "…" : "Agregar"}
              </Button>
            </form>
            <p className="mt-2 text-xs text-slate-500">
              Stub de compra — la pasarela de pago real llega en F5.
            </p>
          </Card>

          <Card className="md:col-span-2">
            <div className="mb-2 text-sm font-semibold">Comprar días</div>
            <div className="mb-3 flex items-center gap-2">
              <span className="text-sm text-slate-400">Cantidad de días:</span>
              <Input
                type="number"
                min={1}
                step={1}
                value={buyDays}
                onChange={(e) => setBuyDays(e.target.value)}
                placeholder="Días"
                className="max-w-[140px]"
              />
            </div>
            {(["mercadopago", "stripe", "usdt"] as Provider[]).filter((p) => methods[p]).length > 0 ? (
              <>
                <div className="flex flex-wrap gap-2">
                  {(["mercadopago", "stripe", "usdt"] as Provider[])
                    .filter((p) => methods[p])
                    .map((p) => (
                      <Button key={p} type="button" disabled={buying !== null} onClick={() => void buy(p)}>
                        {buying === p ? "…" : PROVIDER_LABEL[p]}
                      </Button>
                    ))}
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  Elegí el medio de pago; los días se acreditan al confirmarse el pago.
                </p>
              </>
            ) : (
              <p className="text-sm text-slate-400">
                No hay pasarela de pago configurada todavía. (En dev podés usar “Agregar días”.)
              </p>
            )}
            {checkoutMsg && (
              <p className="mt-3 rounded-md border border-emerald-800 bg-emerald-900/40 px-3 py-2 text-sm text-emerald-200">
                {checkoutMsg}
              </p>
            )}
          </Card>
        </div>
      )}

      <div className="mt-6">
        <h2 className="mb-3 text-sm font-semibold text-slate-200">Movimientos</h2>
        {loading ? null : ledger.length === 0 ? (
          <p className="text-slate-500">Todavía no hay movimientos.</p>
        ) : (
          <Card className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-left text-xs uppercase text-slate-500">
                  <th className="px-4 py-2 font-medium">Fecha</th>
                  <th className="px-4 py-2 font-medium">Movimiento</th>
                  <th className="px-4 py-2 font-medium">Motivo</th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((entry) => (
                  <tr key={entry.id} className="border-b border-slate-800/60 last:border-0">
                    <td className="px-4 py-2 text-slate-400">{fmtDate(entry.createdAt)}</td>
                    <td
                      className={`px-4 py-2 font-semibold ${
                        entry.delta > 0
                          ? "text-wa-green"
                          : entry.delta < 0
                            ? "text-rose-400"
                            : "text-slate-300"
                      }`}
                    >
                      {entry.delta > 0 ? `+${entry.delta}` : entry.delta}
                    </td>
                    <td className="px-4 py-2 text-slate-300">{entry.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    </div>
  );
}
