import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";

export interface TourStep {
  targetId: string;   // id del elemento a resaltar
  title: string;
  body: string;
}

const CARD_W = 300;
const GAP = 16;

// Tour de bienvenida: oscurece la pantalla y resalta un elemento por vez (spotlight),
// con una tarjeta que explica de qué va. Se posiciona leyendo el rect del objetivo.
export default function OnboardingTour({ steps, onClose }: { steps: TourStep[]; onClose: () => void }) {
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);

  const measure = useCallback(() => {
    const el = document.getElementById(steps[i]?.targetId ?? "");
    if (!el) { setRect(null); return; }
    el.scrollIntoView({ block: "nearest", inline: "nearest" });
    setRect(el.getBoundingClientRect());
  }, [i, steps]);

  // Re-medimos al cambiar de paso, al hacer scroll/resize y con reintentos (el menú lateral
  // en móvil abre con animación de ~200ms, así que el rect tarda en asentarse).
  useLayoutEffect(() => {
    measure();
    const t1 = setTimeout(measure, 90);
    const t2 = setTimeout(measure, 320);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      clearTimeout(t1); clearTimeout(t2);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [measure]);

  // Escape cierra el tour.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const step = steps[i];
  if (!step) return null;
  const last = i === steps.length - 1;
  const next = () => (last ? onClose() : setI((n) => n + 1));

  const pad = 8;
  const box = rect
    ? { top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }
    : null;

  // Posición de la tarjeta: preferimos a la DERECHA del objetivo; si no entra, a la izquierda;
  // si tampoco, debajo. Clampeada al viewport. `side` define de qué lado va el señalador.
  const vw = typeof window !== "undefined" ? window.innerWidth : 1024;
  const vh = typeof window !== "undefined" ? window.innerHeight : 768;
  let cardLeft = vw / 2 - CARD_W / 2;
  let cardTop = vh / 2 - 90;
  let side: "left" | "right" | "top" = "left";
  if (rect) {
    if (rect.right + GAP + CARD_W <= vw) {
      cardLeft = rect.right + GAP; side = "left"; // señalador apunta a la izquierda (hacia el target)
      cardTop = rect.top;
    } else if (rect.left - GAP - CARD_W >= 0) {
      cardLeft = rect.left - GAP - CARD_W; side = "right";
      cardTop = rect.top;
    } else {
      cardLeft = Math.min(Math.max(GAP, rect.left), vw - CARD_W - GAP); side = "top";
      cardTop = rect.bottom + GAP;
    }
    cardTop = Math.min(Math.max(GAP, cardTop), vh - 200);
  }

  return createPortal(
    <div className="fixed inset-0 z-[100]" role="dialog" aria-modal="true">
      {/* Capa oscura + spotlight (el hueco transparente se logra con un box-shadow enorme). */}
      {box ? (
        <div
          className="pointer-events-none fixed rounded-xl ring-2 ring-wa-green transition-all duration-200"
          style={{
            top: box.top, left: box.left, width: box.width, height: box.height,
            boxShadow: "0 0 0 9999px rgba(2,6,23,0.82)",
          }}
        />
      ) : (
        <div className="fixed inset-0 bg-slate-950/85" onClick={onClose} />
      )}

      {/* Anillo pulsante (señalador) sobre el objetivo. */}
      {box && (
        <div
          className="pointer-events-none fixed rounded-xl ring-2 ring-wa-green/70 animate-ping"
          style={{ top: box.top, left: box.left, width: box.width, height: box.height }}
        />
      )}

      {/* Tarjeta explicativa. */}
      <div
        className="fixed w-[300px] rounded-xl border border-slate-700 bg-slate-900 p-4 shadow-2xl"
        style={{ top: cardTop, left: cardLeft }}
      >
        {/* Señalador (flechita) hacia el objetivo. */}
        {side === "left" && <div className="absolute -left-2 top-6 h-4 w-4 rotate-45 border-b border-l border-slate-700 bg-slate-900" />}
        {side === "right" && <div className="absolute -right-2 top-6 h-4 w-4 rotate-45 border-t border-r border-slate-700 bg-slate-900" />}
        {side === "top" && <div className="absolute -top-2 left-6 h-4 w-4 rotate-45 border-t border-l border-slate-700 bg-slate-900" />}

        <div className="mb-1 text-xs font-semibold text-wa-green">Paso {i + 1} de {steps.length}</div>
        <div className="mb-1 text-base font-bold text-white">{step.title}</div>
        <p className="text-sm leading-relaxed text-slate-300">{step.body}</p>

        <div className="mt-4 flex items-center justify-between">
          <button onClick={onClose} className="text-xs text-slate-400 hover:text-slate-200">Saltar</button>
          <div className="flex items-center gap-1.5">
            {steps.map((_, idx) => (
              <span key={idx} className={`h-1.5 w-1.5 rounded-full ${idx === i ? "bg-wa-green" : "bg-slate-600"}`} />
            ))}
          </div>
          <button onClick={next} className="rounded-md bg-wa-green px-3 py-1.5 text-sm font-semibold text-slate-900 hover:brightness-110">
            {last ? "¡Listo!" : "Siguiente"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
