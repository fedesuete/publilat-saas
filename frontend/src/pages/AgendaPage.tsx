import { useEffect, useState, type FormEvent } from "react";
import { api, apiError } from "../lib/api";
import { fmtDate, fmtAmount, contactName } from "../lib/format";
import { Button, Input, Card, ErrorMsg, StageBadge } from "../components/ui";
import type { Lead, LeadDetail } from "../lib/types";

type Filter = "todos" | "conversiones" | "leads";
const TABS: Array<{ key: Filter; label: string }> = [
  { key: "todos", label: "Todos" },
  { key: "conversiones", label: "Conversiones" },
  { key: "leads", label: "Leads" },
];

const dayLabel = (iso: string) => new Date(iso).toLocaleDateString("es", { weekday: "long", day: "numeric", month: "long" });

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-sm text-slate-200 break-all">{value || "—"}</div>
    </div>
  );
}

export default function AgendaPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("todos");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<LeadDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = async (search = q, f = filter) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ filter: f });
      if (search.trim()) params.set("q", search.trim());
      const { data } = await api.get<{ leads: Lead[] }>(`/api/leads?${params.toString()}`);
      setLeads(data.leads);
    } catch (err) {
      setError(apiError(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(q, filter); /* eslint-disable-next-line */ }, [filter]);

  const onSearch = (e: FormEvent) => { e.preventDefault(); void load(q, filter); };

  const toggle = async (id: string) => {
    if (openId === id) { setOpenId(null); setDetail(null); return; }
    setOpenId(id);
    setDetail(null);
    setDetailLoading(true);
    try {
      const { data } = await api.get<{ lead: LeadDetail }>(`/api/leads/${id}`);
      setDetail(data.lead);
    } catch (err) {
      setError(apiError(err));
    } finally {
      setDetailLoading(false);
    }
  };

  // Agrupa por día (la lista viene ordenada desc por fecha).
  const groups: Array<{ day: string; items: Lead[] }> = [];
  for (const l of leads) {
    const day = dayLabel(l.createdAt);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(l);
    else groups.push({ day, items: [l] });
  }

  return (
    <div className="p-6">
      <h1 className="mb-1 text-xl font-bold">Agenda</h1>
      <p className="mb-4 text-sm text-slate-400">Todos tus contactos con su atribución. El teléfono se muestra al abrir la ficha.</p>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-md bg-slate-900 p-1 text-sm">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setFilter(t.key)}
              className={`rounded px-3 py-1 font-medium transition ${filter === t.key ? "bg-wa-green text-slate-900" : "text-slate-300 hover:text-white"}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <form onSubmit={onSearch} className="flex flex-1 gap-2">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre, teléfono o código…" />
          <Button type="submit" variant="secondary">Buscar</Button>
        </form>
      </div>

      {error && <div className="mb-3"><ErrorMsg>{error}</ErrorMsg></div>}

      {loading ? (
        <p className="text-slate-400">Cargando…</p>
      ) : leads.length === 0 ? (
        <Card><p className="text-sm text-slate-400">No hay contactos para este filtro.</p></Card>
      ) : (
        <div className="space-y-5">
          {groups.map((g) => (
            <div key={g.day}>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{g.day}</div>
              <div className="space-y-2">
                {g.items.map((l) => (
                  <Card key={l.id} className="p-0">
                    <button
                      onClick={() => void toggle(l.id)}
                      className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-800/40"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-slate-100">
                          {contactName(l)}
                        </div>
                        <div className="truncate text-xs text-slate-500">
                          {l.source || "sin fuente"}{l.campaignId ? ` · ${l.campaignId}` : ""} · {fmtDate(l.createdAt)}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {l.stage === "COMPRO" && l.amount != null && (
                          <span className="text-sm font-semibold text-wa-green">{fmtAmount(l.amount)}</span>
                        )}
                        <StageBadge stage={l.stage} />
                      </div>
                    </button>

                    {openId === l.id && (
                      <div className="border-t border-slate-800 px-4 py-3">
                        {detailLoading ? (
                          <p className="text-sm text-slate-400">Cargando ficha…</p>
                        ) : detail ? (
                          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                            <Field label="Nombre" value={detail.name} />
                            <Field label="Teléfono" value={detail.phone} />
                            <Field label="Línea WA" value={detail.line ? `${detail.line.label ?? ""} ${detail.line.phone}`.trim() : null} />
                            <Field label="Fuente" value={detail.source} />
                            <Field label="Campaña" value={detail.campaignId} />
                            <Field label="Anuncio" value={detail.adId} />
                            <Field label="Pixel" value={detail.pixelId} />
                            <Field label="fbclid" value={detail.fbclid} />
                            <Field label="Código" value={detail.code} />
                            <Field label="Landing / página" value={detail.landingUrl} />
                            <Field label="ID único (externalId)" value={detail.externalId} />
                            <Field label="Creado" value={fmtDate(detail.createdAt)} />
                          </div>
                        ) : (
                          <p className="text-sm text-slate-500">No se pudo cargar la ficha.</p>
                        )}
                      </div>
                    )}
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
