// Ruleta de premios del Chat App (2026-10-11) — panel del operador.
//   RuletaTab: arma las porciones (color, nombre, ícono, tipo, monto, %), la duración, vista previa, y la
//              activa/apaga. Activar = nueva ronda: todos los jugadores pueden volver a girar.
//   PremiosRuleta: en Cajero, los premios que ganaron los jugadores y esperan aprobación.
// El resultado de cada giro lo decide el servidor; el premio en fichas SOLO se acredita al aprobarlo acá.
import { useEffect, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { api, apiError } from "../lib/api";
import { API_BASE } from "../lib/config";
import { fmtDate } from "../lib/format";
import { Button, Card, ErrorMsg } from "./ui";

type Tipo = "fichas" | "giro" | "nada";
type Porcion = { label: string; color: string; icon: string; type: Tipo; amount: number; weight: number };
type Estado = { segments: Porcion[]; durationMin: number; status: string; active: boolean; endsAt: string | null; saved: boolean };

const TIPOS: { id: Tipo; label: string }[] = [
  { id: "fichas", label: "Fichas" },
  { id: "giro", label: "Giro extra" },
  { id: "nada", label: "Sin premio" },
];
const money = (n: number) => "$" + n.toLocaleString("es-AR");

// Punto del borde a `deg` grados desde arriba, en sentido horario.
const punto = (deg: number, r: number) => {
  const a = (deg * Math.PI) / 180;
  return `${100 + r * Math.sin(a)} ${100 - r * Math.cos(a)}`;
};

// Misma rueda que ve el jugador (porciones iguales: las probabilidades no se muestran).
function Rueda({ segments }: { segments: Porcion[] }) {
  const n = segments.length || 1;
  const a = 360 / n;
  return (
    <svg viewBox="0 0 200 200" className="h-full w-full">
      {segments.map((s, i) => {
        const d = `M100 100 L${punto(i * a, 96)} A96 96 0 ${a > 180 ? 1 : 0} 1 ${punto((i + 1) * a, 96)} Z`;
        const texto = s.label.length > 11 ? s.label.slice(0, 10) + "…" : s.label;
        return (
          <g key={i}>
            <path d={d} fill={s.color} stroke="#0b0b0f" strokeWidth="1.2" />
            <g transform={`rotate(${(i + 0.5) * a} 100 100)`}>
              <text x="100" y="30" textAnchor="middle" fontSize="15">{s.icon}</text>
              <text x="100" y="47" textAnchor="middle" fontSize={n > 8 ? 6.5 : 8} fontWeight="700" fill="#fff"
                style={{ paintOrder: "stroke", stroke: "rgba(0,0,0,.45)", strokeWidth: 1.6 }}>{texto}</text>
            </g>
          </g>
        );
      })}
      <circle cx="100" cy="100" r="14" fill="#0b0b0f" stroke="#f5c542" strokeWidth="3" />
      <polygon points="88,0 112,0 100,22" fill="#f5c542" />
    </svg>
  );
}

const COLORES = ["#e74c3c", "#3498db", "#2ecc71", "#9b59b6", "#e67e22", "#1abc9c", "#95a5a6", "#f1c40f"];

export function RuletaTab() {
  const [st, setSt] = useState<Estado | null>(null);
  const [segs, setSegs] = useState<Porcion[]>([]);
  const [dur, setDur] = useState(0);
  const [avisar, setAvisar] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [pendientes, setPendientes] = useState(0);
  const [girosHoy, setGirosHoy] = useState(0);

  const load = async () => {
    try {
      const { data } = await api.get<{ wheel: Estado; pendientes: number; girosHoy: number }>("/api/chat/wheel");
      setSt(data.wheel); setSegs(data.wheel.segments); setDur(data.wheel.durationMin);
      setPendientes(data.pendientes); setGirosHoy(data.girosHoy);
    } catch (e) { setError(apiError(e)); }
  };
  useEffect(() => { void load(); }, []);

  const total = segs.reduce((t, s) => t + (Number(s.weight) || 0), 0);
  const set = (i: number, patch: Partial<Porcion>) => setSegs((prev) => prev.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const agregar = () => setSegs((prev) => [...prev, { label: "Nueva porción", color: COLORES[prev.length % COLORES.length], icon: "🎁", type: "fichas", amount: 100, weight: 0 }]);
  const quitar = (i: number) => setSegs((prev) => prev.filter((_, j) => j !== i));

  const body = () => ({ segments: segs.map((s) => ({ ...s, amount: s.type === "fichas" ? Math.round(Number(s.amount) || 0) : 0, weight: Math.round(Number(s.weight) || 0) })), durationMin: Math.max(0, Math.round(dur || 0)) });

  const guardar = async () => {
    setBusy(true); setError(null); setOk(null);
    try { await api.put("/api/chat/wheel", body()); setOk("✓ Borrador guardado"); await load(); }
    catch (e) { setError(apiError(e)); } finally { setBusy(false); }
  };
  const activar = async () => {
    if (!confirm(st?.active ? "¿Reactivar la ruleta? Arranca una ronda nueva: todos pueden volver a girar." : "¿Activar la ruleta? Les aparece a todos los jugadores en el chat.")) return;
    setBusy(true); setError(null); setOk(null);
    try {
      const { data } = await api.post<{ avisados: number }>("/api/chat/wheel/activate", { ...body(), avisar });
      setOk(`✓ Ruleta activa${data.avisados ? ` · aviso enviado a ${data.avisados} dispositivo${data.avisados === 1 ? "" : "s"}` : ""}`);
      await load();
    } catch (e) { setError(apiError(e)); } finally { setBusy(false); }
  };
  const apagar = async () => {
    setBusy(true); setError(null); setOk(null);
    try { await api.post("/api/chat/wheel/stop"); setOk("Ruleta apagada"); await load(); }
    catch (e) { setError(apiError(e)); } finally { setBusy(false); }
  };

  if (!st) return <Card><p className="text-sm text-slate-500">{error ?? "Cargando…"}</p></Card>;

  const input = "rounded-md border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm text-slate-100 outline-none focus:border-wa-green";

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-slate-100">
              🎡 Ruleta de premios · {st.active ? <span className="text-wa-green">ACTIVA</span> : <span className="text-slate-400">apagada</span>}
            </div>
            <div className="text-xs text-slate-500">
              {st.active
                ? st.endsAt ? `Se cierra sola el ${fmtDate(st.endsAt)}.` : "Sin cierre: cada jugador gira 1 vez por día."
                : "Armá las porciones y activala: les aparece a los jugadores en el chat."}
              {" "}Giros últimas 24 h: {girosHoy}{pendientes ? ` · ${pendientes} premio${pendientes === 1 ? "" : "s"} para aprobar en Cajero` : ""}
            </div>
          </div>
          {st.active && <Button variant="ghost" onClick={() => void apagar()} disabled={busy}>Apagar</Button>}
        </div>
      </Card>

      {error && <ErrorMsg>{error}</ErrorMsg>}
      {ok && <p className="text-sm text-emerald-300">{ok}</p>}

      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        <Card>
          <div className="mb-2 hidden grid-cols-[36px_1fr_52px_110px_100px_70px_28px] gap-2 px-1 text-[11px] uppercase tracking-wide text-slate-500 sm:grid">
            <span>Color</span><span>Nombre</span><span>Ícono</span><span>Tipo</span><span>Monto</span><span>Prob.</span><span />
          </div>
          <div className="space-y-2">
            {segs.map((s, i) => (
              <div key={i} className="grid grid-cols-[36px_1fr_52px] gap-2 rounded-lg border border-slate-800 p-2 sm:grid-cols-[36px_1fr_52px_110px_100px_70px_28px] sm:border-0 sm:p-0">
                <input type="color" value={s.color} onChange={(e) => set(i, { color: e.target.value })} className="h-9 w-9 cursor-pointer rounded border border-slate-700 bg-transparent" aria-label="Color" />
                <input value={s.label} maxLength={30} onChange={(e) => set(i, { label: e.target.value })} className={input} aria-label="Nombre" />
                <input value={s.icon} maxLength={8} onChange={(e) => set(i, { icon: e.target.value })} className={`${input} text-center`} aria-label="Ícono" />
                <select value={s.type} onChange={(e) => set(i, { type: e.target.value as Tipo })} className={input} aria-label="Tipo">
                  {TIPOS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                </select>
                <div className="flex items-center gap-1">
                  <span className="text-xs text-slate-500">$</span>
                  <input type="number" min={0} disabled={s.type !== "fichas"} value={s.type === "fichas" ? s.amount : 0}
                    onChange={(e) => set(i, { amount: Number(e.target.value) })} className={`${input} w-full disabled:opacity-40`} aria-label="Monto" />
                </div>
                <div className="flex items-center gap-1">
                  <input type="number" min={0} max={100} value={s.weight} onChange={(e) => set(i, { weight: Number(e.target.value) })} className={`${input} w-full`} aria-label="Probabilidad" />
                  <span className="text-xs text-slate-500">%</span>
                </div>
                <button type="button" onClick={() => quitar(i)} disabled={segs.length <= 2} className="text-rose-400 hover:text-rose-300 disabled:opacity-30" aria-label="Quitar">✕</button>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between">
            <button type="button" onClick={agregar} disabled={segs.length >= 12} className="rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-40">+ Agregar porción</button>
            <span className={`text-xs font-semibold ${total === 100 ? "text-emerald-400" : "text-rose-400"}`}>Total: {total}%{total !== 100 ? " (tiene que ser 100%)" : ""}</span>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs text-slate-400">Duración (minutos)</label>
              <input type="number" min={0} value={dur} onChange={(e) => setDur(Number(e.target.value))} className={`${input} w-32`} />
              <p className="mt-1 text-[11px] text-slate-500">{dur > 0 ? `Se cierra sola a los ${dur} min. Cada jugador gira 1 vez.` : "0 = sin cierre: cada jugador gira 1 vez por día."}</p>
            </div>
            <label className="flex items-start gap-2 text-xs text-slate-300">
              <input type="checkbox" checked={avisar} onChange={(e) => setAvisar(e.target.checked)} className="mt-0.5" />
              <span>Avisar a los jugadores con una notificación al activarla.</span>
            </label>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => void guardar()} disabled={busy || total !== 100}>Guardar borrador</Button>
            <Button onClick={() => void activar()} disabled={busy || total !== 100}>{st.active ? "Guardar y reactivar" : "Crear y activar"}</Button>
          </div>
          <p className="mt-3 text-[11px] text-slate-500">
            🔒 El resultado lo decide el servidor según las probabilidades. Los premios en fichas NO se acreditan solos: aparecen en
            <b className="text-slate-300"> Cajero</b> para que los apruebes. "Giro extra" le da otro giro en el momento.
          </p>
        </Card>

        <Card className="flex flex-col items-center">
          <div className="mb-2 text-xs text-slate-400">Vista previa (así la ve el jugador)</div>
          <div className="aspect-square w-full max-w-[240px]"><Rueda segments={segs} /></div>
        </Card>
      </div>
    </div>
  );
}

type Premio = { id: string; player: string; label: string; amount: number; status: string; createdAt: string; resolvedAt: string | null };

// Sección de Cajero: premios de la ruleta que esperan aprobación (no se muestra si nunca hubo).
export function PremiosRuleta() {
  const [pend, setPend] = useState<Premio[]>([]);
  const [recientes, setRecientes] = useState<Premio[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const { data } = await api.get<{ pendientes: Premio[]; recientes: Premio[] }>("/api/chat/wheel/prizes");
      setPend(data.pendientes); setRecientes(data.recientes);
    } catch (e) { setError(apiError(e)); }
  };
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    const socket: Socket = io(`${API_BASE}/chat`, { withCredentials: true });
    socket.on("chat:cashier", () => void load());
    return () => { socket.off("chat:cashier"); socket.disconnect(); };
  }, []);

  const act = async (id: string, action: "approve" | "reject") => {
    if (action === "approve" && !confirm("¿Acreditar este premio? Se suma al saldo del jugador (y a su cuenta del casino, si está conectada).")) return;
    setBusy(id); setError(null);
    try { await api.post(`/api/chat/wheel/prizes/${id}/${action}`); await load(); }
    catch (e) { setError(apiError(e)); } finally { setBusy(null); }
  };

  if (!pend.length && !recientes.length) return null;

  return (
    <div>
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">🎡 Premios de la ruleta ({pend.length})</h2>
      {error && <ErrorMsg>{error}</ErrorMsg>}
      {pend.length === 0 ? (
        <Card><p className="text-sm text-slate-500">No hay premios para aprobar.</p></Card>
      ) : (
        <div className="space-y-2">
          {pend.map((p) => (
            <Card key={p.id} className="flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-slate-100">{p.player} · <span className="text-wa-green">{money(p.amount)}</span></div>
                <div className="text-xs text-slate-500">Ganó "{p.label}" · {fmtDate(p.createdAt)}</div>
              </div>
              <button disabled={busy === p.id} onClick={() => void act(p.id, "approve")} className="rounded-md bg-wa-green px-3 py-1.5 text-xs font-semibold text-slate-900 hover:brightness-95 disabled:opacity-50">✓ Acreditar</button>
              <button disabled={busy === p.id} onClick={() => void act(p.id, "reject")} className="rounded-md border border-rose-500/40 px-3 py-1.5 text-xs text-rose-300 hover:bg-rose-500/10 disabled:opacity-50">Rechazar</button>
            </Card>
          ))}
        </div>
      )}
      {recientes.length > 0 && (
        <details className="mt-2 text-xs text-slate-500">
          <summary className="cursor-pointer">Últimos resueltos</summary>
          <ul className="mt-1 space-y-0.5">
            {recientes.map((p) => (
              <li key={p.id}>{p.status === "credited" ? "✓" : "✕"} {p.player} · {p.label} · {p.resolvedAt ? fmtDate(p.resolvedAt) : ""}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
