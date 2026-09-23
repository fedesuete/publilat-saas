import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

// Estas rutas ENTREGAN una sesión de otra cuenta, así que lo que se prueba es sobre todo lo que NO
// se puede hacer: entrar a una cuenta ajena, que una sub-cuenta salte a la del padre, o armar cadenas.
process.env.JWT_SECRET = "test-secret-subcuentas";

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(async () => []), count: vi.fn(async () => 0), create: vi.fn() },
}));
vi.mock("../lib/prisma.js", () => ({ prisma: prismaMock }));

const { subAccountsRouter } = await import("./subaccounts.js");
const { signToken } = await import("../lib/auth.js");

const PADRE = "u_padre";
const HIJA = "u_hija";
const AJENA = "u_ajena";

let server: Server;
let base = "";
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  // requireAuth de verdad ya validó el token; acá solo inyectamos userId como hace el middleware.
  app.use((req, _res, next) => {
    const [, tok] = (req.get("authorization") ?? "").split(" ");
    if (tok) {
      const jwt = JSON.parse(Buffer.from(tok.split(".")[1], "base64").toString());
      (req as express.Request).userId = jwt.userId;
    }
    next();
  });
  app.use("/api/subaccounts", subAccountsRouter);
  await new Promise<void>((ok) => { server = app.listen(0, "127.0.0.1", ok); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((ok) => server.close(() => ok())));
beforeEach(() => vi.clearAllMocks());

const tokenNormal = (userId: string) => signToken({ userId, tv: 0 });
const tokenPrestado = (userId: string, parentId: string) => signToken({ userId, tv: 0, parentId });

async function post(url: string, token: string, body?: unknown) {
  const r = await fetch(base + url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, unknown> };
}

describe("entrar a una sub-cuenta", () => {
  it("el padre entra a SU sub-cuenta", async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({ id: HIJA, email: "h@x.com", name: "Hija", slug: "hija", role: "USER", tokenVersion: 0, parentUserId: PADRE, suspended: false } as never);
    const r = await post(`/api/subaccounts/${HIJA}/entrar`, tokenNormal(PADRE));
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
  });

  it("NO se entra a una cuenta que no es hija propia (aunque exista)", async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({ id: AJENA, email: "a@x.com", name: null, slug: "a", role: "USER", tokenVersion: 0, parentUserId: "otro_padre", suspended: false } as never);
    const r = await post(`/api/subaccounts/${AJENA}/entrar`, tokenNormal(PADRE));
    expect(r.status).toBe(404); // mismo mensaje que "no existe": no confirmamos cuentas ajenas
  });

  it("NO se entra a una cuenta suelta (sin padre)", async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({ id: AJENA, email: "a@x.com", name: null, slug: "a", role: "USER", tokenVersion: 0, parentUserId: null, suspended: false } as never);
    expect((await post(`/api/subaccounts/${AJENA}/entrar`, tokenNormal(PADRE))).status).toBe(404);
  });

  it("NO se entra a una cuenta de administrador", async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({ id: AJENA, email: "admin@x.com", name: null, slug: "a", role: "ADMIN", tokenVersion: 0, parentUserId: PADRE, suspended: false } as never);
    expect((await post(`/api/subaccounts/${AJENA}/entrar`, tokenNormal(PADRE))).status).toBe(403);
  });

  it("NO se entra a una sub-cuenta suspendida", async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({ id: HIJA, email: "h@x.com", name: null, slug: "h", role: "USER", tokenVersion: 0, parentUserId: PADRE, suspended: true } as never);
    expect((await post(`/api/subaccounts/${HIJA}/entrar`, tokenNormal(PADRE))).status).toBe(403);
  });

  it("una sub-cuenta logueada normal NO puede entrar a una hermana", async () => {
    // La hermana depende del PADRE, no de la hija: la hija no es dueña de nada.
    prismaMock.user.findUnique.mockResolvedValueOnce({ id: "u_hermana", email: "s@x.com", name: null, slug: "s", role: "USER", tokenVersion: 0, parentUserId: PADRE, suspended: false } as never);
    expect((await post("/api/subaccounts/u_hermana/entrar", tokenNormal(HIJA))).status).toBe(404);
  });
});

describe("volver a la cuenta principal", () => {
  it("con la sesión prestada, vuelve", async () => {
    prismaMock.user.findUnique
      .mockResolvedValueOnce({ parentUserId: PADRE } as never)
      .mockResolvedValueOnce({ id: PADRE, email: "p@x.com", name: "Padre", slug: "p", tokenVersion: 0, suspended: false } as never);
    const r = await post("/api/subaccounts/volver", tokenPrestado(HIJA, PADRE));
    expect(r.status).toBe(200);
  });

  it("una sub-cuenta logueada NORMAL no puede saltar a la cuenta del padre", async () => {
    // Sin el sello parentId (que solo firma el server al entrar) no hay vuelta posible.
    const r = await post("/api/subaccounts/volver", tokenNormal(HIJA));
    expect(r.status).toBe(400);
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });

  it("si la cuenta dejó de depender del padre, tampoco vuelve", async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({ parentUserId: null } as never);
    expect((await post("/api/subaccounts/volver", tokenPrestado(HIJA, PADRE))).status).toBe(403);
  });
});

describe("crear sub-cuentas", () => {
  const datos = { email: "nueva@x.com", password: "123456", name: "Nueva", maxLines: 100 };

  it("sin cupo en el plan (maxSubAccounts = 0) no deja crear", async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({ id: PADRE, maxSubAccounts: 0, parentUserId: null, maxLines: 50 } as never);
    prismaMock.user.count.mockResolvedValueOnce(0 as never);
    const r = await post("/api/subaccounts", tokenNormal(PADRE), datos);
    expect(r.status).toBe(403);
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it("al llegar al máximo del plan, no deja crear más", async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({ id: PADRE, maxSubAccounts: 2, parentUserId: null, maxLines: 50 } as never);
    prismaMock.user.count.mockResolvedValueOnce(2 as never);
    expect((await post("/api/subaccounts", tokenNormal(PADRE), datos)).status).toBe(403);
  });

  it("una sub-cuenta NO puede crear sus propias sub-cuentas (sin cadenas)", async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({ id: HIJA, maxSubAccounts: 5, parentUserId: PADRE, maxLines: 10 } as never);
    expect((await post("/api/subaccounts", tokenNormal(HIJA), datos)).status).toBe(403);
  });

  it("desde una sesión prestada tampoco se crean", async () => {
    const r = await post("/api/subaccounts", tokenPrestado(HIJA, PADRE), datos);
    expect(r.status).toBe(403);
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });

  it("crea con el límite de números TOPEADO por el del padre (no se esquiva el plan)", async () => {
    prismaMock.user.findUnique
      .mockResolvedValueOnce({ id: PADRE, maxSubAccounts: 5, parentUserId: null, maxLines: 50 } as never)
      .mockResolvedValueOnce(null as never); // el email está libre
    prismaMock.user.count.mockResolvedValueOnce(0 as never);
    prismaMock.user.findFirst.mockResolvedValue(null as never); // slug libre
    prismaMock.user.create.mockResolvedValueOnce({ id: "u_nueva", email: datos.email, name: "Nueva", slug: "nueva", maxLines: 50 } as never);
    const r = await post("/api/subaccounts", tokenNormal(PADRE), datos);
    expect(r.status).toBe(201);
    const data = prismaMock.user.create.mock.calls[0][0].data as { maxLines: number; parentUserId: string; maxSubAccounts: number };
    expect(data.maxLines).toBe(50);          // pidió 100, el padre tiene 50
    expect(data.parentUserId).toBe(PADRE);
    expect(data.maxSubAccounts).toBe(0);     // la hija no arma su propia red
  });

  it("no permite dos cuentas con el mismo email", async () => {
    prismaMock.user.findUnique
      .mockResolvedValueOnce({ id: PADRE, maxSubAccounts: 5, parentUserId: null, maxLines: 50 } as never)
      .mockResolvedValueOnce({ id: "ya_existe" } as never);
    prismaMock.user.count.mockResolvedValueOnce(0 as never);
    expect((await post("/api/subaccounts", tokenNormal(PADRE), datos)).status).toBe(409);
  });
});
