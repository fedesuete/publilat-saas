import { useEffect, useState, type FormEvent } from "react";
import { ExternalLink, Copy, Check, Star } from "lucide-react";
import { api, apiError } from "../../lib/api";
import { fmtDate } from "../../lib/format";
import { Button, Input, ErrorMsg } from "../../components/ui";

interface AdminLanding {
  id: string; name: string; slug: string; isPrimary: boolean; published: boolean;
  createdAt: string; email: string; ownerName: string | null; url: string;
}

function CopyBtn({ value }: { value: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      onClick={async () => { try { await navigator.clipboard.writeText(value); setOk(true); setTimeout(() => setOk(false), 1200); } catch { /* noop */ } }}
      className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
      title="Copiar URL"
    >
      {ok ? <Check className="h-4 w-4 text-wa-green" /> : <Copy className="h-4 w-4" />}
    </button>
  );
}

export default function AdminLandings() {
  const [landings, setLandings] = useState<AdminLanding[]>([]);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = async (search = q, st = status) => {
    setError(null);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set("q", search.trim());
      if (st) params.set("status", st);
      const { data } = await api.get<{ landings: AdminLanding[] }>(`/api/admin/landings?${params}`);
      setLandings(data.landings);
    } catch (e) { setError(apiError(e)); }
  };
  useEffect(() => { void load("", ""); /* eslint-disable-next-line */ }, []);

  const onSearch = (e: FormEvent) => { e.preventDefault(); void load(q, status); };
  const setFilter = (st: string) => { setStatus(st); void load(q, st); };

  return (
    <div className="p-6">
      <h1 className="mb-1 text-xl font-bold">Landings</h1>
      <p className="mb-4 text-sm text-slate-400">Todas las landings de los clientes con su URL, para verificar que funcionan sin entrar a cada panel.</p>
      {error && <div className="mb-3"><ErrorMsg>{error}</ErrorMsg></div>}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <form onSubmit={onSearch} className="flex flex-1 gap-2">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por cliente, nombre o slug…" />
          <Button type="submit" variant="secondary">Buscar</Button>
        </form>
        <div className="inline-flex rounded-md bg-slate-900 p-1 text-xs">
          {[["", "Todas"], ["published", "Publicadas"], ["draft", "Borrador"]].map(([v, l]) => (
            <button key={v} onClick={() => setFilter(v)} className={`rounded px-3 py-1 font-medium ${status === v ? "bg-wa-green text-slate-900" : "text-slate-300"}`}>{l}</button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-800">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-800/80 text-left text-slate-300">
            <tr>
              <th className="px-3 py-2">Cliente</th>
              <th className="px-3 py-2">Landing</th>
              <th className="px-3 py-2">URL</th>
              <th className="px-3 py-2">Estado</th>
              <th className="px-3 py-2">Creada</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {landings.map((l) => (
              <tr key={l.id} className="border-t border-slate-800">
                <td className="px-3 py-2"><div className="text-slate-200">{l.ownerName || l.email}</div><div className="text-xs text-slate-500">{l.email}</div></td>
                <td className="px-3 py-2">
                  <span className="inline-flex items-center gap-1 font-medium text-slate-100">
                    {l.isPrimary && <Star className="h-3.5 w-3.5 fill-current text-wa-green" />}{l.name}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1">
                    <a href={l.url} target="_blank" rel="noopener noreferrer" className="max-w-[280px] truncate font-mono text-xs text-sky-300 underline">{l.url}</a>
                    <CopyBtn value={l.url} />
                  </div>
                </td>
                <td className="px-3 py-2">
                  {l.published
                    ? <span className="rounded-full bg-emerald-700/40 px-2 py-0.5 text-xs font-semibold text-emerald-200">publicada</span>
                    : <span className="rounded-full bg-slate-600/40 px-2 py-0.5 text-xs font-semibold text-slate-300">borrador</span>}
                </td>
                <td className="px-3 py-2 text-xs text-slate-400">{fmtDate(l.createdAt)}</td>
                <td className="px-3 py-2">
                  <Button variant="secondary" onClick={() => window.open(l.url, "_blank")}><ExternalLink className="h-4 w-4" /> Ver</Button>
                </td>
              </tr>
            ))}
            {landings.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-500">Sin landings.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
