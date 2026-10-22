// Aviso de un lead CALIFICADO de landing al dueño (2026-10-19 WhatsApp; 2026-10-22 + correo). Dos canales que NO
// dependen el uno del otro: si falla WhatsApp, el correo sale igual (y al revés).
//   - WhatsApp: desde la línea de SOPORTE (cuenta soportesoft365) para que le llegue como un chat aparte, con
//     notificación; si esa línea no está conectada, cae a la primera línea conectada de un ADMIN.
//   - Correo: por el SMTP que ya usa publi.lat (lib/mailer), con el link wa.me clickeable.
// Best-effort: nunca lanza.
import { prisma } from "./prisma.js";
import { getEngine } from "./wa-engine.js";
import { sendMail } from "./mailer.js";
import { textoAvisoCarga, htmlAvisoCarga, tituloAviso, type DatosAviso } from "./landing-carga.js";

const DESTINO = () => (process.env.LANDING_NOTIFY_PHONE ?? "595975112248").replace(/\D/g, "");
const DESTINO_CORREO = () => process.env.LANDING_NOTIFY_EMAIL ?? "federicobogado1997@gmail.com";
const DESDE_EMAIL = () => process.env.LANDING_NOTIFY_FROM_EMAIL ?? "soportesoft365@gmail.com";

async function lineaDeAviso(): Promise<string | null> {
  const base = { provider: { not: "cloud" }, connected: true, status: "active", sessionId: { not: null } } as const;
  const soporte = await prisma.waLine.findFirst({
    where: { ...base, user: { is: { email: DESDE_EMAIL() } } },
    select: { sessionId: true },
    orderBy: { createdAt: "asc" },
  });
  if (soporte?.sessionId) return soporte.sessionId;
  const admin = await prisma.waLine.findFirst({
    where: { ...base, user: { is: { role: "ADMIN" } } },
    select: { sessionId: true },
    orderBy: { createdAt: "asc" },
  });
  return admin?.sessionId ?? null;
}

export async function enviarAvisoCarga(texto: string): Promise<boolean> {
  const destino = DESTINO();
  if (!destino) return false;
  try {
    const session = await lineaDeAviso();
    if (!session) {
      console.warn("[landing-carga] no hay línea conectada para mandar el aviso");
      return false;
    }
    await getEngine().sendText(session, destino, texto);
    return true;
  } catch (e) {
    console.error("[landing-carga] aviso por WhatsApp falló:", e instanceof Error ? e.message : String(e));
    return false;
  }
}

export async function enviarAvisoCorreo(d: DatosAviso): Promise<boolean> {
  const ok = await sendMail(DESTINO_CORREO(), tituloAviso(d), textoAvisoCarga(d).replace(/\*/g, "").replace(/_/g, ""), htmlAvisoCarga(d));
  if (!ok) console.warn("[landing-carga] aviso por correo no salió");
  return ok;
}

/** Manda el aviso por los DOS canales a la vez, sin que uno dependa del otro. */
export async function avisarLeadCalificado(d: DatosAviso): Promise<{ whatsapp: boolean; correo: boolean }> {
  const [wa, mail] = await Promise.allSettled([enviarAvisoCarga(textoAvisoCarga(d)), enviarAvisoCorreo(d)]);
  return { whatsapp: wa.status === "fulfilled" && wa.value, correo: mail.status === "fulfilled" && mail.value };
}
