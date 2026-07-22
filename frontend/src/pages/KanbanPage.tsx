import { useEffect, useState, type DragEvent } from "react";
import { api, apiError } from "../lib/api";
import type { Lead, LeadDetail, Stage } from "../lib/types";
import { fmtAmount, fmtDate } from "../lib/format";
import { Button, Input, ErrorMsg } from "../components/ui";

const COLUMNS: Stage[] = ["NUEVO", "CONTACTADO", "INTERESADO", "COMPRO", "PERDIDO"];
const STAGE_LABEL: Record<Stage, string> = {
  NUEVO: "Nuevo", CONTACTADO: "Contactado", INTERESADO: "Interesado", COMPRO: "Compró", PERDIDO: "Perdido",
};
const HEADER_STYLES: Record<Stage, string> = {
  NUEVO: "border-slate-600", CONTACTADO: "border-sky-700", INTERESADO: "border-amber-600",
  COMPRO: "border-wa-green", PERDIDO: "border-rose-800",
};
const DOT: Record<Stage, string> = {
  NUEVO: "bg-slate-400", CONTACTADO: "bg-sky-400", INTERESADO: "bg-amber-400",
  COMPRO: "bg-wa-green", PERDIDO: "bg-rose-400",
};

// Hora corta para la esquina de la card (hoy -> hora; otro día -> dd/mm).
function cardTime(iso: string): string {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("es", { day: "2-digit", month: "2-digit" });
}

function SourceTag({ source }: { source: string | null }) {
  if (!source) return null;
  const map: Record<string, string> = {
    fb: "bg-blue-500/15 text-blue-300", ig: "bg-pink-500/15 text-pink-300",
    ctwa: "bg-wa-green/15 text-wa-green", wa: "bg-wa-green/15 text-wa-green",
  };
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${map[source.toLowerCase()] ?? "bg-slate-700 text-slate-300"}`}>
      {source}
    </span>
  );
}

export default function KanbanPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<{ id: string; initialStage?: Stage } | null>(null);
  const [onlyReal, setOnlyReal] = useState(true); // por defecto: solo clientes que escribieron

  const load = async (r = onlyReal) => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get<{ leads: Lead[] }>(`/api/leads${r ? "?real=1" : ""}`);
      setLeads(data.leads);
    } catch (err) {
      setError(apiError(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load(onlyReal);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onlyReal]);

  // Mover etapa directo (drag a una columna que NO es Compró). Optimista.
  const moveStage = async (lead: Lead, target: Stage) => {
    if (lead.stage === target || lead.stage === "COMPRO") return;
    setError(null);
    const prev = lead.stage;
    setLeads((list) => list.map((l) => (l.id === lead.id ? { ...l, stage: target } : l)));
    try {
      await api.patch(`/api/leads/${lead.id}`, { stage: target });
    } catch (err) {
      setError(apiError(err));
      setLeads((list) => list.map((l) => (l.id === lead.id ? { ...l, stage: prev } : l)));
    }
  };

  const onSaved = (lead: Lead) => {
    setLeads((list) => list.map((l) => (l.id === lead.id ? { ...l, ...lead } : l)));
    setDrawer(null);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>, target: Stage) => {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/plain") || dragId;
    setDragId(null);
    if (!id) return;
    const lead = leads.find((l) => l.id === id);
    if (!lead || lead.stage === target) return;
    // Compró necesita monto + comprobante: abrimos el drawer con esa etapa preseleccionada.
    if (target === "COMPRO") setDrawer({ id, initialStage: "COMPRO" });
    else void moveStage(lead, target);
  };

  return (
    <div className="flex h-full flex-col p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold">CRM</h1>
        <div className="flex items-center gap-3">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-300">
            <input type="checkbox" checked={onlyReal} onChange={(e) => setOnlyReal(e.target.checked)} className="accent-wa-green" />
            Solo clientes reales
          </label>
          <Button variant="secondary" onClick={() => void load(onlyReal)}>Actualizar</Button>
        </div>
      </div>

      {error && <div className="mb-4"><ErrorMsg>{error}</ErrorMsg></div>}

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
                <div className={`flex items-center justify-between border-b-2 px-3 py-2 ${HEADER_STYLES[stage]}`}>
                  <span className="flex items-center gap-2 text-sm font-semibold text-slate-100">
                    <span className={`h-2 w-2 rounded-full ${DOT[stage]}`} />
                    {STAGE_LABEL[stage]}
                  </span>
                  <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-300">{colLeads.length}</span>
                </div>
                <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-2">
                  {colLeads.length === 0 ? (
                    <p className="px-1 py-2 text-xs text-slate-600">Sin leads</p>
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
                          onClick={() => setDrawer({ id: lead.id })}
                          className={`cursor-pointer rounded-lg border border-slate-700 bg-slate-800 p-2.5 text-sm transition hover:border-slate-500 ${
                            locked ? "" : "active:cursor-grabbing"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <span className="truncate font-medium text-slate-100">
                              {lead.name?.trim() || lead.phone || "Sin nombre"}
                            </span>
                            <span className="shrink-0 text-[11px] text-slate-500">{cardTime(lead.createdAt)}</span>
                          </div>
                          {lead.name?.trim() && lead.phone && (
                            <div className="font-mono text-xs text-slate-400">{lead.phone}</div>
                          )}
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                            <SourceTag source={lead.source} />
                            {lead.stage === "COMPRO" && lead.amount != null && (
                              <span className="rounded bg-wa-green/15 px-1.5 py-0.5 text-[11px] font-semibold text-wa-green">
                                {fmtAmount(lead.amount)}
                              </span>
                            )}
                            {lead.stage !== "COMPRO" && lead.paymentDetected && (
                              <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-amber-300">
                                💰 pago detectado
                              </span>
                            )}
                            {(lead.stage === "COMPRO" || lead.paymentDetected) && (
                              <span title="Tiene comprobante">🧾</span>
                            )}
                          </div>
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

      {drawer && (
        <LeadDrawer
          leadId={drawer.id}
          initialStage={drawer.initialStage}
          onClose={() => setDrawer(null)}
          onSaved={onSaved}
        />
      )}
    </div>
  );
}

// Drawer de detalle del lead (estilo ScaleOS): etapa en pills, monto, y el comprobante a la vista.
function LeadDrawer({
  leadId,
  initialStage,
  onClose,
  onSaved,
}: {
  leadId: string;
  initialStage?: Stage;
  onClose: () => void;
  onSaved: (lead: Lead) => void;
}) {
  const [detail, setDetail] = useState<LeadDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stageSel, setStageSel] = useState<Stage | null>(null);
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("ARS");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    api
      .get<{ lead: LeadDetail }>(`/api/leads/${leadId}`)
      .then(({ data }) => {
        if (!active) return;
        setDetail(data.lead);
        setStageSel(initialStage ?? data.lead.stage);
        // Solo pre-cargamos el monto si YA compró (para verlo). El monto que leyó la IA NO se
        // pre-carga (se equivoca seguido, ej. leyó 3.000.000 en vez de 3.000): queda como
        // sugerencia tocable para que el operador ponga SIEMPRE el valor real a conciencia.
        if (data.lead.amount != null) setAmount(String(data.lead.amount / 100));
      })
      .catch((e) => active && setError(apiError(e)))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [leadId, initialStage]);

  const isCompro = detail?.stage === "COMPRO";
  const wantsCompro = stageSel === "COMPRO";

  const save = async () => {
    if (!detail || !stageSel || stageSel === detail.stage) { onClose(); return; }
    setSaving(true);
    setError(null);
    try {
      if (stageSel === "COMPRO") {
        const value = Number(amount);
        if (!value || value <= 0) { setError("Ingresá el monto de la compra."); setSaving(false); return; }
        const { data } = await api.post<{ ok: boolean; lead: Lead }>(`/api/leads/${leadId}/purchase`, {
          amount: value, currency: currency.toUpperCase(),
        });
        onSaved(data.lead);
      } else {
        const { data } = await api.patch<{ lead: Pick<Lead, "id" | "stage" | "name"> }>(`/api/leads/${leadId}`, {
          stage: stageSel,
        });
        onSaved({ ...detail, stage: data.lead.stage });
      }
    } catch (e) {
      setError(apiError(e));
    } finally {
      setSaving(false);
    }
  };

  // Editar el monto de una compra YA marcada (re-envía el Purchase corregido; conserva la fecha).
  const saveAmountEdit = async () => {
    const value = Number(amount);
    if (!value || value <= 0) { setError("Ingresá el monto de la compra."); return; }
    setSaving(true);
    setError(null);
    try {
      const { data } = await api.post<{ ok: boolean; lead: Lead }>(`/api/leads/${leadId}/purchase`, {
        amount: value, currency: currency.toUpperCase(),
      });
      onSaved(data.lead);
    } catch (e) {
      setError(apiError(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-slate-700 bg-slate-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {loading || !detail ? (
          <div className="p-6 text-slate-400">Cargando…</div>
        ) : (
          <>
            {/* Header */}
            <div className="flex items-center gap-3 border-b border-slate-800 p-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-700 text-lg font-bold text-slate-200">
                {(detail.name?.trim() || detail.phone || "?").charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold text-slate-100">{detail.name?.trim() || "Sin nombre"}</div>
                <div className="font-mono text-xs text-slate-400">{detail.phone ?? "—"}</div>
              </div>
              <button onClick={onClose} className="p-1 text-slate-400 hover:text-white" aria-label="Cerrar">✕</button>
            </div>

            <div className="space-y-5 p-4">
              {error && <ErrorMsg>{error}</ErrorMsg>}

              {/* Etapa del funnel */}
              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Etapa del funnel</div>
                <div className="flex flex-wrap gap-2">
                  {COLUMNS.map((s) => {
                    const active = stageSel === s;
                    return (
                      <button
                        key={s}
                        disabled={isCompro}
                        onClick={() => setStageSel(s)}
                        className={`rounded-full border px-3 py-1.5 text-sm font-medium transition ${
                          active ? "border-wa-green bg-wa-green text-slate-900" : "border-slate-700 text-slate-300 hover:border-slate-500"
                        } ${isCompro ? "cursor-not-allowed opacity-60" : ""}`}
                      >
                        {STAGE_LABEL[s]}
                      </button>
                    );
                  })}
                </div>
                {isCompro && <p className="mt-1.5 text-[11px] text-slate-500">Ya está marcado como compra (no se puede revertir).</p>}
              </div>

              {/* Monto de compra */}
              {(wantsCompro || isCompro) && (
                <div>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Monto de compra</div>
                  {isCompro ? (
                    <>
                      <div className="flex gap-2">
                        <Input type="number" step="0.01" placeholder="Monto" value={amount} onChange={(e) => setAmount(e.target.value)} className="flex-1" />
                        <Input type="text" maxLength={3} value={currency} onChange={(e) => setCurrency(e.target.value)} className="w-20" />
                      </div>
                      <p className="mt-1.5 text-[11px] text-slate-500">
                        {detail.purchasedAt ? `Comprada el ${fmtDate(detail.purchasedAt)}. ` : ""}Podés corregir el monto y guardar.
                      </p>
                      <Button className="mt-2" disabled={saving} onClick={() => void saveAmountEdit()}>
                        {saving ? "Guardando…" : "💾 Guardar monto"}
                      </Button>
                    </>
                  ) : (
                    <>
                      <div className="flex gap-2">
                        <Input type="number" step="0.01" placeholder="Poné el monto REAL de la carga" value={amount} onChange={(e) => setAmount(e.target.value)} className="flex-1" autoFocus />
                        <Input type="text" maxLength={3} value={currency} onChange={(e) => setCurrency(e.target.value)} className="w-20" />
                      </div>
                      <p className="mt-1.5 text-[11px] text-slate-500">Escribí el monto que cargó de verdad el cliente.</p>
                      {detail.paymentDetected && detail.paymentDetectedAmount != null && (
                        <button
                          type="button"
                          onClick={() => setAmount(String((detail.paymentDetectedAmount ?? 0) / 100))}
                          className="mt-1.5 rounded-md border border-amber-500/50 bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-amber-200 hover:bg-amber-500/20"
                        >
                          💰 La IA leyó {fmtAmount(detail.paymentDetectedAmount)} — tocá si es correcto (puede equivocarse)
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* Comprobante */}
              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Comprobante</div>
                {detail.comprobantes && detail.comprobantes.length > 0 ? (
                  <div className="space-y-2">
                    {detail.comprobantes.map((c) => (
                      <a key={c.id} href={c.url} target="_blank" rel="noreferrer" className="block">
                        <img src={c.url} alt="Comprobante enviado por el cliente" className="w-full rounded-lg border border-slate-700" />
                      </a>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">El cliente todavía no envió ningún comprobante (imagen).</p>
                )}
              </div>
            </div>

            {/* Guardar cambios */}
            {!isCompro && (
              <div className="mt-auto border-t border-slate-800 p-4">
                <Button disabled={saving || stageSel === detail.stage} onClick={() => void save()} className="w-full">
                  {saving ? "Guardando…" : stageSel === "COMPRO" ? "Marcar compra y guardar" : "Guardar cambios"}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
