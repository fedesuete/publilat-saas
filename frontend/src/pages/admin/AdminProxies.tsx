import { useEffect, useState } from "react";
import { api, apiError } from "../../lib/api";
import { fmtDate } from "../../lib/format";
import { getSocket } from "../../lib/socket";
import { Button, Input, ErrorMsg } from "../../components/ui";

interface Proxy {
  id: string; label: string; provider: string; host: string; port: number; username: string;
  protocol: string; country: string | null; sticky: boolean; sessTime: number; maxLines: number;
  active: boolean; healthy: boolean; lastCheckAt: string | null; createdAt: string; lineCount: number;
}
interface ProxyLine {
  id: string; phone: string; label: string | null; status: string; connected: boolean; banned: boolean;
  proxyId: string | null; proxySession: string | null; lastProxyRotateAt: string | null;
  user: { slug: string; email: string };
  proxy: { id: string; label: string; host: string; port: number; country: string | null; healthy: boolean } | null;
}
interface ProxyEvent { id: string; lineId: string; proxyId: string | null; type: string; detail: string | null; createdAt: string; }

const EMPTY_FORM = { label: "", provider: "dataimpulse", host: "gw.dataimpulse.com", port: "823", username: "", password: "", protocol: "http", country: "ar", sessTime: "120", maxLines: "4" };

const EVENT_LABEL: Record<string, string> = {
  assigned: "Asignado", rotated: "IP rotada", line_down: "Caída", reconnected: "Reconectada",
  banned: "Baneada", proxy_unhealthy: "Proxy caído",
};

export default function AdminProxies() {
  const [proxies, setProxies] = useState<Proxy[]>([]);
  const [lines, setLines] = useState<ProxyLine[]>([]);
  const [events, setEvents] = useState<ProxyEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [alert, setAlert] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [creating, setCreating] = useState(false);

  const load = async () => {
    setError(null);
    try {
      const [p, l, e] = await Promise.all([
        api.get<{ proxies: Proxy[] }>("/api/admin/proxies"),
        api.get<{ lines: ProxyLine[] }>("/api/admin/proxies/lines"),
        api.get<{ events: ProxyEvent[] }>("/api/admin/proxies/events"),
      ]);
      setProxies(p.data.proxies); setLines(l.data.lines); setEvents(e.data.events);
    } catch (e) { setError(apiError(e)); }
  };
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, []);

  // Alertas en vivo (línea caída/baneada, proxy caído, pool lleno).
  useEffect(() => {
    const s = getSocket();
    const onProxy = (p: { kind?: string }) => {
      const msg = p?.kind === "banned" ? "⚠️ Una línea quedó BANEADA (se liberó su proxy)."
        : p?.kind === "proxy_unhealthy" ? "⚠️ Un proxy se cayó (sus líneas se rotaron)."
        : p?.kind === "pool_full" ? "⚠️ El pool de proxies está lleno (sin cupo)." : "Evento de proxy.";
      setAlert(msg);
      void load();
    };
    s.on("admin:proxy", onProxy);
    return () => { s.off("admin:proxy", onProxy); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const createProxy = async () => {
    setCreating(true); setError(null);
    try {
      await api.post("/api/admin/proxies", {
        label: form.label.trim(), provider: form.provider.trim() || "dataimpulse",
        host: form.host.trim(), port: parseInt(form.port, 10), username: form.username.trim(),
        password: form.password, protocol: form.protocol, country: form.country.trim() || undefined,
        sessTime: parseInt(form.sessTime, 10) || 120, maxLines: parseInt(form.maxLines, 10) || 4,
      });
      setForm({ ...EMPTY_FORM });
      await load();
    } catch (e) { setError(apiError(e)); } finally { setCreating(false); }
  };

  const patchProxy = async (id: string, data: Record<string, unknown>) => {
    setBusy(id); setError(null);
    try { await api.patch(`/api/admin/proxies/${id}`, data); await load(); }
    catch (e) { setError(apiError(e)); } finally { setBusy(null); }
  };
  const delProxy = async (id: string) => {
    if (!confirm("¿Borrar este proxy? Las líneas asignadas quedan sin proxy.")) return;
    setBusy(id); setError(null);
    try { await api.delete(`/api/admin/proxies/${id}`); await load(); }
    catch (e) { setError(apiError(e)); } finally { setBusy(null); }
  };

  const lineAction = async (id: string, action: "rotate" | "retry", body?: Record<string, unknown>) => {
    setBusy(id); setError(null);
    try { await api.post(`/api/admin/lines/${id}/${action}`, body ?? {}); await load(); }
    catch (e) { setError(apiError(e)); } finally { setBusy(null); }
  };
  const assignProxy = async (id: string, proxyId: string) => {
    setBusy(id); setError(null);
    try { await api.post(`/api/admin/lines/${id}/proxy`, proxyId ? { proxyId } : {}); await load(); }
    catch (e) { setError(apiError(e)); } finally { setBusy(null); }
  };

  const healthy = proxies.filter((p) => p.active && p.healthy).length;
  const down = proxies.filter((p) => p.active && !p.healthy).length;
  const banned = lines.filter((l) => l.banned).length;

  return (
    <div className="p-4 md:p-6">
      <h1 className="mb-1 text-xl font-bold">Proxies (anti-ban)</h1>
      <p className="mb-4 text-xs text-slate-500">
        Pool de proxies para las líneas Baileys. Solo visible acá — el cliente nunca ve el proxy. Cada
        línea sale por su IP sticky; si se cae, el sistema rota la IP solo y avisa acá.
      </p>
      {error && <div className="mb-3"><ErrorMsg>{error}</ErrorMsg></div>}
      {alert && (
        <div className="mb-3 flex items-center justify-between rounded-md border border-amber-800 bg-amber-900/30 px-3 py-2 text-sm text-amber-200">
          <span>{alert}</span>
          <button className="text-amber-400" onClick={() => setAlert(null)}>✕</button>
        </div>
      )}

      {/* Salud del pool */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg bg-slate-900 p-3"><div className="text-2xl font-bold text-wa-green">{healthy}</div><div className="text-xs text-slate-400">proxies sanos</div></div>
        <div className="rounded-lg bg-slate-900 p-3"><div className="text-2xl font-bold text-rose-400">{down}</div><div className="text-xs text-slate-400">proxies caídos</div></div>
        <div className="rounded-lg bg-slate-900 p-3"><div className="text-2xl font-bold">{lines.filter((l) => l.proxyId).length}</div><div className="text-xs text-slate-400">líneas con proxy</div></div>
        <div className="rounded-lg bg-slate-900 p-3"><div className="text-2xl font-bold text-amber-400">{banned}</div><div className="text-xs text-slate-400">líneas baneadas</div></div>
      </div>

      {/* Alta de proxy */}
      <div className="mb-6 rounded-lg border border-slate-800 bg-slate-900/40 p-4">
        <div className="mb-2 text-sm font-semibold">Agregar proxy al pool</div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Input placeholder="Etiqueta" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
          <Input placeholder="Host" value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} />
          <Input placeholder="Puerto" value={form.port} onChange={(e) => setForm({ ...form, port: e.target.value })} />
          <select className="rounded-md border border-slate-700 bg-slate-900 px-2 text-sm" value={form.protocol} onChange={(e) => setForm({ ...form, protocol: e.target.value })}>
            <option value="http">http</option><option value="socks5">socks5</option>
          </select>
          <Input placeholder="Usuario" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
          <Input placeholder="Contraseña" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          <Input placeholder="País (ar)" value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} />
          <Input placeholder="Máx. líneas" value={form.maxLines} onChange={(e) => setForm({ ...form, maxLines: e.target.value })} />
        </div>
        <div className="mt-2 flex items-center gap-2">
          <Input placeholder="Proveedor" className="max-w-[160px]" value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })} />
          <Input placeholder="Sesión (min)" className="max-w-[120px]" value={form.sessTime} onChange={(e) => setForm({ ...form, sessTime: e.target.value })} />
          <Button disabled={creating || !form.label.trim() || !form.host.trim() || !form.username.trim() || !form.password} onClick={() => void createProxy()}>
            {creating ? "…" : "Agregar"}
          </Button>
        </div>
      </div>

      {/* Pool */}
      <div className="mb-6">
        <div className="mb-2 text-sm font-semibold text-slate-200">Pool ({proxies.length})</div>
        <div className="overflow-x-auto rounded-lg border border-slate-800">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-slate-800 text-left text-xs uppercase text-slate-500">
              <th className="px-3 py-2">Proxy</th><th className="px-3 py-2">Host</th><th className="px-3 py-2">País</th>
              <th className="px-3 py-2">Líneas</th><th className="px-3 py-2">Estado</th><th className="px-3 py-2"></th>
            </tr></thead>
            <tbody>
              {proxies.map((p) => (
                <tr key={p.id} className="border-b border-slate-800/60 last:border-0">
                  <td className="px-3 py-2"><div className="font-medium">{p.label}</div><div className="text-[11px] text-slate-500">{p.provider} · {p.protocol}</div></td>
                  <td className="px-3 py-2 text-slate-400">{p.host}:{p.port}</td>
                  <td className="px-3 py-2 uppercase text-slate-400">{p.country ?? "—"}</td>
                  <td className="px-3 py-2">{p.lineCount}/{p.maxLines}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] ${!p.active ? "bg-slate-700 text-slate-300" : p.healthy ? "bg-wa-green/15 text-wa-green" : "bg-rose-900/40 text-rose-300"}`}>
                      {!p.active ? "inactivo" : p.healthy ? "sano" : "caído"}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button disabled={busy === p.id} className="mr-3 text-xs text-slate-300 hover:text-white" onClick={() => void patchProxy(p.id, { active: !p.active })}>{p.active ? "Pausar" : "Activar"}</button>
                    <button disabled={busy === p.id} className="text-xs text-rose-400 hover:text-rose-300" onClick={() => void delProxy(p.id)}>Borrar</button>
                  </td>
                </tr>
              ))}
              {proxies.length === 0 && <tr><td colSpan={6} className="px-3 py-4 text-center text-slate-500">Todavía no hay proxies en el pool.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* Líneas */}
      <div className="mb-6">
        <div className="mb-2 text-sm font-semibold text-slate-200">Líneas ({lines.length})</div>
        <div className="overflow-x-auto rounded-lg border border-slate-800">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-slate-800 text-left text-xs uppercase text-slate-500">
              <th className="px-3 py-2">Línea / cliente</th><th className="px-3 py-2">Estado</th><th className="px-3 py-2">Proxy</th><th className="px-3 py-2">Acciones</th>
            </tr></thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id} className="border-b border-slate-800/60 last:border-0">
                  <td className="px-3 py-2"><div className="font-medium">{l.label ?? l.phone}</div><div className="text-[11px] text-slate-500">{l.user.slug} · {l.phone}</div></td>
                  <td className="px-3 py-2">
                    {l.banned ? <span className="rounded-full bg-rose-900/40 px-2 py-0.5 text-[11px] text-rose-300">baneada</span>
                      : l.connected ? <span className="rounded-full bg-wa-green/15 px-2 py-0.5 text-[11px] text-wa-green">conectada</span>
                      : <span className="rounded-full bg-slate-700 px-2 py-0.5 text-[11px] text-slate-300">caída</span>}
                  </td>
                  <td className="px-3 py-2">
                    <select className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs" value={l.proxyId ?? ""} disabled={busy === l.id} onChange={(e) => void assignProxy(l.id, e.target.value)}>
                      <option value="">— auto (least-loaded) —</option>
                      {proxies.filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.label} ({p.country ?? "?"})</option>)}
                    </select>
                    {l.proxy && <div className="mt-0.5 text-[11px] text-slate-500">{l.proxy.host}:{l.proxy.port} · sess {l.proxySession?.slice(0, 6) ?? "—"}</div>}
                  </td>
                  <td className="px-3 py-2">
                    <button disabled={busy === l.id || !l.proxyId} className="mr-3 text-xs text-slate-300 hover:text-white disabled:opacity-40" onClick={() => void lineAction(l.id, "rotate")}>Rotar IP</button>
                    <button disabled={busy === l.id} className="text-xs text-wa-green hover:text-emerald-300" onClick={() => void lineAction(l.id, "retry")}>Reintentar</button>
                  </td>
                </tr>
              ))}
              {lines.length === 0 && <tr><td colSpan={4} className="px-3 py-4 text-center text-slate-500">No hay líneas Baileys.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* Auditoría */}
      <div>
        <div className="mb-2 text-sm font-semibold text-slate-200">Últimos eventos</div>
        <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-800 text-xs">
          {events.map((ev) => (
            <div key={ev.id} className="flex items-center gap-3 border-b border-slate-800/50 px-3 py-1.5 last:border-0">
              <span className="w-28 shrink-0 text-slate-500">{fmtDate(ev.createdAt)}</span>
              <span className={`w-24 shrink-0 font-medium ${ev.type === "banned" ? "text-rose-400" : ev.type === "reconnected" ? "text-wa-green" : ev.type === "proxy_unhealthy" ? "text-amber-400" : "text-slate-300"}`}>{EVENT_LABEL[ev.type] ?? ev.type}</span>
              <span className="truncate text-slate-500">{ev.detail ?? ""}</span>
            </div>
          ))}
          {events.length === 0 && <div className="px-3 py-4 text-center text-slate-500">Sin eventos todavía.</div>}
        </div>
      </div>
    </div>
  );
}
