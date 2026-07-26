import { useEffect, useState } from "react";
import { api, apiError } from "../../lib/api";
import { fmtDate } from "../../lib/format";
import { Button, ErrorMsg } from "../../components/ui";

interface AdminLine {
  id: string; label: string | null; phone: string; provider: string; status: string;
  connected: boolean; expiresAt: string | null; lastUsedAt: string | null; warmupEnabled: boolean;
  user: { email: string; name: string | null };
}

export default function AdminLines() {
  const [lines, setLines] = useState<AdminLine[]>([]);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async (f = filter) => {
    setError(null);
    try {
      const params = f ? `?status=${f}` : "";
      const { data } = await api.get<{ lines: AdminLine[] }>(`/api/admin/lines${params}`);
      setLines(data.lines);
    } catch (e) { setError(apiError(e)); }
  };
  useEffect(() => { void load(""); /* eslint-disable-next-line */ }, []);

  // Prende/apaga el calentamiento (rampa de envíos) de cualquier línea, desde el admin.
  const toggleWarmup = async (l: AdminLine) => {
    setBusyId(l.id); setError(null);
    try {
      const { data } = await api.post<{ ok: boolean; warmupEnabled: boolean }>(`/api/admin/lines/${l.id}/warmup`, { enabled: !l.warmupEnabled });
      setLines((prev) => prev.map((x) => (x.id === l.id ? { ...x, warmupEnabled: data.warmupEnabled } : x)));
    } catch (e) { setError(apiError(e)); } finally { setBusyId(null); }
  };

  return (
    <div className="p-4 md:p-6">
      <h1 className="mb-1 text-xl font-bold">Líneas (todas)</h1>
      <p className="mb-4 text-xs text-slate-500">🔥 <b>Calentamiento</b>: rampa anti-ban de líneas nuevas (cupo de envíos que sube con los días). Apagarlo = envíos sin límite (más riesgo de baneo si mandan mucho en frío).</p>
      {error && <div className="mb-3"><ErrorMsg>{error}</ErrorMsg></div>}
      <div className="mb-4 inline-flex rounded-md bg-slate-900 p-1 text-xs">
        {[["", "Todas"], ["connected", "Conectadas"], ["disconnected", "Desconectadas"]].map(([v, l]) => (
          <button key={v} onClick={() => { setFilter(v); void load(v); }} className={`rounded px-3 py-1 font-medium ${filter === v ? "bg-wa-green text-slate-900" : "text-slate-300"}`}>{l}</button>
        ))}
        <Button variant="ghost" onClick={() => void load()}>Actualizar</Button>
      </div>
      <div className="overflow-x-auto rounded-lg border border-slate-800">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-800/80 text-left text-slate-300">
            <tr>
              <th className="px-3 py-2">Dueño</th><th className="px-3 py-2">Etiqueta</th><th className="px-3 py-2">Número</th>
              <th className="px-3 py-2">Proveedor</th><th className="px-3 py-2">Conexión</th><th className="px-3 py-2">Calentamiento</th><th className="px-3 py-2">Vence</th><th className="px-3 py-2">Último uso</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id} className="border-t border-slate-800">
                <td className="px-3 py-2"><div className="text-slate-200">{l.user.name || l.user.email}</div><div className="text-xs text-slate-500">{l.user.email}</div></td>
                <td className="px-3 py-2">{l.label || "—"}</td>
                <td className="px-3 py-2 font-mono text-xs">{l.phone || "—"}</td>
                <td className="px-3 py-2">{l.provider === "cloud" ? <span className="text-wa-green">Cloud</span> : "Baileys"}</td>
                <td className="px-3 py-2"><span className={l.connected ? "text-wa-green" : "text-rose-400"}>● {l.connected ? "conectada" : "off"}</span></td>
                <td className="px-3 py-2">
                  {l.provider === "cloud" ? <span className="text-slate-600">—</span> : (
                    <button type="button" disabled={busyId === l.id} onClick={() => void toggleWarmup(l)}
                      className={`rounded-md px-2.5 py-1 text-xs font-medium disabled:opacity-50 ${l.warmupEnabled ? "bg-amber-500/15 text-amber-300 hover:bg-amber-500/25" : "bg-slate-700 text-slate-300 hover:bg-slate-600"}`}
                      title={l.warmupEnabled ? "Calentamiento ACTIVO (con cupo). Tocá para apagar → envíos sin límite." : "Calentamiento apagado (sin límite). Tocá para activar la protección."}>
                      {busyId === l.id ? "…" : l.warmupEnabled ? "🔥 On · apagar" : "Off · activar"}
                    </button>
                  )}
                </td>
                <td className="px-3 py-2 text-xs text-slate-400">{l.expiresAt ? fmtDate(l.expiresAt) : "—"}</td>
                <td className="px-3 py-2 text-xs text-slate-400">{l.lastUsedAt ? fmtDate(l.lastUsedAt) : "—"}</td>
              </tr>
            ))}
            {lines.length === 0 && <tr><td colSpan={8} className="px-3 py-6 text-center text-slate-500">Sin líneas.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
