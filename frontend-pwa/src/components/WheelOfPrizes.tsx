// Ruleta de premios dentro del chat (2026-10-11). Si el operador la activó y el jugador puede girar,
// aparece un aviso sobre la barra de escribir; al tocarlo se abre la ruleta. El RESULTADO lo decide el
// servidor (POST /me/wheel/spin): acá solo se anima hasta la porción que salió. El premio en fichas lo
// acredita el cajero (el mensaje queda en el chat).
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";

type Porcion = { label: string; color: string; icon: string };
type Ruleta = { segments: Porcion[]; endsAt: string | null; round: number; canSpin: boolean; diaria: boolean };
type Resultado = { segment: number; label: string; type: "fichas" | "giro" | "nada"; amount: number; canSpin: boolean };

const GIRO_MS = 4800;

// Punto del borde a `deg` grados desde arriba, en sentido horario.
const punto = (deg: number, r: number) => {
  const a = (deg * Math.PI) / 180;
  return `${100 + r * Math.sin(a)} ${100 - r * Math.cos(a)}`;
};

export function RuedaSVG({ segments, rotation, transition }: { segments: Porcion[]; rotation: number; transition: string }) {
  const n = segments.length || 1;
  const a = 360 / n;
  return (
    <svg viewBox="0 0 200 200" className="h-full w-full drop-shadow-xl"
      style={{ transform: `rotate(${rotation}deg)`, transition, transformOrigin: "50% 50%" }}>
      {segments.map((s, i) => {
        const d = `M100 100 L${punto(i * a, 96)} A96 96 0 ${a > 180 ? 1 : 0} 1 ${punto((i + 1) * a, 96)} Z`;
        const centro = (i + 0.5) * a;
        const texto = s.label.length > 11 ? s.label.slice(0, 10) + "…" : s.label;
        return (
          <g key={i}>
            <path d={d} fill={s.color} stroke="#0b0b0f" strokeWidth="1.2" />
            <g transform={`rotate(${centro} 100 100)`}>
              <text x="100" y="30" textAnchor="middle" fontSize="15">{s.icon}</text>
              <text x="100" y="47" textAnchor="middle" fontSize={n > 8 ? 6.5 : 8} fontWeight="700" fill="#fff"
                style={{ paintOrder: "stroke", stroke: "rgba(0,0,0,.45)", strokeWidth: 1.6 }}>{texto}</text>
            </g>
          </g>
        );
      })}
      <circle cx="100" cy="100" r="14" fill="#0b0b0f" stroke="#f5c542" strokeWidth="3" />
    </svg>
  );
}

function restante(endsAt: string | null): string | null {
  if (!endsAt) return null;
  const ms = new Date(endsAt).getTime() - Date.now();
  if (ms <= 0) return null;
  const m = Math.floor(ms / 60000), s = Math.floor((ms % 60000) / 1000);
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m}:${String(s).padStart(2, "0")}`;
}

export default function WheelOfPrizes() {
  const [ruleta, setRuleta] = useState<Ruleta | null>(null);
  const [abierta, setAbierta] = useState(false);
  const [girando, setGirando] = useState(false);
  const [rotacion, setRotacion] = useState(0);
  const [transicion, setTransicion] = useState("none");
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, tick] = useState(0);
  const rotRef = useRef(0);

  const cargar = useCallback(() => {
    api.get<{ wheel: Ruleta | null }>("/api/chat/me/wheel")
      .then(({ data }) => setRuleta(data.wheel))
      .catch(() => undefined);
  }, []);

  // Al entrar, cada minuto y al volver a la app: el operador puede activarla en cualquier momento.
  useEffect(() => {
    cargar();
    const id = setInterval(cargar, 60_000);
    const vis = () => { if (document.visibilityState === "visible") cargar(); };
    document.addEventListener("visibilitychange", vis);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", vis); };
  }, [cargar]);

  // Cuenta regresiva del cierre (solo con duración).
  useEffect(() => {
    if (!ruleta?.endsAt) return;
    const id = setInterval(() => {
      tick((t) => t + 1);
      if (new Date(ruleta.endsAt!).getTime() <= Date.now()) cargar();
    }, 1000);
    return () => clearInterval(id);
  }, [ruleta?.endsAt, cargar]);

  const girar = async () => {
    if (!ruleta || girando) return;
    setGirando(true); setError(null); setResultado(null);
    try {
      const { data } = await api.post<Resultado>("/api/chat/me/wheel/spin");
      const n = ruleta.segments.length;
      const a = 360 / n;
      // Que la porción ganadora quede bajo la flecha de arriba: 6 vueltas + el ángulo de su centro
      // (con un desvío chico para que no caiga siempre en el medio exacto).
      const desvio = (Math.random() - 0.5) * a * 0.6;
      const destino = 360 - ((data.segment + 0.5) * a + desvio);
      const base = rotRef.current - (rotRef.current % 360);
      const final = base + 360 * 6 + destino;
      rotRef.current = final;
      setTransicion(`transform ${GIRO_MS}ms cubic-bezier(0.12, 0.8, 0.12, 1)`);
      setRotacion(final);
      setTimeout(() => {
        setResultado(data);
        setGirando(false);
        setRuleta((r) => (r ? { ...r, canSpin: data.canSpin } : r));
      }, GIRO_MS + 150);
    } catch (e) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg ?? "No se pudo girar. Probá de nuevo.");
      setGirando(false);
      cargar();
    }
  };

  const cerrar = () => {
    if (girando) return;
    setAbierta(false); setResultado(null); setError(null);
    cargar();
  };

  const queda = restante(ruleta?.endsAt ?? null);
  const mostrarAviso = !!ruleta && ruleta.canSpin && !abierta;

  return (
    <>
      {mostrarAviso && (
        <button onClick={() => setAbierta(true)}
          className="mx-3 mb-2 mt-2 flex items-center gap-3 rounded-2xl px-4 py-3 text-left shadow-lg"
          style={{ background: "linear-gradient(90deg, var(--brand-primary), var(--brand-accent, var(--brand-primary)))" }}>
          <span className="wheel-bounce text-3xl" aria-hidden="true">🎡</span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-extrabold text-white">¡Ruleta de premios activa!</span>
            <span className="block text-xs text-white/85">
              Girá y ganá fichas{queda ? ` · cierra en ${queda}` : ruleta.diaria ? " · 1 giro por día" : ""}
            </span>
          </span>
          <span className="shrink-0 rounded-full bg-white px-3 py-1.5 text-xs font-extrabold text-slate-900">GIRAR</span>
        </button>
      )}

      {abierta && ruleta && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={cerrar}>
          <div className="w-full max-w-sm rounded-3xl p-5 text-center" style={{ background: "#14141b" }} onClick={(e) => e.stopPropagation()}>
            <div className="text-lg font-extrabold text-white">🎡 Ruleta de premios</div>
            {queda && <div className="mt-0.5 text-xs text-amber-300">Cierra en {queda}</div>}

            <div className="relative mx-auto mt-4 aspect-square w-full max-w-[300px]">
              {/* Flecha fija arriba: marca la porción ganadora. */}
              <div className="absolute left-1/2 top-[-6px] z-10 -translate-x-1/2"
                style={{ width: 0, height: 0, borderLeft: "13px solid transparent", borderRight: "13px solid transparent", borderTop: "26px solid #f5c542", filter: "drop-shadow(0 2px 2px rgba(0,0,0,.5))" }} />
              <RuedaSVG segments={ruleta.segments} rotation={rotacion} transition={transicion} />
            </div>

            {resultado ? (
              <div className="mt-4">
                <div className="text-2xl">{resultado.type === "fichas" ? "🎉" : resultado.type === "giro" ? "🔄" : "😅"}</div>
                <div className="mt-1 text-base font-extrabold text-white">
                  {resultado.type === "fichas" ? `¡Ganaste ${resultado.label}!` : resultado.type === "giro" ? "¡Giro gratis!" : resultado.label}
                </div>
                <p className="mt-1 text-xs text-slate-400">
                  {resultado.type === "fichas" ? "El cajero te las acredita en breve. Te avisamos acá en el chat."
                    : resultado.type === "giro" ? "Tenés otro giro." : "¡La próxima seguro te toca!"}
                </p>
                {resultado.canSpin ? (
                  <button onClick={() => void girar()} className="mt-4 w-full rounded-full py-3 text-sm font-extrabold text-slate-900" style={{ background: "#f5c542" }}>GIRAR DE NUEVO</button>
                ) : (
                  <button onClick={cerrar} className="mt-4 w-full rounded-full py-3 text-sm font-extrabold text-white" style={{ background: "var(--brand-primary)" }}>Volver al chat</button>
                )}
              </div>
            ) : (
              <>
                {error && <p className="mt-3 text-xs text-rose-300">{error}</p>}
                <button onClick={() => void girar()} disabled={girando || !ruleta.canSpin}
                  className="mt-4 w-full rounded-full py-3 text-base font-extrabold text-slate-900 disabled:opacity-60" style={{ background: "#f5c542" }}>
                  {girando ? "Girando…" : ruleta.canSpin ? "GIRAR" : "Ya giraste"}
                </button>
                {!girando && <button onClick={cerrar} className="mt-2 text-xs text-slate-500 underline">Cerrar</button>}
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
