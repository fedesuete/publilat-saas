import { useEffect, useState, type FormEvent } from "react";
import { api, apiError } from "../lib/api";
import type { Lead } from "../lib/types";
import { fmtDate, fmtAmount, truncate } from "../lib/format";
import { Button, Input, StageBadge, ErrorMsg, Card } from "../components/ui";

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [purchaseFor, setPurchaseFor] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get<{ leads: Lead[] }>("/api/leads");
      setLeads(data.leads);
    } catch (err) {
      setError(apiError(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const onPurchased = (lead: Lead) => {
    setLeads((prev) => prev.map((l) => (l.id === lead.id ? lead : l)));
    setPurchaseFor(null);
  };

  return (
    <div className="p-6">
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-xl font-bold">Leads</h1>
        <Button variant="secondary" onClick={() => void load()}>
          Actualizar
        </Button>
      </div>

      {error && <ErrorMsg>{error}</ErrorMsg>}

      {loading ? (
        <p className="text-slate-400">Cargando…</p>
      ) : leads.length === 0 ? (
        <Card>
          <p className="text-slate-300">Todavía no hay leads.</p>
          <p className="mt-1 text-sm text-slate-500">
            Compartí un link rastreado (sección Links) para empezar a capturar
            contactos desde tus anuncios.
          </p>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-800">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-800/80 text-left text-slate-300">
              <tr>
                <th className="px-3 py-2">Creado</th>
                <th className="px-3 py-2">Etapa</th>
                <th className="px-3 py-2">Campaña</th>
                <th className="px-3 py-2">Fuente</th>
                <th className="px-3 py-2">Código</th>
                <th className="px-3 py-2">fbclid</th>
                <th className="px-3 py-2">Monto</th>
                <th className="px-3 py-2">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((lead) => (
                <tr key={lead.id} className="border-t border-slate-800">
                  <td className="px-3 py-2 text-slate-400">{fmtDate(lead.createdAt)}</td>
                  <td className="px-3 py-2">
                    <StageBadge stage={lead.stage} />
                  </td>
                  <td className="px-3 py-2">{lead.campaignId ?? "—"}</td>
                  <td className="px-3 py-2">{lead.source ?? "—"}</td>
                  <td className="px-3 py-2 font-mono text-xs">{lead.code ?? "—"}</td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-400">
                    {truncate(lead.fbclid)}
                  </td>
                  <td className="px-3 py-2">
                    {lead.stage === "COMPRO" ? (
                      <div>
                        <span className="font-semibold text-wa-green">
                          {fmtAmount(lead.amount)}
                        </span>
                        <div className="text-xs text-slate-500">
                          {fmtDate(lead.purchasedAt)}
                        </div>
                      </div>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {lead.stage !== "COMPRO" && (
                      <Button onClick={() => setPurchaseFor(lead.id)}>
                        Marcó compra
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {purchaseFor && (
        <PurchaseModal
          leadId={purchaseFor}
          onClose={() => setPurchaseFor(null)}
          onDone={onPurchased}
        />
      )}
    </div>
  );
}

function PurchaseModal({
  leadId,
  onClose,
  onDone,
}: {
  leadId: string;
  onClose: () => void;
  onDone: (lead: Lead) => void;
}) {
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("ARS");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const value = Number(amount);
    if (!value || value <= 0) {
      setError("Ingresá un monto válido");
      return;
    }
    setLoading(true);
    try {
      const { data } = await api.post<{ ok: boolean; lead: Lead }>(
        `/api/leads/${leadId}/purchase`,
        { amount: value, currency: currency.toUpperCase() }
      );
      onDone(data.lead);
    } catch (err) {
      setError(apiError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-sm rounded-xl border border-slate-700 bg-slate-800 p-5">
        <h2 className="mb-4 text-lg font-semibold">Marcar compra</h2>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="mb-1 block text-xs text-slate-400">Monto</label>
            <Input
              type="number"
              step="0.01"
              placeholder="1500.50"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              autoFocus
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">Moneda</label>
            <Input
              type="text"
              maxLength={3}
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
            />
          </div>
          {error && <ErrorMsg>{error}</ErrorMsg>}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Enviando…" : "Confirmar"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
