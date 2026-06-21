import { useEffect, useState, type FormEvent } from "react";
import { api, apiError } from "../lib/api";
import { getSocket, type WaQrPayload, type WaStatusPayload } from "../lib/socket";
import type { Line } from "../lib/types";
import { fmtDate, fmtRemaining, isExpired } from "../lib/format";
import { Button, Input, ErrorMsg, Card, StatusDot } from "../components/ui";

interface ActivateResponse {
  line: { id: string; status: string; expiresAt: string | null };
  creditDays: number;
}

export default function WhatsappPage() {
  const [lines, setLines] = useState<Line[]>([]);
  const [qrs, setQrs] = useState<Record<string, string>>({});
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [activateDays, setActivateDays] = useState<Record<string, string>>({});
  const [activatingId, setActivatingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ id: string; text: string } | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get<{ lines: Line[] }>("/api/wa/lines");
      setLines(data.lines);
    } catch (err) {
      setError(apiError(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    const socket = getSocket();
    const onQr = (p: WaQrPayload) => {
      setQrs((prev) => ({ ...prev, [p.lineId]: p.qr }));
    };
    const onStatus = (p: WaStatusPayload) => {
      setLines((prev) =>
        prev.map((l) =>
          l.id === p.lineId ? { ...l, status: p.state, connected: p.connected } : l
        )
      );
      if (p.connected) {
        setQrs((prev) => {
          const next = { ...prev };
          delete next[p.lineId];
          return next;
        });
      }
    };
    socket.on("wa:qr", onQr);
    socket.on("wa:status", onStatus);
    return () => {
      socket.off("wa:qr", onQr);
      socket.off("wa:status", onStatus);
    };
  }, []);

  const createLine = async (e: FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      const { data } = await api.post<{ line: Line; qr: string | null }>(
        "/api/wa/lines",
        { label: label || undefined }
      );
      setLines((prev) => [...prev, data.line]);
      if (data.qr) setQrs((prev) => ({ ...prev, [data.line.id]: data.qr! }));
      setLabel("");
    } catch (err) {
      setError(apiError(err));
    } finally {
      setCreating(false);
    }
  };

  const connect = async (id: string) => {
    setError(null);
    try {
      const { data } = await api.post<{ qr: string | null; pairingCode: string | null }>(
        `/api/wa/lines/${id}/connect`
      );
      if (data.qr) setQrs((prev) => ({ ...prev, [id]: data.qr! }));
    } catch (err) {
      setError(apiError(err));
    }
  };

  const checkStatus = async (id: string) => {
    setError(null);
    try {
      const { data } = await api.get<{ state: string; connected: boolean; line: Line }>(
        `/api/wa/lines/${id}/status`
      );
      setLines((prev) => prev.map((l) => (l.id === id ? data.line : l)));
    } catch (err) {
      setError(apiError(err));
    }
  };

  const logout = async (id: string) => {
    setError(null);
    try {
      const { data } = await api.post<{ ok: boolean; line: Line }>(
        `/api/wa/lines/${id}/logout`
      );
      setLines((prev) => prev.map((l) => (l.id === id ? data.line : l)));
    } catch (err) {
      setError(apiError(err));
    }
  };

  const remove = async (id: string) => {
    setError(null);
    try {
      await api.delete(`/api/wa/lines/${id}`);
      setLines((prev) => prev.filter((l) => l.id !== id));
    } catch (err) {
      setError(apiError(err));
    }
  };

  const activate = async (id: string) => {
    const raw = activateDays[id] ?? "1";
    const n = parseInt(raw, 10);
    if (!Number.isInteger(n) || n <= 0) {
      setError("Ingresá una cantidad de días válida (entero mayor a 0).");
      return;
    }
    setActivatingId(id);
    setError(null);
    setNotice(null);
    try {
      const { data } = await api.post<ActivateResponse>(
        `/api/wa/lines/${id}/activate`,
        { days: n }
      );
      setLines((prev) =>
        prev.map((l) =>
          l.id === id
            ? { ...l, status: data.line.status, expiresAt: data.line.expiresAt }
            : l
        )
      );
      setNotice({
        id,
        text: `Línea activada. Crédito restante: ${data.creditDays} día${
          data.creditDays === 1 ? "" : "s"
        }.`,
      });
    } catch (err) {
      setError(apiError(err));
    } finally {
      setActivatingId(null);
    }
  };

  return (
    <div className="p-6">
      <h1 className="mb-2 text-xl font-bold">WhatsApp</h1>
      <p className="mb-5 text-sm text-slate-400">
        Escaneá el QR desde WhatsApp &gt; Dispositivos vinculados.
      </p>

      <Card className="mb-6 max-w-md">
        <form onSubmit={createLine} className="flex gap-2">
          <Input
            placeholder="Etiqueta de la línea (ej: Ventas)"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          <Button type="submit" disabled={creating}>
            {creating ? "…" : "Crear línea"}
          </Button>
        </form>
      </Card>

      {error && (
        <div className="mb-4">
          <ErrorMsg>{error}</ErrorMsg>
        </div>
      )}

      {loading ? (
        <p className="text-slate-400">Cargando…</p>
      ) : lines.length === 0 ? (
        <p className="text-slate-500">No tenés líneas todavía. Creá una arriba.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {lines.map((line) => {
            const qr = qrs[line.id];
            return (
              <Card key={line.id}>
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <StatusDot ok={line.connected} />
                    <div>
                      <div className="font-semibold">{line.label || "Sin etiqueta"}</div>
                      <div className="text-xs text-slate-400">
                        {line.phone || "Sin número"} · {line.status}
                      </div>
                    </div>
                  </div>
                  <div className="text-right text-xs">
                    {!line.expiresAt ? (
                      <span className="text-slate-500">sin días asignados</span>
                    ) : isExpired(line.expiresAt) ? (
                      <span className="font-semibold text-rose-400">vencida</span>
                    ) : (
                      <span className="text-slate-400">
                        <span className="block text-wa-green">
                          activa hasta {fmtDate(line.expiresAt)}
                        </span>
                        <span className="block text-slate-500">
                          {fmtRemaining(line.expiresAt)}
                        </span>
                      </span>
                    )}
                  </div>
                </div>

                {line.connected ? (
                  <div className="mb-3 rounded-md border border-wa-green/40 bg-wa-green/10 px-3 py-2 text-sm text-wa-green">
                    Línea conectada
                  </div>
                ) : qr ? (
                  <div className="mb-3 flex justify-center rounded-md bg-white p-2">
                    <img src={qr} alt="QR" className="h-44 w-44" />
                  </div>
                ) : null}

                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={() => void connect(line.id)}>
                    Conectar / Ver QR
                  </Button>
                  <Button variant="secondary" onClick={() => void checkStatus(line.id)}>
                    Estado
                  </Button>
                  <Button variant="ghost" onClick={() => void logout(line.id)}>
                    Desvincular
                  </Button>
                  <Button variant="danger" onClick={() => void remove(line.id)}>
                    Borrar
                  </Button>
                </div>

                <div className="mt-3 border-t border-slate-800 pt-3">
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={1}
                      step={1}
                      className="w-20"
                      value={activateDays[line.id] ?? "1"}
                      onChange={(e) =>
                        setActivateDays((prev) => ({
                          ...prev,
                          [line.id]: e.target.value,
                        }))
                      }
                    />
                    <Button
                      onClick={() => void activate(line.id)}
                      disabled={activatingId === line.id}
                    >
                      {activatingId === line.id ? "…" : "Activar (días)"}
                    </Button>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    1 día = 24 h de línea activa. Consume días del crédito.
                  </p>
                  {notice && notice.id === line.id && (
                    <p className="mt-1 text-xs text-wa-green">{notice.text}</p>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
