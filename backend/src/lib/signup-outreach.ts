// Embudo de REGISTRO (pedido del dueño 2026-09-04): al que crea su cuenta en Publi.lat y deja su
// teléfono le escribimos AL TOQUE por WhatsApp desde la cuenta del dueño ("vi que te registraste…"),
// para ayudarlo a arrancar y de paso venderle — antes era 100% manual y los registros se enfriaban.
//
// Es un funnel APARTE: el contacto nace con source="registro", que está excluido de la bienvenida
// orgánica y de las secuencias (flow-engine) — así nunca se le cruza otro mensaje automático encima.
// Tras este primer mensaje, la charla la sigue una persona.
//
// Best-effort: jamás frena ni ensucia el alta (cualquier error solo se loguea).
import crypto from "node:crypto";
import { prisma } from "./prisma.js";
import { sendLeadVariant } from "./leadgen-send.js";
import { renderLeadReply } from "./lead-template.js";

const OWNER_EMAIL = process.env.SIGNUP_OUTREACH_OWNER ?? "federicobogado1997@gmail.com";

// Variantes rotativas (mensajes idénticos en masa = patrón de bot para WhatsApp).
const VARIANTES = [
  "Hola {{nombre}}! 👋 Soy Fede, de Publi.lat. Vi que recién creaste tu cuenta — ¿ya pudiste conectar tu línea de WhatsApp? Contame qué estás buscando hacer y te dejo todo andando en 5 minutos.",
  "¡Buenas {{nombre}}! Fede de Publi.lat por acá 🙌 Vi tu registro y te escribo para ayudarte a arrancar: ¿qué necesitás — anuncios con atribución, CRM, chat propio? Decime y lo configuramos juntos, es un toque.",
  "Hola {{nombre}}, ¿cómo va? Soy Fede de Publi.lat 🚀 Vi que te registraste. Si algo del arranque te trabó, escribime y lo resolvemos ahora — contame de tu negocio y te digo la mejor forma de sacarle el jugo.",
];

export async function sendRegistrationOutreach(u: { name?: string | null; email: string; phone?: string | null }): Promise<void> {
  try {
    const phone = (u.phone ?? "").replace(/\D/g, "");
    if (phone.length < 8) return; // sin teléfono usable, no hay a quién escribir
    const owner = await prisma.user.findFirst({ where: { email: OWNER_EMAIL }, select: { id: true, email: true } });
    if (!owner || owner.email === u.email) return;

    const line = await prisma.waLine.findFirst({
      where: { userId: owner.id, connected: true, status: "active", provider: { not: "cloud" }, expiresAt: { gt: new Date() } },
      select: { id: true },
      orderBy: { lastUsedAt: { sort: "asc", nulls: "first" } },
    });
    if (!line) { console.warn("[registro-outreach] sin línea activa del dueño — no se contacta a", u.email); return; }

    // ¿Ya lo conocemos por ese teléfono (en cualquiera de sus formas argentinas)? Si además ya hay
    // conversación, NO metemos un mensaje automático en el medio de una charla humana.
    const candidatos = new Set([phone]);
    if (phone.length === 10) candidatos.add("549" + phone);
    if (phone.startsWith("54") && !phone.startsWith("549")) candidatos.add("549" + phone.slice(2));
    const existing = await prisma.contact.findFirst({
      where: { userId: owner.id, phone: { in: [...candidatos] } },
      select: { id: true },
      orderBy: { createdAt: "desc" },
    });
    if (existing) {
      const hist = await prisma.message.findFirst({ where: { contactId: existing.id }, select: { id: true } });
      if (hist) return; // charla previa: lo dejamos en manos humanas
    }
    const contact = existing ?? await prisma.contact.create({
      data: {
        userId: owner.id,
        externalId: crypto.randomUUID(),
        phone,
        name: u.name?.trim() || null,
        lineId: line.id,
        source: "registro",
        stage: "NUEVO",
      },
      select: { id: true },
    });
    await prisma.contact.updateMany({ where: { id: contact.id, lineId: null }, data: { lineId: line.id } });

    const tpl = VARIANTES[Math.floor(Math.random() * VARIANTES.length)];
    const text = renderLeadReply(tpl, { name: u.name ?? null, phone: null, email: u.email, answers: [] });
    // sendLeadVariant resuelve el JID canónico (agrega el 9 argentino si falta) antes de enviar.
    const ok = await sendLeadVariant(owner.id, contact.id, { kind: "text", body: text }, text);
    if (ok) {
      await prisma.contact.updateMany({ where: { id: contact.id, stage: "NUEVO" }, data: { stage: "CONTACTADO" } });
      console.log(`[registro-outreach] contactado el registro de ${u.email}`);
    } else {
      console.warn(`[registro-outreach] no salió el mensaje al registro de ${u.email} (número sin WhatsApp o línea trabada)`);
    }
  } catch (e) {
    console.error("[registro-outreach] error:", e instanceof Error ? e.message : String(e));
  }
}
