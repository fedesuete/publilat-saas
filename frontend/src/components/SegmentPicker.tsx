// Selector "tipo de cliente" arriba del chat del Inbox (2026-10-09).
// Marca a qué pixel van los eventos de ESTE contacto: al marcarlo, ese pixel recibe su Lead; al marcar
// "Compró", el Purchase va ahí. Sin marca = pixel principal. Los tipos son los pixeles con nombre de
// Mi Pixel; si la cuenta no tiene ninguno, el selector no se muestra (nadie ve algo que no puede usar).
import { useEffect, useState } from "react";
import { api, apiError } from "../lib/api";

type Segmento = { id: string; label: string; pixelId: string };

let cache: { at: number; list: Segmento[] } | null = null; // la lista cambia poco: 1 pedido por minuto

export default function SegmentPicker({ contactId }: { contactId: string }) {
  const [segmentos, setSegmentos] = useState<Segmento[]>(cache?.list ?? []);
  const [actual, setActual] = useState<string>("");
  const [estado, setEstado] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (cache && Date.now() - cache.at < 60_000) return;
    api.get<{ segments: Segmento[] }>("/api/segments")
      .then(({ data }) => { cache = { at: Date.now(), list: data.segments }; setSegmentos(data.segments); })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    setActual(""); setEstado(null);
    api.get<{ pixelRowId: string | null }>(`/api/segments/contact/${contactId}`)
      .then(({ data }) => setActual(data.pixelRowId ?? ""))
      .catch(() => undefined);
  }, [contactId]);

  if (!segmentos.length) return null;

  const cambiar = async (valor: string) => {
    const previo = actual;
    setActual(valor); setBusy(true); setEstado(null);
    try {
      const { data } = await api.put<{ eventos?: string[] }>(`/api/segments/contact/${contactId}`, { pixelRowId: valor || null });
      const ev = data.eventos ?? [];
      setEstado(valor ? (ev.length ? `✓ ${ev.join(" + ")} enviado a su pixel` : "✓ Marcado") : "✓ Vuelve al pixel principal");
    } catch (e) {
      setActual(previo);
      setEstado(apiError(e));
    } finally {
      setBusy(false);
      setTimeout(() => setEstado(null), 4000);
    }
  };

  return (
    <div className="flex shrink-0 flex-col items-end">
      <select
        value={actual}
        disabled={busy}
        onChange={(e) => void cambiar(e.target.value)}
        title="Tipo de cliente: define a qué pixel van sus eventos (Lead y compra)"
        className={`rounded-full border px-2.5 py-1 text-xs outline-none disabled:opacity-60 ${actual ? "border-violet-500/50 bg-violet-500/15 text-violet-200" : "border-slate-700 bg-slate-900 text-slate-400"}`}
      >
        <option value="">🏷️ Tipo de cliente…</option>
        {segmentos.map((s) => (
          <option key={s.id} value={s.id}>🏷️ {s.label}</option>
        ))}
      </select>
      {estado && <span className="mt-0.5 text-[10px] text-slate-400">{estado}</span>}
    </div>
  );
}
