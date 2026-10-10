// Selector "tipo de cliente" arriba del chat del Inbox (2026-10-09).
// Marca a qué pixel van los eventos de ESTE contacto: al marcarlo, ese pixel recibe su Lead; al marcar
// "Compró", el Purchase va ahí. Sin marca = pixel principal. Los tipos son los pixeles con nombre de
// Mi Pixel; si la cuenta no tiene ninguno, el selector no se muestra (nadie ve algo que no puede usar).
//
// 2026-10-10 (embudo B2B): además el PRODUCTO (Plataforma / A medida / Fichas / CRM), que viaja como
// content_category en su Lead, Schedule y Purchase. Con un solo tipo de pixel (caso Lucky Soft B2B) se
// elige directo el producto. Y "Demo agendada" manda el evento Schedule.
import { useEffect, useState } from "react";
import { api, apiError } from "../lib/api";

type Segmento = { id: string; label: string; pixelId: string };

// la lista cambia poco: 1 pedido por minuto
let cache: { at: number; list: Segmento[]; categorias: string[] } | null = null;

const chip = (on: boolean) =>
  `rounded-full border px-2.5 py-1 text-xs outline-none disabled:opacity-60 ${on ? "border-violet-500/50 bg-violet-500/15 text-violet-200" : "border-slate-700 bg-slate-900 text-slate-400"}`;

export default function SegmentPicker({ contactId }: { contactId: string }) {
  const [segmentos, setSegmentos] = useState<Segmento[]>(cache?.list ?? []);
  const [categorias, setCategorias] = useState<string[]>(cache?.categorias ?? []);
  const [actual, setActual] = useState<string>("");
  const [categoria, setCategoria] = useState<string>("");
  const [demo, setDemo] = useState(false);
  const [estado, setEstado] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (cache && Date.now() - cache.at < 60_000) return;
    api.get<{ segments: Segmento[]; categorias?: string[] }>("/api/segments")
      .then(({ data }) => {
        cache = { at: Date.now(), list: data.segments, categorias: data.categorias ?? [] };
        setSegmentos(data.segments); setCategorias(data.categorias ?? []);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    setActual(""); setCategoria(""); setDemo(false); setEstado(null);
    api.get<{ pixelRowId: string | null; categoria?: string | null; demo?: boolean }>(`/api/segments/contact/${contactId}`)
      .then(({ data }) => { setActual(data.pixelRowId ?? ""); setCategoria(data.categoria ?? ""); setDemo(!!data.demo); })
      .catch(() => undefined);
  }, [contactId]);

  if (!segmentos.length) return null;

  const avisar = (msg: string) => { setEstado(msg); setTimeout(() => setEstado(null), 4000); };

  // Guarda tipo (pixel) + producto. Un solo tipo en la cuenta: elegir producto ya marca ese tipo.
  const guardar = async (pixelRowId: string, cat: string) => {
    const previo = { actual, categoria };
    setActual(pixelRowId); setCategoria(pixelRowId ? cat : ""); setBusy(true); setEstado(null);
    try {
      const { data } = await api.put<{ eventos?: string[] }>(`/api/segments/contact/${contactId}`, {
        pixelRowId: pixelRowId || null,
        ...(pixelRowId ? { categoria: cat || null } : {}),
      });
      const ev = data.eventos ?? [];
      avisar(pixelRowId ? (ev.length ? `✓ ${ev.join(" + ")} enviado a su pixel` : "✓ Marcado") : "✓ Vuelve al pixel principal");
    } catch (e) {
      setActual(previo.actual); setCategoria(previo.categoria);
      avisar(apiError(e));
    } finally {
      setBusy(false);
    }
  };

  const agendar = async () => {
    if (demo) return;
    if (!window.confirm("¿Marcar que este cliente agendó una demo? Se manda el evento a Meta (una sola vez).")) return;
    setBusy(true);
    try {
      await api.post(`/api/segments/contact/${contactId}/schedule`);
      setDemo(true);
      avisar("✓ Demo agendada enviada a su pixel");
    } catch (e) {
      avisar(apiError(e));
    } finally {
      setBusy(false);
    }
  };

  const unSoloTipo = segmentos.length === 1;

  return (
    <div className="flex shrink-0 flex-col items-end">
      <div className="flex flex-wrap items-center justify-end gap-1">
        {unSoloTipo ? (
          // Un solo pixel con tipo: el selector es directamente el producto.
          <select
            value={actual ? categoria || "-" : ""}
            disabled={busy}
            onChange={(e) => {
              const v = e.target.value;
              void guardar(v ? segmentos[0].id : "", v === "-" ? "" : v);
            }}
            title={`Producto que le interesa: su Lead, demo y compra van al pixel ${segmentos[0].label} con esa categoría`}
            className={chip(!!actual)}
          >
            <option value="">🏷️ Producto…</option>
            {categorias.map((c) => <option key={c} value={c}>🏷️ {c}</option>)}
            <option value="-">🏷️ {segmentos[0].label} (sin producto)</option>
          </select>
        ) : (
          <>
            <select
              value={actual}
              disabled={busy}
              onChange={(e) => void guardar(e.target.value, categoria)}
              title="Tipo de cliente: define a qué pixel van sus eventos (Lead y compra)"
              className={chip(!!actual)}
            >
              <option value="">🏷️ Tipo de cliente…</option>
              {segmentos.map((s) => <option key={s.id} value={s.id}>🏷️ {s.label}</option>)}
            </select>
            {actual && categorias.length > 0 && (
              <select
                value={categoria}
                disabled={busy}
                onChange={(e) => void guardar(actual, e.target.value)}
                title="Producto que le interesa (va como categoría en sus eventos)"
                className={chip(!!categoria)}
              >
                <option value="">Producto…</option>
                {categorias.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            )}
          </>
        )}
        <button
          type="button"
          disabled={busy || demo}
          onClick={() => void agendar()}
          title="El cliente agendó una demo: manda el evento Schedule a Meta"
          className={chip(demo)}
        >
          {demo ? "📅 Demo agendada ✓" : "📅 Demo agendada"}
        </button>
      </div>
      {estado && <span className="mt-0.5 text-[10px] text-slate-400">{estado}</span>}
    </div>
  );
}
