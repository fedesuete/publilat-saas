import { useState } from "react";
import { api, apiError } from "../../lib/api";
import { Button, Card, ErrorMsg } from "../../components/ui";

const TYPES: Array<{ key: string; label: string; desc: string }> = [
  { key: "clients", label: "Clientes", desc: "Todas las cuentas con estado, demo y fechas." },
  { key: "revenue", label: "Ingresos", desc: "Pagos aprobados por cliente, pasarela y monto." },
  { key: "leads", label: "Leads", desc: "Contactos/leads con fuente, campaña y etapa." },
];

export default function AdminExport() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const download = async (type: string) => {
    setBusy(type); setError(null);
    try {
      const res = await api.get(`/api/admin/export/${type}`, { responseType: "blob" });
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${type}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) { setError(apiError(e)); } finally { setBusy(null); }
  };

  return (
    <div className="p-6">
      <h1 className="mb-4 text-xl font-bold">Exportar</h1>
      {error && <div className="mb-3"><ErrorMsg>{error}</ErrorMsg></div>}
      <div className="grid gap-4 sm:grid-cols-3">
        {TYPES.map((t) => (
          <Card key={t.key}>
            <div className="text-sm font-semibold text-slate-100">{t.label}</div>
            <p className="mt-1 mb-4 text-xs text-slate-400">{t.desc}</p>
            <Button disabled={busy === t.key} onClick={() => void download(t.key)} className="w-full">
              {busy === t.key ? "Generando…" : "Descargar CSV"}
            </Button>
          </Card>
        ))}
      </div>
    </div>
  );
}
