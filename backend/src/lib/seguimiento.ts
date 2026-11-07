// SEGUIMIENTO AUTOMÁTICO (07/11, pedido del dueño): el sistema trabaja solo sobre el CRM.
//  1) Leads que se enfriaron: escribieron alguna vez, NOSOTROS mandamos el último mensaje y no
//     contestaron → reciben los pasos configurados (ej. a 1, 2 y 4 días del mensaje anterior). Si
//     contestan, pasan a Compró/Perdido o se terminan los pasos, no se les escribe más.
//  2) Lista importada (source "lista"): primer mensaje de a poco; si no contestan, entran al punto 1.
// Cuida la línea: tope diario, ventana horaria, un envío por tick con pausa al azar, y frena solo si no
// hay línea activa. Corre por la cola (job "seguimiento", cada 5 min). Nada de esto toca la atribución.
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";
import { parseVariants, pickVariant, sendLeadVariant, type LeadReplyVariant } from "./leadgen-send.js";
import { renderLeadReply } from "./lead-template.js";

export interface PasoSeguimiento { afterDays: number; variants: LeadReplyVariant[] }

const DIA_MS = 24 * 3600 * 1000;

export function parsePasos(raw: unknown): PasoSeguimiento[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((p) => {
      const o = (p ?? {}) as Record<string, unknown>;
      const afterDays = Number(o.afterDays);
      return { afterDays: Number.isFinite(afterDays) && afterDays > 0 ? afterDays : 1, variants: parseVariants(o.variants) };
    })
    .filter((p) => p.variants.length > 0);
}

/** Hora local (0-23) en la zona de la cuenta. */
export function horaLocal(tz: string, now = new Date()): number {
  try {
    const h = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).format(now);
    return Number(h) % 24;
  } catch {
    return now.getUTCHours();
  }
}

export function dentroDeVentana(cfg: { hourFrom: number; hourTo: number; tz: string }, now = new Date()): boolean {
  const h = horaLocal(cfg.tz, now);
  return cfg.hourFrom <= cfg.hourTo ? h >= cfg.hourFrom && h < cfg.hourTo : h >= cfg.hourFrom || h < cfg.hourTo;
}

/** Paso que le toca a un lead frío (índice), o null si todavía no le toca o ya los recibió todos. */
export function pasoQueToca(pasos: PasoSeguimiento[], hechos: number, ultimoNuestro: Date, now = new Date()): number | null {
  if (hechos >= pasos.length) return null;
  return now.getTime() - ultimoNuestro.getTime() >= pasos[hechos].afterDays * DIA_MS ? hechos : null;
}

/** Teléfono importado → solo dígitos (8 a 15), o null. */
export function telefonoLista(raw: string): string | null {
  const d = raw.replace(/\D/g, "");
  return d.length >= 8 && d.length <= 15 ? d : null;
}

/** Texto pegado o CSV → filas {nombre, telefono}. Una por línea: "Nombre, 5959…" o solo el número. */
export function parsearLista(texto: string): { filas: Array<{ name: string | null; phone: string }>; invalidas: number } {
  const filas: Array<{ name: string | null; phone: string }> = [];
  let invalidas = 0;
  const vistos = new Set<string>();
  for (const linea of texto.split(/\r?\n/)) {
    if (!linea.trim()) continue;
    const m = linea.match(/\+?[\d][\d\s().-]{6,}\d/);
    const phone = m ? telefonoLista(m[0]) : null;
    if (!phone) { invalidas++; continue; }
    if (vistos.has(phone)) continue;
    vistos.add(phone);
    const name = linea.replace(m![0], "").replace(/[,;\t"]+/g, " ").replace(/\s+/g, " ").trim() || null;
    filas.push({ name: name && !/^(nombre|name|tel[eé]fono|phone)$/i.test(name) ? name.slice(0, 80) : null, phone });
  }
  return { filas, invalidas };
}

// Línea activa para salir: la de la config, la del contacto, o la activa menos usada.
async function lineaActiva(userId: string, preferidas: Array<string | null>): Promise<string | null> {
  const base = { userId, connected: true, status: "active", NOT: { phone: "" }, expiresAt: { gt: new Date() } };
  for (const id of preferidas) {
    if (!id) continue;
    const l = await prisma.waLine.findFirst({ where: { ...base, id }, select: { id: true } });
    if (l) return l.id;
  }
  const any = await prisma.waLine.findFirst({ where: base, orderBy: { lastUsedAt: { sort: "asc", nulls: "first" } }, select: { id: true } });
  return any?.id ?? null;
}

interface Candidato { contactId: string; kind: "seguimiento" | "lista"; step: number; variants: LeadReplyVariant[] }

// Leads fríos: último mensaje de la charla es NUESTRO, dentro de maxAgeDays, y alguna vez escribieron
// (o les llegó el primer mensaje de la lista). Fuera: Compró/Perdido, Kommo, y los que tienen una
// secuencia de Automatizaciones en curso (su propio recontacto ya se encarga).
export async function leadsFrios(userId: string, maxAgeDays: number): Promise<Array<{ contactId: string; lastAt: Date; hechos: number }>> {
  return prisma.$queryRaw<Array<{ contactId: string; lastAt: Date; hechos: number }>>(Prisma.sql`
    WITH ult AS (
      SELECT DISTINCT ON (m."contactId") m."contactId", m.direction, m."createdAt"
      FROM "Message" m JOIN "Contact" c ON c.id = m."contactId"
      WHERE c."userId" = ${userId}
        AND c.stage IN ('NUEVO', 'CONTACTADO', 'INTERESADO')
        AND c.phone IS NOT NULL
        AND COALESCE(c.source, '') NOT IN ('kommo', 'an')
        AND m."createdAt" > (now() at time zone 'UTC') - make_interval(days => ${maxAgeDays + 1})
      ORDER BY m."contactId", m."createdAt" DESC
    )
    SELECT u."contactId", u."createdAt" AS "lastAt",
      (SELECT count(*) FROM "FollowUpTouch" t WHERE t."contactId" = u."contactId" AND t.kind = 'seguimiento')::int AS hechos
    FROM ult u
    WHERE u.direction = 'out'
      AND u."createdAt" > (now() at time zone 'UTC') - make_interval(days => ${maxAgeDays})
      AND (EXISTS (SELECT 1 FROM "Message" i WHERE i."contactId" = u."contactId" AND i.direction = 'in')
           OR EXISTS (SELECT 1 FROM "FollowUpTouch" l WHERE l."contactId" = u."contactId" AND l.kind = 'lista' AND l.ok))
      AND NOT EXISTS (SELECT 1 FROM "FlowRun" r WHERE r."contactId" = u."contactId" AND r.status IN ('running', 'waiting'))
    ORDER BY u."createdAt" ASC
    LIMIT 500`);
}

async function proximoCandidato(cfg: { userId: string; steps: unknown; listVariants: unknown; maxAgeDays: number }): Promise<Candidato | null> {
  const pasos = parsePasos(cfg.steps);
  if (pasos.length) {
    for (const f of await leadsFrios(cfg.userId, cfg.maxAgeDays)) {
      // Prisma devuelve el timestamp sin zona como si fuera UTC (así se guarda): la resta es directa.
      const step = pasoQueToca(pasos, f.hechos, new Date(f.lastAt));
      if (step != null) return { contactId: f.contactId, kind: "seguimiento", step, variants: pasos[step].variants };
    }
  }
  const lv = parseVariants(cfg.listVariants);
  if (lv.length) {
    const c = await prisma.contact.findFirst({
      where: { userId: cfg.userId, source: "lista", stage: "NUEVO", phone: { not: null }, messages: { none: {} } },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    if (c) {
      const ya = await prisma.followUpTouch.findUnique({ where: { contactId_kind_step: { contactId: c.id, kind: "lista", step: 0 } }, select: { id: true } });
      if (!ya) return { contactId: c.id, kind: "lista", step: 0, variants: lv };
    }
  }
  return null;
}

// Un tick para una cuenta: como mucho UN envío. Devuelve qué pasó (para logs y tests).
export async function tickCuenta(userId: string, now = new Date()): Promise<string> {
  const cfg = await prisma.followUpConfig.findUnique({ where: { userId } });
  if (!cfg?.enabled) return "apagado";
  if (!dentroDeVentana(cfg, now)) return "fuera de horario";
  const hoy = await prisma.followUpTouch.count({ where: { userId, createdAt: { gte: new Date(now.getTime() - DIA_MS) } } });
  if (hoy >= cfg.dailyCap) return "tope diario";
  const ultimo = await prisma.followUpTouch.findFirst({ where: { userId }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
  const gapMs = cfg.minGapMin * 60_000 * (1 + Math.random()); // entre minGap y el doble: no queda un ritmo fijo
  if (ultimo && now.getTime() - ultimo.createdAt.getTime() < gapMs) return "pausa";

  const cand = await proximoCandidato(cfg);
  if (!cand) return "nadie";
  const contact = await prisma.contact.findUnique({ where: { id: cand.contactId }, select: { id: true, name: true, lineId: true } });
  if (!contact) return "nadie";
  const lineId = await lineaActiva(userId, [cfg.lineId, contact.lineId]);
  if (!lineId) {
    await prisma.followUpConfig.update({ where: { userId }, data: { lastError: "Sin línea activa: el seguimiento queda frenado hasta que conectes una." } });
    return "sin línea";
  }
  if (contact.lineId !== lineId) await prisma.contact.update({ where: { id: contact.id }, data: { lineId } });

  // El registro va ANTES del envío (unique por contacto+paso): dos procesos nunca le mandan lo mismo.
  let touchId: string;
  try {
    touchId = (await prisma.followUpTouch.create({ data: { userId, contactId: contact.id, kind: cand.kind, step: cand.step, ok: false }, select: { id: true } })).id;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return "ya enviado";
    throw e;
  }
  const variant = pickVariant(cand.variants)!;
  const text = variant.kind === "text" ? renderLeadReply(variant.body, { name: contact.name, phone: null, email: null, answers: [] }) : undefined;
  let ok = false;
  try {
    ok = await sendLeadVariant(userId, contact.id, variant, text);
  } catch (e) {
    console.error("[seguimiento] error enviando:", e instanceof Error ? e.message : String(e));
  }
  await prisma.followUpTouch.update({ where: { id: touchId }, data: { ok } });
  if (ok && cand.kind === "lista") await prisma.contact.updateMany({ where: { id: contact.id, stage: "NUEVO" }, data: { stage: "CONTACTADO" } });
  await prisma.followUpConfig.update({ where: { userId }, data: { lastError: ok ? null : "El último envío falló (número sin WhatsApp o línea trabada)." } });
  console.log(`[seguimiento] ${cand.kind} paso ${cand.step + 1} → ${ok ? "enviado" : "falló"} (contacto ${contact.id})`);
  return ok ? "enviado" : "falló";
}

// Job de la cola: todas las cuentas con el seguimiento prendido. Una cuenta que falla no frena al resto.
export async function correrSeguimiento(): Promise<void> {
  const cuentas = await prisma.followUpConfig.findMany({ where: { enabled: true }, select: { userId: true } });
  for (const c of cuentas) {
    await tickCuenta(c.userId).catch((e) => console.error("[seguimiento] cuenta falló:", e instanceof Error ? e.message : String(e)));
  }
}
