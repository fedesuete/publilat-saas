import { describe, it, expect, vi } from "vitest";
import { resolveRelayLine } from "./bot-relay-line.js";

// Caso real (raul, 11/09/2026): el cliente borró y re-escaneó su número → lineId nuevo. El bot siguió
// pidiendo /send por el lineId viejo (guardado por jugador) → 404 "línea no encontrada" y el aviso de
// carga se perdía. El bot ahora manda también ownerUserId: si la línea pedida no existe o está caída,
// se responde por la línea conectada de ESA cuenta.
const LIVE = { id: "L_nueva", userId: "U1" };
const mkDb = (byId: Record<string, any>, ownerLine: any) => ({
  waLine: {
    findUnique: vi.fn(async ({ where }: any) => byId[where.id] ?? null),
    findFirst: vi.fn(async () => ownerLine),
  },
});

describe("resolveRelayLine", () => {
  it("línea pedida existe y está conectada → esa, sin fallback", async () => {
    const db = mkDb({ L1: { id: "L1", userId: "U1", connected: true } }, LIVE);
    const r = await resolveRelayLine(db, { lineId: "L1", ownerUserId: "U1" });
    expect(r).toEqual({ line: { id: "L1", userId: "U1" }, fallback: false });
    expect(db.waLine.findFirst).not.toHaveBeenCalled();
  });

  it("línea pedida NO existe + ownerUserId → línea conectada de la cuenta (fallback)", async () => {
    const db = mkDb({}, LIVE);
    const r = await resolveRelayLine(db, { lineId: "L_borrada", ownerUserId: "U1" });
    expect(r).toEqual({ line: LIVE, fallback: true });
    const q = db.waLine.findFirst.mock.calls[0][0];
    expect(q.where).toMatchObject({ userId: "U1", connected: true, status: "active" });
    expect(q.orderBy).toEqual([{ lastUsedAt: "desc" }, { createdAt: "desc" }]);
  });

  it("línea pedida existe pero desconectada + ownerUserId → fallback", async () => {
    const db = mkDb({ L1: { id: "L1", userId: "U1", connected: false } }, LIVE);
    const r = await resolveRelayLine(db, { lineId: "L1", ownerUserId: "U1" });
    expect(r).toEqual({ line: LIVE, fallback: true });
  });

  it("línea pedida no existe y NO viene ownerUserId → null (comportamiento de siempre)", async () => {
    const db = mkDb({}, LIVE);
    expect(await resolveRelayLine(db, { lineId: "L_borrada" })).toBeNull();
    expect(db.waLine.findFirst).not.toHaveBeenCalled();
  });

  it("ownerUserId sin ninguna línea conectada → null", async () => {
    const db = mkDb({}, null);
    expect(await resolveRelayLine(db, { lineId: "L_borrada", ownerUserId: "U1" })).toBeNull();
  });
});
