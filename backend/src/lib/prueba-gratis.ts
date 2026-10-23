// Prueba gratis de 5 días del CRM (landing de publi.lat, 2026-10-22). Sin tarjeta.
//   - otorgarPrueba: al registrarse desde la landing se le cargan 5 días al crédito (UNA prueba por número de
//     WhatsApp: User.trialPhone es único) y queda la fecha de fin.
//   - correrPrueba (job cada 15 min): manda los tips del día 1, 3 y 5 por WhatsApp (línea del dueño, como el
//     "vi que te registraste") y por correo; el día 5 avisa que termina y deja el link para pagar. Al terminar
//     sin pagar, marca trialUnpaidAt (público de remarketing en Meta).
// Best-effort: un envío que falla no frena a los demás ni se reintenta (el paso queda marcado igual).
import crypto from "node:crypto";
import { prisma } from "./prisma.js";
import { sendMail } from "./mailer.js";
import { sendLeadVariant } from "./leadgen-send.js";

export const PRUEBA_DIAS = 5;
const OWNER_EMAIL = process.env.SIGNUP_OUTREACH_OWNER ?? "federicobogado1997@gmail.com";
const PANEL = () => (process.env.PANEL_BASE_URL?.split(",")[0] ?? "https://app.publi.lat").replace(/\/$/, "");

// Cuándo sale cada mensaje, en horas desde el registro. Día 1 = a las 2 h (el "vi que te registraste" ya
// salió al instante); día 3 = a las 48 h; día 5 = a las 96 h (arranca el último día).
const PASOS: { stage: number; horas: number }[] = [
  { stage: 1, horas: 2 },
  { stage: 2, horas: 48 },
  { stage: 3, horas: 96 },
];

/** El próximo mensaje que corresponde mandar (o null). Si se atrasó, manda solo el más reciente. */
export function pasoPendiente(inicio: Date, stage: number, ahora = new Date()): number | null {
  const horas = (ahora.getTime() - inicio.getTime()) / 3600e3;
  const vencidos = PASOS.filter((p) => p.stage > stage && horas >= p.horas);
  return vencidos.length ? vencidos[vencidos.length - 1].stage : null;
}

export function textoPaso(stage: number, nombre: string | null | undefined): { asunto: string; texto: string } {
  const n = nombre?.trim().split(/\s+/)[0] || "";
  const hola = n ? `Hola ${n}!` : "¡Hola!";
  const p = PANEL();
  if (stage === 1) return {
    asunto: "Tip del día 1: conectá tu número",
    texto: `${hola} 👋 Tip para tu primer día de prueba en Publi.lat: conectá tu número de WhatsApp (escaneás un QR, como en WhatsApp Web). Desde ese momento cada persona que te escribe queda guardada en el CRM con su historial.\n\n👉 ${p}/whatsapp`,
  };
  if (stage === 2) return {
    asunto: "Tip del día 3: sabé qué anuncio te trae cada venta",
    texto: `${hola} Tip del día 3 de tu prueba: creá un link rastreado (o una landing) y ponelo en tu anuncio. Cada contacto que entra queda marcado con el anuncio que lo trajo, y cuando marcás una venta, Meta recibe la compra real para optimizar.\n\n👉 ${p}/links`,
  };
  return {
    asunto: "Hoy termina tu prueba de Publi.lat",
    texto: `${hola} Hoy es el último día de tu prueba de 5 días. Para seguir sin cortes activá tus días: US$2 por día por número (Semana US$14 · Mes US$60). Si tenés dudas, respondé este mensaje.\n\n👉 ${p}/billing`,
  };
}

/** Clave inicial legible (sin 0/O/1/l). */
export function claveInicial(): string {
  const abc = "abcdefghjkmnpqrstuvwxyz23456789";
  const b = crypto.randomBytes(8);
  return Array.from(b, (x) => abc[x % abc.length]).join("");
}

/** Le escribe al registrado por WhatsApp desde la línea del dueño. Si hay charla en curso (mensaje en las
 *  últimas 6 h) no mete el automático en el medio. */
async function whatsappAlRegistrado(u: { name: string | null; phone: string | null }, texto: string): Promise<boolean> {
  const phone = (u.phone ?? "").replace(/\D/g, "");
  if (phone.length < 8) return false;
  const owner = await prisma.user.findFirst({ where: { email: OWNER_EMAIL }, select: { id: true } });
  if (!owner) return false;
  const line = await prisma.waLine.findFirst({
    where: { userId: owner.id, connected: true, status: "active", provider: { not: "cloud" }, expiresAt: { gt: new Date() } },
    select: { id: true },
    orderBy: { lastUsedAt: { sort: "asc", nulls: "first" } },
  });
  if (!line) return false;
  const candidatos = new Set([phone]);
  if (phone.startsWith("54") && !phone.startsWith("549")) candidatos.add("549" + phone.slice(2));
  let contact = await prisma.contact.findFirst({
    where: { userId: owner.id, phone: { in: [...candidatos] } },
    select: { id: true },
    orderBy: { createdAt: "desc" },
  });
  if (contact) {
    const reciente = await prisma.message.findFirst({
      where: { contactId: contact.id, createdAt: { gt: new Date(Date.now() - 6 * 3600e3) } },
      select: { id: true },
    });
    if (reciente) return false;
  } else {
    contact = await prisma.contact.create({
      data: { userId: owner.id, externalId: crypto.randomUUID(), phone, name: u.name?.trim() || null, lineId: line.id, source: "registro", stage: "CONTACTADO" },
      select: { id: true },
    });
  }
  return sendLeadVariant(owner.id, contact.id, { kind: "text", body: texto }, texto);
}

/** Correo de bienvenida con el acceso (la landing no pide clave: se genera y se le muestra/manda). */
export async function correoBienvenidaPrueba(u: { email: string; name: string | null; clave: string; fin: Date }): Promise<void> {
  const n = u.name?.trim().split(/\s+/)[0] || "";
  const fin = u.fin.toLocaleDateString("es-PY", { day: "numeric", month: "long", timeZone: "America/Asuncion" });
  const texto =
    `${n ? `Hola ${n}!` : "¡Hola!"} Tu prueba de ${PRUEBA_DIAS} días de Publi.lat está activa (hasta el ${fin}).\n\n` +
    `Entrá al panel: ${PANEL()}/login\nUsuario: ${u.email}\nClave: ${u.clave}\n\n` +
    `Primer paso: conectá tu número de WhatsApp en ${PANEL()}/whatsapp\n\n` +
    `Si necesitás ayuda, respondé este correo o escribinos por WhatsApp.`;
  await sendMail(u.email, `Tu prueba de ${PRUEBA_DIAS} días de Publi.lat está activa`, texto).catch(() => false);
}

/** Job: tips del día 1/3/5 + marca de "terminó sin pagar". */
export async function correrPrueba(): Promise<void> {
  const ahora = new Date();
  const enCurso = await prisma.user.findMany({
    where: { trialStartedAt: { not: null, gt: new Date(ahora.getTime() - 10 * 864e5) }, trialStage: { lt: 3 } },
    select: { id: true, email: true, name: true, phone: true, trialStartedAt: true, trialStage: true },
    take: 200,
  });
  for (const u of enCurso) {
    const paso = pasoPendiente(u.trialStartedAt!, u.trialStage, ahora);
    if (!paso) continue;
    // Candado: solo una corrida manda este paso.
    const tomado = await prisma.user.updateMany({ where: { id: u.id, trialStage: u.trialStage }, data: { trialStage: paso } });
    if (tomado.count !== 1) continue;
    if (paso === 3 && (await prisma.payment.findFirst({ where: { userId: u.id, status: "approved" }, select: { id: true } }))) continue; // ya pagó
    const { asunto, texto } = textoPaso(paso, u.name);
    const [wa, mail] = await Promise.all([
      whatsappAlRegistrado(u, texto).catch(() => false),
      sendMail(u.email, asunto, texto).catch(() => false),
    ]);
    console.log(`[prueba] paso ${paso} a user ${u.id}: whatsapp ${wa ? "ok" : "no"} · correo ${mail ? "ok" : "no"}`);
  }

  // Terminó la prueba sin pagar → marca para remarketing.
  const vencidas = await prisma.user.findMany({
    where: { trialEndsAt: { lt: ahora, gt: new Date(ahora.getTime() - 30 * 864e5) }, trialUnpaidAt: null },
    select: { id: true },
    take: 200,
  });
  for (const u of vencidas) {
    const pago = await prisma.payment.findFirst({ where: { userId: u.id, status: "approved" }, select: { id: true } });
    if (!pago) await prisma.user.update({ where: { id: u.id }, data: { trialUnpaidAt: ahora } });
  }
}
