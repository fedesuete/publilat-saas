// Modo calentamiento: rampa de salientes para líneas Baileys recién emparejadas.
// WhatsApp filtra/banea números nuevos que arrancan con volumen (incidente fortune,
// tanda Luckysoft): los primeros días la línea solo debería RESPONDER y de a poco.
// La rampa limita los envíos por sistema en una ventana móvil de 24 h; al terminar
// la rampa (o si el usuario la desactiva) no hay límite.
import { prisma } from "./prisma.js";
import { notify } from "./notifications.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_CAPS = [20, 50, 100, 200, 400]; // envíos/24h para el día 1..5 de la línea

// Cupos configurables por .env: WARMUP_DAILY_CAPS="20,50,100,200,400" (día 1..N).
function dailyCaps(): number[] {
  const raw = process.env.WARMUP_DAILY_CAPS ?? "";
  const parsed = raw
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isInteger(n) && n > 0);
  return parsed.length ? parsed : DEFAULT_CAPS;
}

export interface WarmupLine {
  id: string;
  provider: string;
  warmupEnabled: boolean;
  warmupStartedAt: Date | null;
  label?: string | null;
  phone?: string | null;
  userId?: string;
}

export interface WarmupState {
  active: boolean; // true si la línea está dentro de la rampa
  day?: number; // día de vida de la línea (1..N)
  totalDays?: number; // largo de la rampa
  cap?: number; // cupo de envíos en 24h para hoy
  used?: number; // envíos de las últimas 24h
}

// Estado de la rampa (para el gate y para mostrar en el panel).
export async function warmupState(line: WarmupLine): Promise<WarmupState> {
  if (line.provider !== "baileys" || !line.warmupEnabled || !line.warmupStartedAt) {
    return { active: false };
  }
  const caps = dailyCaps();
  const day = Math.floor((Date.now() - line.warmupStartedAt.getTime()) / DAY_MS) + 1;
  if (day < 1 || day > caps.length) return { active: false };
  // Ventana móvil de 24 h, pero nunca antes del arranque de la rampa: al cambiar de chip
  // (warmupStartedAt se resetea) los envíos del número ANTERIOR no cuentan contra el nuevo.
  const from = new Date(Math.max(Date.now() - DAY_MS, line.warmupStartedAt.getTime()));
  const used = await prisma.message.count({
    where: { lineId: line.id, direction: "out", createdAt: { gte: from } },
  });
  return { active: true, day, totalDays: caps.length, cap: caps[day - 1], used };
}

export type WarmupGate = { ok: true } | { ok: false; reason: string };

// Gate de envío: bloquea cuando la línea en calentamiento agotó el cupo de 24 h.
// Cuenta TODO lo saliente de la línea (CRM, flujos y el espejo del teléfono):
// para WhatsApp el volumen del número es uno solo.
export async function checkWarmupGate(line: WarmupLine): Promise<WarmupGate> {
  const st = await warmupState(line);
  if (!st.active || (st.used ?? 0) < (st.cap ?? Infinity)) return { ok: true };
  const reason =
    `Línea en calentamiento (día ${st.day} de ${st.totalDays}): alcanzó el cupo de ` +
    `${st.cap} envíos en 24 h. El cupo sube solo con los días; si es urgente, respondé ` +
    `desde el teléfono (el mensaje se espeja al CRM).`;
  // Aviso in-app al dueño (una vez cada 12 h por línea, para no hacer spam).
  if (line.userId) {
    const title = `Línea "${line.label || line.phone || line.id}" en calentamiento`;
    const recent = await prisma.notification.findFirst({
      where: { userId: line.userId, title, createdAt: { gte: new Date(Date.now() - 12 * 60 * 60 * 1000) } },
      select: { id: true },
    });
    if (!recent) await notify(line.userId, "system", title, reason);
  }
  return { ok: false, reason };
}
