import { useEffect, useState, type FormEvent } from "react";
import { api, apiError } from "../../lib/api";
import { Button, Input, Card, ErrorMsg } from "../../components/ui";

interface Demo {
  id: string; email: string; name: string | null; demoExpiresAt: string | null;
  connectedLines: number; leads: number; badge: string;
}

const BADGE: Record<string, string> = {
  "convirtió": "bg-wa-green/15 text-wa-green",
  "en demo": "bg-amber-500/15 text-amber-300",
  "demo vencida": "bg-slate-600/30 text-slate-400",
};

function remaining(iso: string | null): { txt: string; soon: boolean } {
  if (!iso) return { txt: "—", soon: false };
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return { txt: "vencida", soon: false };
  const h = Math.floor(ms / 3600000);
  if (h < 24) return { txt: `${h}h restantes`, soon: true };
  return { txt: `${Math.floor(h / 24)}d restantes`, soon: false };
}

export default function AdminDemos() {
  const [demos, setDemos] = useState<Demo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [days, setDays] = useState("5");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setError(null);
    try { const { data } = await api.get<{ demos: Demo[] }>("/api/admin/demos"); setDemos(data.demos); }
    catch (e) { setError(apiError(e)); }
  };
  useEffect(() => { void load(); }, []);

  // Dar demo a un usuario EXISTENTE (por email): lo busca en clientes y activa la demo.
  const giveDemo = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null); setMsg(null);
    try {
      const { data } = await api.get<{ clients: Array<{ id: string; email: string }> }>(`/api/admin/clients?q=${encodeURIComponent(email.trim())}`);
      const match = data.clients.find((c) => c.email.toLowerCase() === email.trim().toLowerCase()) ?? data.clients[0];
      if (!match) { setError("No encontré un cliente con ese email. Tiene que registrarse primero."); return; }
      const n = parseInt(days, 10) || 5;
      await api.post(`/api/admin/clients/${match.id}/demo`, { days: n });
      setMsg(`Demo de ${n} días activada para ${match.email}.`);
      setEmail("");
      await load();
    } catch (err) { setError(apiError(err)); } finally { setBusy(false); }
  };

  return (
    <div className="p-6">
      <h1 className="mb-4 text-xl font-bold">Demos</h1>
      {error && <div className="mb-3"><ErrorMsg>{error}</ErrorMsg></div>}

      <Card className="mb-5 max-w-xl">
        <div className="mb-2 text-sm font-semibold text-slate-200">Dar demo</div>
        <form onSubmit={giveDemo} className="flex flex-wrap gap-2">
          <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email del cliente (ya registrado)" className="flex-1" />
          <Input type="number" min={1} value={days} onChange={(e) => setDays(e.target.value)} className="w-20" />
          <Button type="submit" disabled={busy}>{busy ? "…" : "Activar demo"}</Button>
        </form>
        {msg && <p className="mt-2 text-xs text-wa-green">{msg}</p>}
        <p className="mt-2 text-xs text-slate-500">Activa N días gratis con vencimiento. Default 5.</p>
      </Card>

      <div className="overflow-x-auto rounded-lg border border-slate-800">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-800/80 text-left text-slate-300">
            <tr><th className="px-3 py-2">Cliente</th><th className="px-3 py-2">Restante</th><th className="px-3 py-2">Líneas</th><th className="px-3 py-2">Leads</th><th className="px-3 py-2">Estado</th></tr>
          </thead>
          <tbody>
            {demos.map((d) => {
              const r = remaining(d.demoExpiresAt);
              return (
                <tr key={d.id} className="border-t border-slate-800">
                  <td className="px-3 py-2"><div className="text-slate-200">{d.name || d.email}</div><div className="text-xs text-slate-500">{d.email}</div></td>
                  <td className={`px-3 py-2 ${r.soon ? "font-semibold text-amber-300" : "text-slate-400"}`}>{r.txt}{r.soon && " ⚠️"}</td>
                  <td className="px-3 py-2">{d.connectedLines}</td>
                  <td className="px-3 py-2">{d.leads}</td>
                  <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${BADGE[d.badge] ?? "bg-slate-600/30 text-slate-300"}`}>{d.badge}</span></td>
                </tr>
              );
            })}
            {demos.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-500">No hay demos.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
