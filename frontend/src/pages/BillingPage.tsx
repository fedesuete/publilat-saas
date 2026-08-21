import { useEffect, useRef, useState } from "react";
import { api, apiError } from "../lib/api";
import { fmtDate, fmtRemaining } from "../lib/format";
import { Button, Input, Card, ErrorMsg } from "../components/ui";

interface LedgerEntry {
  id: string;
  delta: number;
  reason: string;
  createdAt: string;
}

type Provider = "mercadopago" | "stripe" | "usdt" | "pagopar";
interface Methods {
  mercadopago: boolean;
  stripe: boolean;
  usdt: boolean;
  pagopar: boolean;
}
interface ActiveLine {
  id: string;
  label: string | null;
  phone: string | null;
  expiresAt: string | null;
}
interface CreditResponse {
  days: number;
  ledger: LedgerEntry[];
  activeLines?: ActiveLine[];
  methods: Methods;
}

const PROVIDER_LABEL: Record<Provider, string> = {
  mercadopago: "MercadoPago",
  stripe: "Tarjeta (Stripe)",
  usdt: "USDT (cripto)",
  pagopar: "Pago con tarjeta",
};

const ALL_PROVIDERS: Provider[] = ["mercadopago", "stripe", "usdt", "pagopar"];

// ---- PAQUETES (planes a precio fijo). Coinciden con las promos del backend (payments.ts). El orden
// va de menor a mayor; el Full es el ancla premium (destacado) para empujar a los planes de arriba.
type PlanKey = "prueba" | "semana" | "mes" | "2meses" | "full";
interface Plan {
  key: PlanKey;
  name: string;
  usd: number;
  days: number;
  period: string;
  tagline: string;
  pros: string[];
  cons: string[];
  badge?: string;
  featured?: boolean;
}
const PLANS: Plan[] = [
  {
    key: "prueba", name: "Prueba", usd: 4, days: 2, period: "2 días",
    tagline: "Probá el producto sin comprometerte",
    pros: ["1 línea de WhatsApp activa 2 días", "Landings y links de rastreo (gratis)", "Dashboard de ROAS y CRM"],
    cons: ["Se corta a los 2 días", "Sin descuento por volumen"],
  },
  {
    key: "semana", name: "Semana laboral", usd: 7, days: 7, period: "7 días", badge: "MÁS ELEGIDO",
    tagline: "Una semana entera a mitad de precio",
    pros: ["7 días de línea activa", "Sale 1 USD por día (la mitad)", "Todo lo de Prueba incluido"],
    cons: ["Setup y gestión a tu cargo"],
  },
  {
    key: "mes", name: "Mes", usd: 60, days: 30, period: "30 días",
    tagline: "Un mes completo trabajando en serio",
    pros: ["30 días de línea activa", "Rotación de líneas incluida", "Soporte prioritario"],
    cons: ["Sin bot de gestión", "Sin setup personalizado"],
  },
  {
    key: "2meses", name: "2 Meses", usd: 80, days: 60, period: "60 días", badge: "MEJOR PRECIO",
    tagline: "El precio por día más bajo",
    pros: ["60 días por 80 USD (ahorrás 40)", "Sale 1,33 USD por día", "Todo lo del plan Mes"],
    cons: ["Vos gestionás el día a día"],
  },
  {
    key: "full", name: "Full — Llave en mano", usd: 300, days: 30, period: "30 días + setup",
    tagline: "Nosotros te armamos TODO y vos solo vendés", featured: true, badge: "⭐ PREMIUM",
    pros: [
      "1 mes de Publi.lat completo",
      "Bot de gestión de sistemas",
      "Chat App personalizada para tu marca",
      "Landing hecha por nosotros",
      "Setup y acompañamiento 1 a 1",
    ],
    cons: [],
  },
];
const planByKey = (k: PlanKey) => PLANS.find((p) => p.key === k)!;

export default function BillingPage() {
  const [days, setDays] = useState(0);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [activeLines, setActiveLines] = useState<ActiveLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [buyDays, setBuyDays] = useState("1");
  const [buying, setBuying] = useState<Provider | null>(null);
  const [checkoutMsg, setCheckoutMsg] = useState<string | null>(null);
  const [methods, setMethods] = useState<Methods>({ mercadopago: false, stripe: false, usdt: false, pagopar: false });
  const [prices, setPrices] = useState<Record<Provider, { amount: number; currency: string }> | null>(null);
  const [showManual, setShowManual] = useState(false); // el selector de "días sueltos" (secundario)

  // Plan elegido de la grilla de paquetes: abre el checkout enfocado (tarjeta / cripto) para ese plan.
  const [selectedPlan, setSelectedPlan] = useState<PlanKey | null>(null);
  const checkoutRef = useRef<HTMLDivElement | null>(null);

  // Pagopar exige nombre y CI/RUC del comprador para crear el pedido.
  const [showPagopar, setShowPagopar] = useState(false);
  const [promoKey, setPromoKey] = useState<PlanKey | null>(null); // el form de tarjeta cobra este paquete (null = días sueltos)
  const [ppNombre, setPpNombre] = useState("");
  const [ppDocumento, setPpDocumento] = useState("");
  const [ppTelefono, setPpTelefono] = useState("");

  // Pago USDT directo a wallet propia (red Tron / TRC20).
  const [usdtPay, setUsdtPay] = useState<{ address: string; amountUsdt: number; paymentId: string } | null>(null);
  const [txid, setTxid] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verifyMsg, setVerifyMsg] = useState<string | null>(null);

  // Banner de pago: los días se acreditan por webhook ASÍNCRONO (Pagopar/MP/USDT abren checkout en
  // otra pestaña). Tras abrir el checkout — o al volver con ?status=success — vigilamos el crédito
  // y avisamos apenas suben los días. Ver [[fixes-pendientes]] ítem 9.
  const [payWatch, setPayWatch] = useState(false);
  const [payDone, setPayDone] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);
  useEffect(() => () => { if (pollRef.current) window.clearInterval(pollRef.current); }, []);

  const watchPayment = (baseline: number) => {
    if (pollRef.current) window.clearInterval(pollRef.current);
    setPayWatch(true);
    setPayDone(null);
    let tries = 0;
    pollRef.current = window.setInterval(async () => {
      tries += 1;
      try {
        const { data } = await api.get<CreditResponse>("/api/billing/credit");
        if (data.days > baseline) {
          if (pollRef.current) window.clearInterval(pollRef.current);
          pollRef.current = null;
          setPayWatch(false);
          setPayDone(`✅ ¡Pago confirmado! Se acreditaron ${data.days - baseline} día(s).`);
          setDays(data.days);
          setLedger(data.ledger);
          setActiveLines(data.activeLines ?? []);
          return;
        }
      } catch {
        /* reintenta en el próximo tick */
      }
      if (tries >= 60) { // ~5 min: cortamos el poll (el webhook puede tardar)
        if (pollRef.current) window.clearInterval(pollRef.current);
        pollRef.current = null;
        setPayWatch(false);
      }
    }, 5000);
  };

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get<CreditResponse>("/api/billing/credit");
      setDays(data.days);
      setLedger(data.ledger);
      setActiveLines(data.activeLines ?? []);
      if (data.methods) setMethods(data.methods);
    } catch (err) {
      setError(apiError(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const { data } = await api.get<CreditResponse>("/api/billing/credit");
        setDays(data.days);
        setLedger(data.ledger);
        setActiveLines(data.activeLines ?? []);
        if (data.methods) setMethods(data.methods);
        // Vuelta del checkout (MP/USDT-tarjeta usan ?status=success): vigilamos la acreditación.
        const params = new URLSearchParams(window.location.search);
        if (params.get("status") === "success") {
          window.history.replaceState({}, "", window.location.pathname); // que un F5 no re-dispare
          watchPayment(data.days);
        }
      } catch (err) {
        setError(apiError(err));
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cotiza el precio por proveedor cada vez que cambia la cantidad de días (selector manual).
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

  const buy = async (
    provider: Provider,
    buyer?: { nombre: string; documento: string; telefono?: string },
    promo?: PlanKey,
  ) => {
    const n = promo ? planByKey(promo).days : parseInt(buyDays, 10);
    if (!promo && (!Number.isInteger(n) || n <= 0)) {
      setError("Ingresá una cantidad de días válida (entero mayor a 0).");
      return;
    }
    // Pagopar necesita los datos del comprador: primero mostramos el mini-formulario.
    if (provider === "pagopar" && !buyer) {
      setPromoKey(promo ?? null);
      setShowPagopar(true);
      setCheckoutMsg(null);
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
      >("/api/billing/checkout", { days: n, provider, ...(promo ? { promo } : {}), ...(buyer ? { buyer } : {}) });
      if ("direct" in data && data.direct) {
        setUsdtPay({ address: data.address, amountUsdt: data.amountUsdt, paymentId: data.paymentId });
      } else if ("stub" in data && data.stub) {
        setCheckoutMsg(`${data.message} (${data.amount} ${data.currency})`);
      } else if ("url" in data) {
        // window.open tras un await lo BLOQUEA el navegador móvil (no es "gesto directo") → los botones
        // no hacían nada en el celu. Si no abre la pestaña, navegamos en la MISMA (siempre funciona).
        const win = window.open(data.url, "_blank");
        if (win) {
          setCheckoutMsg(`Te abrimos el checkout de ${PROVIDER_LABEL[provider]} en otra pestaña.`);
          if (provider === "pagopar") { setShowPagopar(false); setPromoKey(null); }
          // El pago se acredita por webhook: quedamos vigilando para avisar apenas suben los días.
          watchPayment(days);
        } else {
          // Móvil / popup bloqueado: vamos derecho al checkout en esta pestaña.
          window.location.href = data.url;
        }
      }
    } catch (err) {
      setError(apiError(err));
    } finally {
      setBuying(null);
    }
  };

  // Elegir un paquete de la grilla: fija el plan y baja al checkout enfocado (tarjeta / cripto).
  const choosePlan = (key: PlanKey) => {
    setSelectedPlan(key);
    setCheckoutMsg(null);
    setShowPagopar(false);
    setPromoKey(null);
    setUsdtPay(null);
    setTimeout(() => checkoutRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
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

  // ¿Se puede pagar un paquete? (los planes se cobran por tarjeta/Pagopar o cripto/USDT).
  const canPayPlans = methods.pagopar || methods.usdt;
  const sel = selectedPlan ? planByKey(selectedPlan) : null;

  return (
    <div className="p-6">
      <h1 className="mb-2 text-xl font-bold">Créditos</h1>
      <p className="mb-5 text-sm text-slate-400">
        1 día = 1 línea activa por 24 h. Activá líneas consumiendo días del crédito.
        Al vencer, la línea sale de rotación automáticamente.{" "}
        <b className="text-slate-300">Las landings y los links son gratis</b> — no consumen días, usan tu línea activa como destino.
      </p>

      {error && (
        <div className="mb-4">
          <ErrorMsg>{error}</ErrorMsg>
        </div>
      )}

      {payWatch && (
        <div className="mb-4 flex items-center gap-2 rounded-md border border-amber-800 bg-amber-900/30 px-3 py-2 text-sm text-amber-200">
          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-amber-400 border-t-transparent" />
          Estamos confirmando tu pago… los días se acreditan apenas el medio de pago confirme (puede tardar unos minutos). Podés dejar esta pestaña abierta.
        </div>
      )}
      {payDone && (
        <div className="mb-4 rounded-md border border-emerald-800 bg-emerald-900/40 px-3 py-2 text-sm font-semibold text-emerald-200">
          {payDone}
        </div>
      )}

      {loading ? (
        <p className="text-slate-400">Cargando…</p>
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          <Card className="md:col-span-2">
            <div className="text-sm text-slate-400">Días disponibles para activar</div>
            <div className="mt-1 text-5xl font-bold text-wa-green">{days}</div>
            <div className="mt-1 text-xs text-slate-500">
              {days === 1 ? "1 día sin usar (para activar una línea)" : `${days} días sin usar (para activar tus líneas)`}
            </div>
          </Card>

          {/* Líneas con día vigente: aclara que los días YA activados no se perdieron — son el tiempo
              que la línea queda prendida — y responde "hasta qué día está activo mi WhatsApp". */}
          {activeLines.length > 0 && (
            <Card className="md:col-span-2">
              <div className="mb-1 text-sm font-semibold text-slate-200">📶 Tu WhatsApp activo</div>
              <p className="mb-3 text-xs text-slate-500">
                Los días que ya activaste no se pierden: son el tiempo que tu línea queda prendida. Acá ves hasta cuándo.
              </p>
              <div className="space-y-2">
                {activeLines.map((l) => (
                  <div key={l.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2">
                    <span className="min-w-0 truncate text-sm text-slate-200">
                      🟢 {l.label || (l.phone ? `Línea ${l.phone}` : "Tu línea de WhatsApp")}
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block text-sm font-semibold text-wa-green">activa hasta {fmtDate(l.expiresAt)}</span>
                      <span className="block text-xs text-slate-500">{fmtRemaining(l.expiresAt)}</span>
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* ====== PAQUETES: la sección principal. Es lo primero que ve una cuenta nueva al entrar. ====== */}
          <div className="md:col-span-2">
            <h2 className="text-lg font-bold text-slate-100">Elegí tu plan</h2>
            <p className="mt-1 text-sm text-slate-400">
              Empezá probando o andá directo al pack que más te rinde. Podés cambiar cuando quieras.
            </p>

            {!canPayPlans && (
              <p className="mt-3 text-sm text-slate-400">
                Todavía no hay un medio de pago habilitado. Escribinos por Soporte para activarlo.
              </p>
            )}

            <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {PLANS.map((p) => {
                const isSel = selectedPlan === p.key;
                return (
                  <div
                    key={p.key}
                    className={`relative flex flex-col rounded-2xl border p-5 transition ${
                      p.featured
                        ? "border-wa-green/60 bg-gradient-to-b from-wa-green/10 to-slate-900/40 shadow-[0_0_40px_-12px_rgba(37,211,102,0.5)]"
                        : isSel
                          ? "border-wa-green/70 bg-slate-900/60"
                          : "border-slate-800 bg-slate-900/40 hover:border-slate-600"
                    }`}
                  >
                    {p.badge && (
                      <span
                        className={`absolute -top-2.5 left-4 rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${
                          p.featured ? "bg-wa-green text-slate-950" : "bg-slate-700 text-slate-100"
                        }`}
                      >
                        {p.badge}
                      </span>
                    )}

                    <div className="text-sm font-semibold text-slate-200">{p.name}</div>
                    <div className="mt-2 flex items-baseline gap-1.5">
                      <span className="text-3xl font-extrabold text-white">US${p.usd}</span>
                      <span className="text-xs text-slate-500">/ {p.period}</span>
                    </div>
                    <p className="mt-1 text-xs text-slate-400">{p.tagline}</p>

                    <ul className="mt-4 flex-1 space-y-1.5 text-sm">
                      {p.pros.map((pro) => (
                        <li key={pro} className="flex gap-2 text-slate-300">
                          <span className="mt-0.5 shrink-0 font-bold text-wa-green">✓</span>
                          <span>{pro}</span>
                        </li>
                      ))}
                      {p.cons.map((con) => (
                        <li key={con} className="flex gap-2 text-slate-500">
                          <span className="mt-0.5 shrink-0 font-bold text-slate-600">✕</span>
                          <span>{con}</span>
                        </li>
                      ))}
                    </ul>

                    <button
                      type="button"
                      disabled={!canPayPlans}
                      onClick={() => choosePlan(p.key)}
                      className={`mt-5 w-full rounded-xl px-4 py-2.5 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-40 ${
                        p.featured
                          ? "bg-wa-green text-slate-950 hover:brightness-110"
                          : "border border-wa-green/50 text-wa-green hover:bg-wa-green/10"
                      }`}
                    >
                      {p.featured ? "Quiero el completo →" : "Elegir plan →"}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ====== Checkout enfocado del plan elegido: elegí cómo pagar ese paquete. ====== */}
          {sel && canPayPlans && (
            <div ref={checkoutRef} className="md:col-span-2">
            <Card className="border-wa-green/40">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="text-sm font-semibold text-slate-100">
                  Estás comprando: <span className="text-wa-green">{sel.name}</span>
                </div>
                <div className="text-sm text-slate-400">
                  <b className="text-white">US${sel.usd}</b> · {sel.period}
                </div>
              </div>
              {sel.key === "full" && (
                <p className="mt-2 rounded-md border border-wa-green/30 bg-wa-green/5 px-3 py-2 text-xs text-slate-300">
                  El plan Full incluye <b>setup personalizado</b> (bot, Chat App y landing). Apenas se confirma el pago te
                  contactamos para armarte todo. Se acreditan 30 días para arrancar.
                </p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                {methods.pagopar && (
                  <Button type="button" disabled={buying !== null} onClick={() => void buy("pagopar", undefined, sel.key)}>
                    💳 Pagar con tarjeta · US${sel.usd}
                  </Button>
                )}
                {methods.usdt && (
                  <Button type="button" variant="secondary" disabled={buying !== null} onClick={() => void buy("usdt", undefined, sel.key)}>
                    ₮ Pagar con cripto (USDT) · US${sel.usd}
                  </Button>
                )}
              </div>
              <p className="mt-2 text-xs text-slate-500">
                Pago seguro. Los días se acreditan automáticamente al confirmarse el pago.
              </p>
              {checkoutMsg && (
                <p className="mt-3 rounded-md border border-emerald-800 bg-emerald-900/40 px-3 py-2 text-sm text-emerald-200">
                  {checkoutMsg}
                </p>
              )}
            </Card>
            </div>
          )}

          {/* ====== Pagopar: form de datos del comprador (para el plan elegido o días sueltos). ====== */}
          {showPagopar && (
            <Card className="md:col-span-2">
              <div className="mb-1 text-sm font-semibold">
                {promoKey ? `${planByKey(promoKey).name} — US$${planByKey(promoKey).usd}` : "Pago con tarjeta"}
              </div>
              <p className="mb-3 text-xs text-slate-400">
                {promoKey && `Se acreditan ${planByKey(promoKey).days} días de línea activa. `}
                Tarjetas de crédito/débito (locales e internacionales), billeteras (Tigo Money, Personal Pay, Zimple…),
                QR y PIX. Se piden los datos del comprador para generar el pedido.
              </p>
              <div className="flex flex-wrap items-end gap-2">
                <div>
                  <div className="mb-1 text-xs text-slate-400">Nombre y apellido</div>
                  <Input value={ppNombre} onChange={(e) => setPpNombre(e.target.value)} placeholder="Juan Pérez" className="w-52" />
                </div>
                <div>
                  <div className="mb-1 text-xs text-slate-400">CI / RUC (solo números)</div>
                  <Input
                    value={ppDocumento}
                    onChange={(e) => setPpDocumento(e.target.value.replace(/\D/g, ""))}
                    placeholder="1234567"
                    className="w-40"
                  />
                </div>
                <div>
                  <div className="mb-1 text-xs text-slate-400">Teléfono (opcional)</div>
                  <Input value={ppTelefono} onChange={(e) => setPpTelefono(e.target.value)} placeholder="+595 9xx xxx xxx" className="w-44" />
                </div>
                <Button
                  type="button"
                  disabled={buying !== null || ppNombre.trim().length < 3 || !/^\d{5,24}$/.test(ppDocumento)}
                  onClick={() =>
                    void buy(
                      "pagopar",
                      {
                        nombre: ppNombre.trim(),
                        documento: ppDocumento,
                        ...(ppTelefono.trim() ? { telefono: ppTelefono.trim() } : {}),
                      },
                      promoKey ?? undefined,
                    )
                  }
                >
                  {buying === "pagopar" ? "…" : "Continuar al pago"}
                </Button>
                <Button type="button" variant="secondary" onClick={() => { setShowPagopar(false); setPromoKey(null); }}>
                  Cancelar
                </Button>
              </div>
              <p className="mt-2 text-xs text-slate-500">
                El pago se procesa en guaraníes (PYG) en un checkout seguro (Pagopar); los días se acreditan automáticamente al confirmarse.
              </p>
            </Card>
          )}

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

          {/* ====== Días sueltos (secundario): para quien quiere elegir la cantidad exacta. ====== */}
          <Card className="md:col-span-2">
            <button
              type="button"
              onClick={() => setShowManual((v) => !v)}
              className="flex w-full items-center justify-between text-left text-sm font-semibold text-slate-300"
            >
              <span>¿Preferís elegir la cantidad de días? Comprá días sueltos</span>
              <span className="text-slate-500">{showManual ? "▲" : "▼"}</span>
            </button>

            {showManual && (
              <div className="mt-4">
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
                <div className="mb-3 flex flex-wrap gap-2">
                  {[2, 7, 15, 30].map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setBuyDays(String(d))}
                      className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                        parseInt(buyDays, 10) === d
                          ? "border-wa-green bg-wa-green/15 text-wa-green"
                          : "border-slate-700 text-slate-300 hover:border-slate-500"
                      }`}
                    >
                      {d} días
                    </button>
                  ))}
                </div>
                {ALL_PROVIDERS.filter((p) => methods[p]).length > 0 ? (
                  <>
                    <div className="flex flex-wrap gap-2">
                      {ALL_PROVIDERS
                        .filter((p) => methods[p])
                        .map((p) => {
                          const usd = prices?.usdt?.amount;
                          const price = prices?.[p];
                          const label =
                            p === "pagopar"
                              ? `${PROVIDER_LABEL[p]}${usd != null ? ` · ${usd} USD` : ""}`
                              : `${PROVIDER_LABEL[p]}${price ? ` · ${price.amount.toLocaleString("es-AR")} ${price.currency}` : ""}`;
                          return (
                            <Button key={p} type="button" disabled={buying !== null} onClick={() => { setPromoKey(null); void buy(p); }}>
                              {buying === p ? "…" : label}
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
              </div>
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
