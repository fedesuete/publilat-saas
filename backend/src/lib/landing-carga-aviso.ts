// Envío del aviso de una carga de landing al WhatsApp del dueño (2026-10-19). Sale desde la línea de SOPORTE
// (cuenta soportesoft365) para que le llegue como un chat aparte, con notificación, y no mezclado con sus
// clientes. Si esa línea no está conectada, cae a la primera línea conectada de un ADMIN (como signup-notify).
// Best-effort: nunca lanza; devuelve true si salió.
import { prisma } from "./prisma.js";
import { getEngine } from "./wa-engine.js";

const DESTINO = () => (process.env.LANDING_NOTIFY_PHONE ?? "595975112248").replace(/\D/g, "");
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
