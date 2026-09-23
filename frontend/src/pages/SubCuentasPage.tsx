// Sub-cuentas ("sub agentes"): cuentas aparte que el cliente maneja desde su propio panel. Cada una
// tiene SUS números, landings, contactos y pixel; se entra y se vuelve sin compartir contraseñas.
import { useEffect, useState, type FormEvent } from "react";
import { api, apiError } from "../lib/api";
import { fmtDate } from "../lib/format";
import { Button, Card, ErrorMsg, Input } from "../components/ui";
import { Users, LogIn, Plus, ArrowLeft } from "lucide-react";

interface SubCuenta {
  id: string;
  email: string;
  name: string | null;
  slug: string;
  suspended: boolean;
  maxLines: number;
  lineas: number;
  createdAt: string;
}
interface Estado {
  habilitado: boolean;
  max: number;
  puedeCrear: boolean;
  principal: { id: string; email: string; name: string | null };
  actual: string;
  prestada: boolean;
  cuentas: SubCuenta[];
}

export default function SubCuentasPage() {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [form, setForm] = useState({ email: "", password: "", name: "", maxLines: "5" });
  const [creando, setCreando] = useState(false);

  const cargar = async () => {
    try {
      const { data } = await api.get<Estado>("/api/subaccounts");
      setEstado(data);
    } catch (e) {
      setError(apiError(e));
    }
  };
  useEffect(() => { void cargar(); }, []);

  // Entrar/volver cambia la cookie de sesión: recargamos entero para que todo el panel (mensajes,
  // números, landings) se vuelva a pedir con la cuenta nueva.
  const entrar = async (id: string) => {
    setBusy(id); setError(null);
    try {
      await api.post(`/api/subaccounts/${id}/entrar`);
      window.location.href = "/dashboard";
    } catch (e) { setError(apiError(e)); setBusy(null); }
  };
  const volver = async () => {
    setBusy("volver"); setError(null);
    try {
      await api.post("/api/subaccounts/volver");
      window.location.href = "/dashboard";
    } catch (e) { setError(apiError(e)); setBusy(null); }
  };

  const crear = async (e: FormEvent) => {
    e.preventDefault(); setError(null); setCreando(true);
    try {
      await api.post("/api/subaccounts", {
        email: form.email.trim(),
        password: form.password,
        name: form.name.trim(),
        maxLines: Number(form.maxLines) || 5,
      });
      setForm({ email: "", password: "", name: "", maxLines: "5" });
      await cargar();
    } catch (e2) { setError(apiError(e2)); }
    finally { setCreando(false); }
  };

  if (!estado) return <div className="p-6 text-sm text-slate-400">Cargando…</div>;

  if (!estado.habilitado) {
    return (
      <div className="space-y-4 p-4 sm:p-6">
        <h1 className="flex items-center gap-2 text-xl font-semibold text-slate-100"><Users className="h-5 w-5" /> Sub cuentas</h1>
        <Card className="p-5 text-sm text-slate-300">
          Las sub cuentas te permiten abrirle una cuenta aparte a otra persona —con sus propios números,
          landings y clientes— y entrar a manejarla desde acá, sin compartir tu contraseña.
          <div className="mt-3 text-slate-400">Tu plan todavía no las incluye. Escribinos por Soporte y te las habilitamos.</div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold text-slate-100"><Users className="h-5 w-5" /> Sub cuentas</h1>
        <p className="mt-1 text-sm text-slate-400">
          Cada sub cuenta es independiente: tiene sus propios números de WhatsApp, landings, clientes y pixel.
          Vos entrás y salís cuando quieras; la otra persona entra con su propio email y contraseña, y solo ve lo suyo.
        </p>
      </div>
      {error && <ErrorMsg>{error}</ErrorMsg>}

      {estado.prestada && (
        <Card className="flex flex-wrap items-center justify-between gap-3 border-amber-500/40 bg-amber-500/10 p-4">
          <div className="text-sm text-amber-200">
            Estás dentro de una sub cuenta. Todo lo que ves y hacés es de ella, no de tu cuenta principal.
          </div>
          <Button variant="secondary" onClick={() => void volver()} disabled={busy === "volver"}>
            <ArrowLeft className="h-4 w-4" /> {busy === "volver" ? "Volviendo…" : `Volver a ${estado.principal.name || estado.principal.email}`}
          </Button>
        </Card>
      )}

      <Card className="p-0">
        {estado.cuentas.length === 0 ? (
          <div className="p-5 text-sm text-slate-400">Todavía no creaste ninguna sub cuenta.</div>
        ) : (
          <div className="divide-y divide-slate-800">
            {estado.cuentas.map((c) => (
              <div key={c.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <div className="truncate font-medium text-slate-100">
                    {c.name || c.email}
                    {estado.actual === c.id && <span className="ml-2 rounded bg-emerald-500/15 px-2 py-0.5 text-[11px] text-emerald-300">estás acá</span>}
                    {c.suspended && <span className="ml-2 rounded bg-rose-500/15 px-2 py-0.5 text-[11px] text-rose-300">suspendida</span>}
                  </div>
                  <div className="truncate text-xs text-slate-400">
                    {c.email} · {c.lineas} de {c.maxLines} números · desde {fmtDate(c.createdAt)}
                  </div>
                </div>
                {estado.actual === c.id ? (
                  <Button variant="secondary" onClick={() => void volver()} disabled={busy === "volver"}>
                    <ArrowLeft className="h-4 w-4" /> Volver a mi cuenta
                  </Button>
                ) : (
                  <Button variant="secondary" onClick={() => void entrar(c.id)} disabled={busy === c.id || c.suspended}>
                    <LogIn className="h-4 w-4" /> {busy === c.id ? "Entrando…" : "Entrar"}
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {estado.puedeCrear && !estado.prestada && (
        <Card className="p-5">
          <h2 className="flex items-center gap-2 font-medium text-slate-100"><Plus className="h-4 w-4" /> Crear una sub cuenta</h2>
          <p className="mt-1 text-xs text-slate-400">
            Llevás {estado.cuentas.length} de {estado.max}. Pasale estos datos a la persona para que entre por su cuenta.
          </p>
          <form onSubmit={crear} className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-sm text-slate-300">Nombre
              <Input value={form.name} onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))} placeholder="Ej: Sucursal Centro" className="mt-1" required />
            </label>
            <label className="text-sm text-slate-300">Email con el que va a entrar
              <Input type="email" value={form.email} onChange={(e) => setForm((s) => ({ ...s, email: e.target.value }))} placeholder="persona@gmail.com" className="mt-1" required />
            </label>
            <label className="text-sm text-slate-300">Contraseña
              <Input value={form.password} onChange={(e) => setForm((s) => ({ ...s, password: e.target.value }))} placeholder="mínimo 6 caracteres" className="mt-1" required minLength={6} />
            </label>
            <label className="text-sm text-slate-300">Números de WhatsApp que puede tener
              <Input type="number" min={0} max={100} value={form.maxLines} onChange={(e) => setForm((s) => ({ ...s, maxLines: e.target.value }))} className="mt-1" />
            </label>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={creando}>{creando ? "Creando…" : "Crear sub cuenta"}</Button>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}
