// "Cargas del formulario" (2026-10-22): TODAS las cargas de las landings B2B, califiquen o no, para ver cuántas
// no califican y por qué. Las calificadas además le llegan al dueño por WhatsApp + correo. Solo se muestra si la
// cuenta tiene alguna carga guardada (el resto de los clientes no ve nada nuevo).
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Card } from "./ui";

type Resp = { rubro?: string; que?: string; cuando?: string; inv?: string };
type Carga = {
  id: string; createdAt: string; nombre: string | null; telefono: string | null; pais: string | null;
  respuestas: Resp; califica: boolean; motivo: string | null; utm: string | null; anuncio: boolean;
  notifiedAt: string | null; emailedAt: string | null;
};
type Datos = { resumen: { total: number; califican: number; noCalifican: number; ultimos7: number; porMotivo: Record<string, number> }; cargas: Carga[] };

const RUBRO: Record<string, string> = { casino: "Casino", cajero: "Cajero", otro: "Otro rubro" };
const CUANDO: Record<string, string> = { ya: "Esta semana", mes: "Este mes", mirando: "Averiguando" };
const INV: Record<string, string> = { simple: "Simple USD 200/mes", unico: "Pago único", no: "Sin inversión" };

const fecha = (iso: string) =>
  new Date(iso).toLocaleString("es-AR", { timeZone: "America/Asuncion", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export default function CargasLanding() {
  const [d, setD] = useState<Datos | null>(null);
  const [filtro, setFiltro] = useState<"todas" | "si" | "no">("todas");

  useEffect(() => {
    api.get<Datos>("/api/landings/cargas").then(({ data }) => setD(data)).catch(() => undefined);
  }, []);

  if (!d || d.resumen.total === 0) return null;
  const r = d.resumen;
  const lista = d.cargas.filter((c) => filtro === "todas" || (filtro === "si" ? c.califica : !c.califica));

  return (
    <Card className="mb-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-100">📋 Cargas del formulario</div>
          <p className="text-xs text-slate-500">Todo lo que completan en tus landings. Las que califican te llegan por WhatsApp y correo.</p>
        </div>
        <div className="flex gap-2 text-center">
          {[["Total", r.total, "text-slate-100"], ["Califican", r.califican, "text-wa-green"], ["No califican", r.noCalifican, "text-amber-300"], ["Últ. 7 días", r.ultimos7, "text-slate-300"]].map(([k, v, c]) => (
            <div key={String(k)} className="rounded-lg border border-slate-800 px-3 py-1.5">
              <div className={`text-lg font-bold tabular-nums ${c}`}>{v}</div>
              <div className="text-[10px] uppercase tracking-wide text-slate-500">{k}</div>
            </div>
          ))}
        </div>
      </div>

      {r.noCalifican > 0 && (
        <p className="mt-3 text-xs text-slate-400">
          Por qué no califican: {Object.entries(r.porMotivo).map(([m, n]) => `${m} (${n})`).join(" · ")}
        </p>
      )}

      <div className="mt-3 flex gap-1 text-xs">
        {([["todas", "Todas"], ["si", "Califican"], ["no", "No califican"]] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setFiltro(k)}
            className={`rounded-full px-3 py-1 ${filtro === k ? "bg-wa-green font-semibold text-slate-900" : "text-slate-400 hover:bg-slate-800"}`}>{l}</button>
        ))}
      </div>

      <div className="mt-2 max-h-96 overflow-auto">
        <table className="w-full min-w-[46rem] text-left text-xs">
          <thead className="sticky top-0 bg-slate-900 text-[10px] uppercase tracking-wide text-slate-500">
            <tr><th className="py-2 pr-2">Cargado</th><th className="pr-2">Nombre</th><th className="pr-2">WhatsApp</th><th className="pr-2">Negocio</th><th className="pr-2">Arranca</th><th className="pr-2">Plan</th><th className="pr-2">Califica</th><th>Vino de</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {lista.map((c) => {
              const tel = (c.telefono ?? "").replace(/\D/g, "");
              const rr = c.respuestas ?? {};
              return (
                <tr key={c.id} className="text-slate-300">
                  <td className="whitespace-nowrap py-2 pr-2 tabular-nums">{fecha(c.createdAt)}</td>
                  <td className="pr-2">{c.nombre || "—"}</td>
                  <td className="whitespace-nowrap pr-2">{tel ? <a href={`https://wa.me/${tel}`} target="_blank" rel="noopener noreferrer" className="text-wa-green hover:underline">+{tel}</a> : "—"}</td>
                  <td className="pr-2">{RUBRO[rr.rubro ?? ""] ?? "—"}{rr.que ? ` · ${rr.que}` : ""}</td>
                  <td className="pr-2">{CUANDO[rr.cuando ?? ""] ?? "—"}</td>
                  <td className="pr-2">{rr.que === "Plataforma" ? INV[rr.inv ?? ""] ?? "—" : "—"}</td>
                  <td className="pr-2">{c.califica ? <span className="font-semibold text-wa-green">Sí</span> : <span className="text-amber-300">No · {c.motivo || "—"}</span>}</td>
                  <td>{c.anuncio ? "Anuncio" : c.utm ? `Campaña ${c.utm}` : "Orgánico"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
