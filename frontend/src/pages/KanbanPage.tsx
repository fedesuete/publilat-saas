import { useEffect, useState, type DragEvent, type FormEvent } from "react";
import { api, apiError } from "../lib/api";
import type { Lead, Stage } from "../lib/types";
import { fmtAmount, fmtDate } from "../lib/format";
import { Button, Input, ErrorMsg } from "../components/ui";

const COLUMNS: Stage[] = ["NUEVO", "CONTACTADO", "INTERESADO", "COMPRO", "PERDIDO"];

const HEADER_STYLES: Record<Stage, string> = {
  NUEVO: "border-slate-600",
  CONTACTADO: "border-sky-700",
  INTERESADO: "border-amber-600",
  COMPRO: "border-wa-green",
  PERDIDO: "border-rose-800",
};

export default function KanbanPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
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

  const moveStage = async (lead: Lead, target: Stage) => {
    if (lead.stage === target) return;
    if (lead.stage === "COMPRO") return; // already purchased, locked
    if (target === "COMPRO") {
      setPurchaseFor(lead.id);
      return;
    }
    setError(null);
    const prev = lead.stage;
    // optimistic
    setLeads((list) =>
      list.map((l) => (l.id === lead.id ? { ...l, stage: target } : l))
    );
    try {
      await api.patch<{ lead: Pick<Lead, "id" | "stage" | "name"> }>(
        `/api/leads/${lead.id}`,
        { stage: target }
      );
    } catch (err) {
      setError(apiError(err));
      // revert
      setLeads((list) =>
        list.map((l) => (l.id === lead.id ? { ...l, stage: prev } : l))
      );
    }
  };

  const onPurchased = (lead: Lead) => {
    setLeads((list) => list.map((l) => (l.id === lead.id ? lead : l)));
    setPurchaseFor(null);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>, target: Stage) => {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/plain") || dragId;
    setDragId(null);
    if (!id) return;
    const lead = leads.find((l) => l.id === id);
    if (lead) void moveStage(lead, target);
  };

  return (
    <div className="flex h-full flex-col p-6">
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-xl font-bold">Kanban</h1>
        <Button variant="secondary" onClick={() => void load()}>
          Actualizar
        </Button>
      </div>

      {error && (
        <div className="mb-4">
          <ErrorMsg>{error}</ErrorMsg>
        </div>
      )}

      {loading ? (
        <p className="text-slate-400">Cargando…</p>
      ) : (
        <div className="flex flex-1 gap-4 overflow-x-auto pb-2">
          {COLUMNS.map((stage) => {
            const colLeads = leads.filter((l) => l.stage === stage);
            return (
              <div
                key={stage}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => handleDrop(e, stage)}
                className="flex w-72 flex-shrink-0 flex-col rounded-lg border border-slate-800 bg-slate-900/40"
              >
                <div
                  className={`flex items-center justify-between border-b-2 px-3 py-2 ${HEADER_STYLES[stage]}`}
                >
                  <span className="text-sm font-semibold text-slate-100">
                    {stage}
                  </span>
                  <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-300">
                    {colLeads.length}
                  </span>
                </div>
                <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-2">
                  {colLeads.length === 0 ? (
                    <p className="px-1 py-2 text-xs text-slate-600">
                      Sin leads
                    </p>
                  ) : (
                    colLeads.map((lead) => {
                      const locked = lead.stage === "COMPRO";
                      return (
                        <div
                          key={lead.id}
                          draggable={!locked}
                          onDragStart={(e) => {
                            setDragId(lead.id);
                            e.dataTransfer.setData("text/plain", lead.id);
                            e.dataTransfer.effectAllowed = "move";
                          }}
                          onDragEnd={() => setDragId(null)}
                          className={`rounded-md border border-slate-700 bg-slate-800 p-2 text-sm ${
                            locked ? "" : "cursor-grab active:cursor-grabbing"
                          }`}
                        >
                          <div className="font-medium text-slate-100">
                            {lead.name?.trim() || lead.phone || "Sin nombre"}
                          </div>
                          {lead.name?.trim() && lead.phone && (
                            <div className="font-mono text-xs text-slate-400">
                              {lead.phone}
                            </div>
                          )}
                          {(lead.source || lead.campaignId) && (
                            <div className="mt-0.5 truncate text-xs text-slate-400">
                              {[lead.source, lead.campaignId]
                                .filter(Boolean)
                                .join(" · ")}
                            </div>
                          )}
                          {locked && (
                            <div className="mt-1 text-xs">
                              <span className="font-semibold text-wa-green">
                                {fmtAmount(lead.amount)}
                              </span>{" "}
                              <span className="text-slate-500">
                                {fmtDate(lead.purchasedAt)}
                              </span>
                            </div>
                          )}
                          {!locked && (
                            <div className="mt-2">
                              <select
                                value=""
                                onChange={(e) => {
                                  const target = e.target.value as Stage;
                                  if (target) void moveStage(lead, target);
                                }}
                                className="w-full rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-xs text-slate-400 outline-none focus:border-wa-green"
                              >
                                <option value="">mover…</option>
                                {COLUMNS.filter((s) => s !== lead.stage).map(
                                  (s) => (
                                    <option key={s} value={s}>
                                      {s}
                                    </option>
                                  )
                                )}
                              </select>
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
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
