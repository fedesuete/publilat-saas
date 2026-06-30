import { useEffect, useState } from "react";
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

  const [buyDays, setBuyDays] = useState("1");
  const [buying, setBuying] = useState<Provider | null>(null);
  const [checkoutMsg, setCheckoutMsg] = useState<string | null>(null);
  const [methods, setMethods] = useState<Methods>({ mercadopago: false, stripe: false, usdt: false });
  const [prices, setPrices] = useState<Record<Provider, { amount: number; currency: string }> | null>(null);

  // Pago USDT directo a wallet propia (red Tron / TRC20).
  const [usdtPay, setUsdtPay] = useState<{ address: string; amountUsdt: number; paymentId: string } | null>(null);
  const [txid, setTxid] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verifyMsg, setVerifyMsg] = useState<string | null>(null);

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

  // Cotiza el precio por proveedor cada vez que cambia la cantidad de días.
  useEffect(() => {
    const n = parseInt(buyDays, 10);
    if (!Number.isInteger(n) || n <= 0) {
      setPrices(null);
      return;
    }
    let cancelled = false;
    api
      .get<{ prices: Record<Provider, { amount: number; currency: string }> }>(`/api/billing/quote?days=${n}`)
      .then(({ data }) => { if (!cancelled) setPrices(data.prices); })
      .catch(() => { if (!cancelled) setPrices(null); });
    return () => { cancelled = true; };
  }, [buyDays]);

  const buy = async (provider: Provider) => {
    const n = parseInt(buyDays, 10);
    if (!Number.isInteger(n) || n <= 0) {
      setError("Ingresá una cantidad de días válida (entero mayor a 0).");
      return;
    }
    setBuying(provider);
    setError(null);
    setCheckoutMsg(null);
    setUsdtPay(null);
    setVerifyMsg(null);
    try {
      const { data } = await api.post<
        | { stub: true; provider: Provider; amount: number; currency: string; message: string }
        | { stub: false; provider: Provider; url: string; paymentId: string }
        | { direct: true; provider: "usdt"; address: string; network: string; amountUsdt: number; paymentId: string }
      >("/api/billing/checkout", { days: n, provider });
      if ("direct" in data && data.direct) {
        setUsdtPay({ address: data.address, amountUsdt: data.amountUsdt, paymentId: data.paymentId });
      } else if ("stub" in data && data.stub) {
        setCheckoutMsg(`${data.message} (${data.amount} ${data.currency})`);
      } else if ("url" in data) {
        window.open(data.url, "_blank");
        setCheckoutMsg(`Te abrimos el checkout de ${PROVIDER_LABEL[provider]} en otra pestaña.`);
      }
    } catch (err) {
      setError(apiError(err));
    } finally {
      setBuying(null);
    }
  };

  const verifyUsdt = async () => {
    if (!usdtPay || !txid.trim()) return;
    setVerifying(true);
    setVerifyMsg(null);
    setError(null);
    try {
      const { data } = await api.post<{ ok: boolean; valueUsdt?: number; days?: number; error?: string }>(
        "/api/billing/usdt/verify",
        { paymentId: usdtPay.paymentId, txid: txid.trim() },
      );
      if (data.ok) {
        setVerifyMsg(`✓ Pago confirmado. Se acreditaron ${data.days ?? ""} día(s).`);
        setUsdtPay(null);
        setTxid("");
        await load();
      }
    } catch (err) {
      setVerifyMsg(null);
      setError(apiError(err));
    } finally {
      setVerifying(false);
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
          <Card className="md:col-span-2">
            <div className="text-sm text-slate-400">Días disponibles</div>
            <div className="mt-1 text-5xl font-bold text-wa-green">{days}</div>
            <div className="mt-1 text-xs text-slate-500">
              {days === 1 ? "1 día de línea activa" : `${days} días de línea activa`}
            </div>
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
              {parseInt(buyDays, 10) >= 90 && (
                <span className="rounded-full bg-wa-green/15 px-2 py-0.5 text-xs font-semibold text-wa-green">
                  descuento por volumen
                </span>
              )}
            </div>
            {(["mercadopago", "stripe", "usdt"] as Provider[]).filter((p) => methods[p]).length > 0 ? (
              <>
                <div className="flex flex-wrap gap-2">
                  {(["mercadopago", "stripe", "usdt"] as Provider[])
                    .filter((p) => methods[p])
                    .map((p) => {
                      const price = prices?.[p];
                      return (
                        <Button key={p} type="button" disabled={buying !== null} onClick={() => void buy(p)}>
                          {buying === p
                            ? "…"
                            : `${PROVIDER_LABEL[p]}${price ? ` · ${price.amount.toLocaleString("es-AR")} ${price.currency}` : ""}`}
                        </Button>
                      );
                    })}
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  Elegí el medio de pago; los días se acreditan al confirmarse el pago.
                </p>
              </>
            ) : (
              <p className="text-sm text-slate-400">
                Todavía no hay un medio de pago habilitado. Escribinos por Soporte para activarlo.
              </p>
            )}
            {checkoutMsg && (
              <p className="mt-3 rounded-md border border-emerald-800 bg-emerald-900/40 px-3 py-2 text-sm text-emerald-200">
                {checkoutMsg}
              </p>
            )}
          </Card>

          {usdtPay && (
            <Card className="md:col-span-2">
              <div className="mb-1 text-sm font-semibold">Pagar con USDT (red Tron · TRC20)</div>
              <p className="mb-4 text-xs text-amber-300">
                ⚠️ Enviá <b>solo USDT por la red Tron (TRC20)</b>. Mandar por otra red = pérdida de fondos.
              </p>
              <div className="flex flex-col gap-5 sm:flex-row">
                <div className="shrink-0 text-center">
                  <img
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&margin=8&data=${encodeURIComponent(usdtPay.address)}`}
                    alt="QR de la dirección USDT"
                    className="mx-auto rounded-lg bg-white p-1"
                    width={200}
                    height={200}
                  />
                  <div className="mt-2 text-2xl font-bold text-wa-green">{usdtPay.amountUsdt} USDT</div>
                  <div className="text-xs text-slate-500">monto exacto a enviar</div>
                </div>

                <div className="flex-1">
                  <div className="text-xs text-slate-400">Dirección receptora (TRC20)</div>
                  <div className="mt-1 flex items-center gap-2">
                    <code className="flex-1 break-all rounded-md border border-slate-700 bg-slate-900/60 px-3 py-2 text-xs text-slate-200">
                      {usdtPay.address}
                    </code>
                    <Button type="button" variant="secondary" onClick={() => void navigator.clipboard.writeText(usdtPay.address)}>
                      Copiar
                    </Button>
                  </div>

                  <ol className="mt-4 list-decimal space-y-1 pl-5 text-xs text-slate-400">
                    <li>Enviá <b>{usdtPay.amountUsdt} USDT</b> a esa dirección (red Tron / TRC20).</li>
                    <li>Copiá el <b>TXID</b> (hash de la transacción) desde tu wallet.</li>
                    <li>Pegalo abajo y tocá <b>Verificar pago</b>. Acreditamos los días al confirmar en la red.</li>
                  </ol>

                  <div className="mt-3 flex gap-2">
                    <Input
                      value={txid}
                      onChange={(e) => setTxid(e.target.value)}
                      placeholder="TXID de la transacción"
                    />
                    <Button type="button" disabled={verifying || !txid.trim()} onClick={() => void verifyUsdt()}>
                      {verifying ? "Verificando…" : "Verificar pago"}
                    </Button>
                  </div>
                </div>
              </div>
            </Card>
          )}

          {verifyMsg && (
            <Card className="md:col-span-2">
              <p className="text-sm text-emerald-300">{verifyMsg}</p>
            </Card>
          )}
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
