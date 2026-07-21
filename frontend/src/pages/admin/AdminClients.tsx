import { useEffect, useState, type FormEvent } from "react";
import { api, apiError } from "../../lib/api";
import { fmtDate } from "../../lib/format";
import { Button, Input, Card, ErrorMsg } from "../../components/ui";

interface Client {
  id: string; email: string; name: string | null; status: string; days: number;
  lines: { connected: number; total: number }; leads: number; compras: number;
  facturacion: number; lastLoginAt: string | null; createdAt: string; demoExpiresAt: string | null;
}
interface Detail {
  user: { id: string; email: string; name: string | null; phone: string | null; slug: string; suspended: boolean; isDemo: boolean; demoExpiresAt: string | null; createdAt: string; maxLines: number; maxLandings: number };
  days: number;
  lines: Array<{ id: string; label: string | null; phone: string; provider: string; status: string; connected: boolean; expiresAt: string | null }>;
  payments: Array<{ id: string; provider: string; days: number; amount: number; currency: string; status: string; createdAt: string }>;
  leads: number; compras: number; facturacion: number;
}

const STATUS_COLOR: Record<string, string> = {
  activo: "text-wa-green", demo: "text-amber-300", demo_vencida: "text-orange-400",
  suspendido: "text-rose-400", inactivo: "text-slate-500",
};

export default function AdminClients() {
  const [clients, setClients] = useState<Client[]>([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState<Detail | null>(null);
  const [busy, setBusy] = useState(false);
  const [lim, setLim] = useState({ lines: 1, landings: 50 });
  // Alta manual de cliente desde el panel.
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const emptyForm = { email: "", password: "", name: "", phone: "", days: "0", maxLines: "1" };
  const [form, setForm] = useState(emptyForm);
  // Credenciales del último cliente creado (para copiar y mandarle por WhatsApp).
  const [createdCreds, setCreatedCreds] = useState<{ email: string; password: string; days: number; name: string } | null>(null);
  const [copied, setCopied] = useState(false);
  // Credenciales del cliente seleccionado tras cambiar/generar su contraseña (para copiar y enviar).
  const [detailCreds, setDetailCreds] = useState<{ email: string; password: string; name: string } | null>(null);
  const [detailCopied, setDetailCopied] = useState(false);

  const panelUrl = window.location.origin;
  const credsMessage = (c: { email: string; password: string; days: number; name: string }) =>
    [
      `¡Bienvenido/a a Publi.lat! 🎉`,
      ``,
      `Estas son tus credenciales de acceso:`,
      `🔗 Ingresá en: ${panelUrl}`,
      `👤 Usuario: ${c.email}`,
      `🔑 Contraseña: ${c.password}`,
      ...(c.days > 0 ? [``, `🎁 Te regalamos ${c.days} día${c.days === 1 ? "" : "s"} de prueba para que arranques.`] : []),
      ``,
      `Cualquier duda, escribinos. ¡Éxitos! 🚀`,
    ].join("\n");

  const copyCreds = async () => {
    if (!createdCreds) return;
    try {
      await navigator.clipboard.writeText(credsMessage(createdCreds));
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch { /* si el navegador bloquea el clipboard, el texto igual se ve para copiar a mano */ }
  };

  const load = async (p = page, search = q, st = status) => {
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(p) });
      if (search.trim()) params.set("q", search.trim());
      if (st) params.set("status", st);
      const { data } = await api.get<{ clients: Client[]; pages: number; page: number }>(`/api/admin/clients?${params}`);
      setClients(data.clients); setPages(data.pages); setPage(data.page);
    } catch (e) { setError(apiError(e)); }
  };

  useEffect(() => { void load(1, "", ""); /* eslint-disable-next-line */ }, []);

  const openDetail = async (id: string) => {
    setError(null);
    setDetailCreds(null); setDetailCopied(false); // no arrastrar credenciales del cliente anterior
    try { const { data } = await api.get<Detail>(`/api/admin/clients/${id}`); setSel(data); setLim({ lines: data.user.maxLines, landings: data.user.maxLandings }); }
    catch (e) { setError(apiError(e)); }
  };

  // Resetea (o fija) la contraseña del cliente y la deja disponible para copiar. La actual deja de
  // funcionar; el hash no se puede leer, por eso "copiar credenciales" implica generar una nueva.
  const resetPassword = async (id: string): Promise<{ email: string; password: string; name: string } | null> => {
    try {
      const { data } = await api.post<{ email: string; password: string; name: string | null }>(`/api/admin/clients/${id}/password`, {});
      const creds = { email: data.email, password: data.password, name: data.name ?? "" };
      setDetailCreds(creds); setDetailCopied(false);
      return creds;
    } catch (e) { setError(apiError(e)); return null; }
  };

  const changePassword = async (id: string) => {
    if (!window.confirm("¿Cambiar la contraseña de este cliente? La contraseña actual dejará de funcionar.")) return;
    setBusy(true); await resetPassword(id); setBusy(false);
  };

  const copyDetailCreds = async (id: string) => {
    let creds = detailCreds;
    if (!creds) {
      if (!window.confirm("Para copiar las credenciales hay que generar una contraseña nueva (la actual no se puede leer). ¿Continuar?")) return;
      setBusy(true); creds = await resetPassword(id); setBusy(false);
    }
    if (!creds) return;
    try {
      await navigator.clipboard.writeText(credsMessage({ email: creds.email, password: creds.password, days: 0, name: creds.name }));
      setDetailCopied(true); setTimeout(() => setDetailCopied(false), 2500);
    } catch { /* si el navegador bloquea el clipboard, el texto igual se ve para copiar a mano */ }
  };

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await fn(); if (sel) await openDetail(sel.user.id); await load(); }
    catch (e) { setError(apiError(e)); } finally { setBusy(false); }
  };

  const addDays = (id: string, days: number) => act(() => api.post(`/api/admin/clients/${id}/credits`, { days }));
  const giveDemo = (id: string) => act(() => api.post(`/api/admin/clients/${id}/demo`, {}));
  const toggleSuspend = (id: string, suspended: boolean) => act(() => api.post(`/api/admin/clients/${id}/suspend`, { suspended }));
  const saveLimits = (id: string, maxLines: number, maxLandings: number) => act(() => api.post(`/api/admin/clients/${id}/limits`, { maxLines, maxLandings }));

  const onSearch = (e: FormEvent) => { e.preventDefault(); void load(1, q, status); };
  const setFilter = (st: string) => { setStatus(st); void load(1, q, st); };

  const createClient = async (e: FormEvent) => {
    e.preventDefault();
    setCreating(true); setError(null); setCreatedCreds(null); setCopied(false);
    try {
      const payload = {
        email: form.email.trim(),
        password: form.password,
        name: form.name.trim() || undefined,
        phone: form.phone.trim() || undefined,
        days: Number(form.days) || 0,
        maxLines: Number(form.maxLines) || 1,
      };
      const { data } = await api.post<{ client: { email: string; slug: string } }>("/api/admin/clients", payload);
      // Guardamos las credenciales (la contraseña la escribió el admin) para el botón copiar.
      setCreatedCreds({ email: data.client.email, password: form.password, days: Number(form.days) || 0, name: form.name.trim() });
      setForm(emptyForm);
      await load(1, "", "");
    } catch (err) { setError(apiError(err)); }
    finally { setCreating(false); }
  };

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold">Clientes</h1>
        <Button onClick={() => { setShowCreate((v) => !v); setCreatedCreds(null); }}>
          {showCreate ? "Cerrar" : "+ Crear cliente"}
        </Button>
      </div>
      {error && <div className="mb-3"><ErrorMsg>{error}</ErrorMsg></div>}

      {createdCreds && (
        <Card className="mb-5 max-w-2xl border-wa-green/40">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-sm font-semibold text-wa-green">✅ Cliente creado — pasale estas credenciales</div>
            <button onClick={() => setCreatedCreds(null)} className="text-xs text-slate-500 hover:text-slate-300">Cerrar</button>
          </div>
          <pre className="mb-3 whitespace-pre-wrap rounded-md bg-slate-900 p-3 text-sm text-slate-200">{credsMessage(createdCreds)}</pre>
          <Button onClick={() => void copyCreds()}>{copied ? "¡Copiado! ✓" : "📋 Copiar credenciales"}</Button>
          <span className="ml-3 text-xs text-slate-500">Copialo y mandáselo al cliente por WhatsApp.</span>
        </Card>
      )}

      {showCreate && (
        <Card className="mb-5 max-w-2xl">
          <div className="mb-3 text-sm font-semibold text-slate-100">Alta manual de cliente</div>
          <form onSubmit={createClient} className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-slate-400">Email *
              <Input type="email" required value={form.email} onChange={(e) => setForm((s) => ({ ...s, email: e.target.value }))} placeholder="cliente@correo.com" className="mt-1" />
            </label>
            <label className="text-xs text-slate-400">Contraseña *
              <Input type="text" required minLength={6} value={form.password} onChange={(e) => setForm((s) => ({ ...s, password: e.target.value }))} placeholder="mínimo 6 caracteres" className="mt-1" />
            </label>
            <label className="text-xs text-slate-400">Nombre / negocio
              <Input value={form.name} onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))} placeholder="Ej: Tienda de Ana" className="mt-1" />
            </label>
            <label className="text-xs text-slate-400">WhatsApp (opcional)
              <Input value={form.phone} onChange={(e) => setForm((s) => ({ ...s, phone: e.target.value }))} placeholder="595971234567" className="mt-1" />
            </label>
            <label className="text-xs text-slate-400">Días de regalo al crear
              <Input type="number" min={0} value={form.days} onChange={(e) => setForm((s) => ({ ...s, days: e.target.value }))} className="mt-1" />
            </label>
            <label className="text-xs text-slate-400">Líneas permitidas
              <Input type="number" min={0} value={form.maxLines} onChange={(e) => setForm((s) => ({ ...s, maxLines: e.target.value }))} className="mt-1" />
            </label>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={creating}>{creating ? "Creando…" : "Crear cliente"}</Button>
              <span className="ml-3 text-xs text-slate-500">El cliente entra con este email y contraseña. Podés pasarle esos datos.</span>
            </div>
          </form>
        </Card>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <form onSubmit={onSearch} className="flex flex-1 gap-2">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por email o negocio…" />
          <Button type="submit" variant="secondary">Buscar</Button>
        </form>
        <div className="inline-flex rounded-md bg-slate-900 p-1 text-xs">
          {[["", "Todos"], ["demo", "En demo"], ["suspended", "Suspendidos"]].map(([v, l]) => (
            <button key={v} onClick={() => setFilter(v)} className={`rounded px-3 py-1 font-medium ${status === v ? "bg-wa-green text-slate-900" : "text-slate-300"}`}>{l}</button>
          ))}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <div className="overflow-x-auto rounded-lg border border-slate-800">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-800/80 text-left text-slate-300">
              <tr>
                <th className="px-3 py-2">Cliente</th><th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2">Días</th><th className="px-3 py-2">Líneas</th>
                <th className="px-3 py-2">Leads</th><th className="px-3 py-2">Compras</th><th className="px-3 py-2">Facturación</th>
              </tr>
            </thead>
            <tbody>
              {clients.map((c) => (
                <tr key={c.id} onClick={() => void openDetail(c.id)} className="cursor-pointer border-t border-slate-800 hover:bg-slate-800/40">
                  <td className="px-3 py-2"><div className="font-medium text-slate-100">{c.name || c.email}</div><div className="text-xs text-slate-500">{c.email}</div></td>
                  <td className={`px-3 py-2 font-semibold ${STATUS_COLOR[c.status] ?? "text-slate-300"}`}>{c.status}</td>
                  <td className="px-3 py-2">{c.days}</td>
                  <td className="px-3 py-2">{c.lines.connected}/{c.lines.total}</td>
                  <td className="px-3 py-2">{c.leads}</td>
                  <td className="px-3 py-2">{c.compras}</td>
                  <td className="px-3 py-2 text-wa-green">{c.facturacion.toLocaleString("es-AR")}</td>
                </tr>
              ))}
              {clients.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-500">Sin clientes.</td></tr>}
            </tbody>
          </table>
          {pages > 1 && (
            <div className="flex items-center justify-between border-t border-slate-800 px-3 py-2 text-sm">
              <Button variant="ghost" disabled={page <= 1} onClick={() => void load(page - 1)}>Anterior</Button>
              <span className="text-slate-400">Página {page} de {pages}</span>
              <Button variant="ghost" disabled={page >= pages} onClick={() => void load(page + 1)}>Siguiente</Button>
            </div>
          )}
        </div>

        {/* Detalle */}
        <Card className="h-fit">
          {!sel ? (
            <p className="text-sm text-slate-500">Tocá un cliente para ver el detalle y las acciones.</p>
          ) : (
            <div>
              <div className="font-semibold text-slate-100">{sel.user.name || sel.user.email}</div>
              <div className="text-xs text-slate-500">{sel.user.email} · /{sel.user.slug}</div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                <div className="rounded bg-slate-900 p-2"><div className="text-lg font-bold text-wa-green">{sel.days}</div>días</div>
                <div className="rounded bg-slate-900 p-2"><div className="text-lg font-bold text-slate-100">{sel.leads}</div>leads</div>
                <div className="rounded bg-slate-900 p-2"><div className="text-lg font-bold text-slate-100">{sel.compras}</div>compras</div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <Button disabled={busy} onClick={() => addDays(sel.user.id, 1)}>+1 día</Button>
                <Button variant="secondary" disabled={busy} onClick={() => addDays(sel.user.id, 7)}>+7</Button>
                <Button variant="secondary" disabled={busy} onClick={() => addDays(sel.user.id, 30)}>+30 (mes)</Button>
                <Button variant="ghost" disabled={busy} onClick={() => addDays(sel.user.id, -1)}>-1</Button>
                <Button variant="secondary" disabled={busy} onClick={() => giveDemo(sel.user.id)}>Demo 5d</Button>
                <Button variant={sel.user.suspended ? "secondary" : "danger"} disabled={busy} onClick={() => toggleSuspend(sel.user.id, !sel.user.suspended)}>
                  {sel.user.suspended ? "Reactivar" : "Suspender"}
                </Button>
              </div>

              {/* Credenciales: cambiar contraseña + copiar para mandarle al cliente (como la demo). */}
              <div className="mt-2 flex flex-wrap gap-2">
                <Button variant="secondary" disabled={busy} onClick={() => void changePassword(sel.user.id)}>🔑 Cambiar contraseña</Button>
                <Button
                  variant="secondary"
                  disabled={busy}
                  title="Genera credenciales y las copia para mandárselas al cliente"
                  onClick={() => void copyDetailCreds(sel.user.id)}
                >
                  {detailCopied ? "¡Copiado! ✓" : "📋 Copiar credenciales"}
                </Button>
              </div>
              {detailCreds && (
                <div className="mt-2 rounded-md border border-wa-green/40 bg-slate-900/60 p-3">
                  <div className="mb-1 text-xs font-semibold text-wa-green">🔑 Nueva contraseña — pasásela al cliente</div>
                  <pre className="whitespace-pre-wrap rounded bg-slate-900 p-2 text-xs text-slate-200">{credsMessage({ email: detailCreds.email, password: detailCreds.password, days: 0, name: detailCreds.name })}</pre>
                  <div className="mt-1 text-[11px] text-amber-300">⚠️ La contraseña anterior dejó de funcionar.</div>
                </div>
              )}

              <div className="mt-4 rounded bg-slate-900/60 p-3">
                <div className="mb-2 text-xs font-semibold uppercase text-slate-400">Límites del plan</div>
                <div className="flex items-end gap-2">
                  <label className="flex-1 text-xs text-slate-400">Líneas
                    <Input type="number" min={0} value={lim.lines} onChange={(e) => setLim((s) => ({ ...s, lines: Number(e.target.value) }))} className="mt-1" />
                  </label>
                  <label className="flex-1 text-xs text-slate-400">Landings
                    <Input type="number" min={0} value={lim.landings} onChange={(e) => setLim((s) => ({ ...s, landings: Number(e.target.value) }))} className="mt-1" />
                  </label>
                  <Button disabled={busy} onClick={() => saveLimits(sel.user.id, lim.lines, lim.landings)}>Guardar</Button>
                </div>
              </div>

              <div className="mt-4">
                <div className="mb-1 text-xs font-semibold uppercase text-slate-400">Líneas</div>
                {sel.lines.length === 0 ? <p className="text-xs text-slate-500">Sin líneas.</p> : (
                  <div className="space-y-1">
                    {sel.lines.map((l) => (
                      <div key={l.id} className="flex items-center justify-between rounded bg-slate-900/60 px-2 py-1.5 text-xs">
                        <span className="truncate text-slate-200">{l.label || l.phone || "—"} <span className="text-slate-500">· {l.provider}</span></span>
                        <span className={l.connected ? "text-wa-green" : "text-slate-500"}>{l.connected ? "conectada" : "off"}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="mt-3">
                <div className="mb-1 text-xs font-semibold uppercase text-slate-400">Pagos</div>
                {sel.payments.length === 0 ? <p className="text-xs text-slate-500">Sin pagos.</p> : (
                  <div className="space-y-1">
                    {sel.payments.slice(0, 6).map((p) => (
                      <div key={p.id} className="flex items-center justify-between rounded bg-slate-900/60 px-2 py-1.5 text-xs">
                        <span className="text-slate-300">{fmtDate(p.createdAt)} · {p.provider}</span>
                        <span className="text-slate-200">{p.amount} {p.currency} <span className={p.status === "approved" ? "text-wa-green" : "text-slate-500"}>· {p.status}</span></span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
