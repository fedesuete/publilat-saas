// Ruleta de premios del Chat App (2026-10-11): lógica pura (sin base) — validar porciones, elegir el
// resultado y decidir si el jugador puede girar. El resultado lo decide SIEMPRE el servidor.
import crypto from "node:crypto";
import { z } from "zod";

export const TIPOS_PREMIO = ["fichas", "giro", "nada"] as const;
export type TipoPremio = (typeof TIPOS_PREMIO)[number];

export const segmentoSchema = z.object({
  label: z.string().trim().min(1).max(30),
  color: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/),
  icon: z.string().trim().max(8).default(""),
  type: z.enum(TIPOS_PREMIO),
  amount: z.number().int().min(0).max(10_000_000), // fichas en ARS entero (solo cuenta en "fichas")
  weight: z.number().int().min(0).max(100), // probabilidad en %
});
export type Segmento = z.infer<typeof segmentoSchema>;

export const segmentosSchema = z
  .array(segmentoSchema)
  .min(2, "La ruleta necesita al menos 2 porciones.")
  .max(12, "Máximo 12 porciones.")
  .refine((s) => s.reduce((t, x) => t + x.weight, 0) === 100, "Las probabilidades tienen que sumar 100%.")
  .refine((s) => s.every((x) => x.type !== "fichas" || x.amount > 0), "Las porciones de fichas necesitan un monto mayor a 0.");

// Plantilla inicial (la del ejemplo que pasó el dueño): suma 100%.
export const PLANTILLA: Segmento[] = [
  { label: "5.000 Fichas", color: "#3498db", icon: "⭐", type: "fichas", amount: 5000, weight: 12 },
  { label: "2.000 Fichas", color: "#2ecc71", icon: "🍀", type: "fichas", amount: 2000, weight: 18 },
  { label: "1.000 Fichas", color: "#9b59b6", icon: "🎲", type: "fichas", amount: 1000, weight: 20 },
  { label: "500 Fichas", color: "#e67e22", icon: "🎁", type: "fichas", amount: 500, weight: 15 },
  { label: "Gira Gratis", color: "#1abc9c", icon: "🔄", type: "giro", amount: 0, weight: 10 },
  { label: "Sin Premio", color: "#95a5a6", icon: "😅", type: "nada", amount: 0, weight: 15 },
  { label: "200 Fichas", color: "#e74c3c", icon: "🪙", type: "fichas", amount: 200, weight: 10 },
];

/** Elige la porción según su probabilidad. `r` en [0, 100) — por defecto aleatorio criptográfico. */
export function elegirPorcion(segmentos: Segmento[], r = crypto.randomInt(0, 10_000) / 100): number {
  let acum = 0;
  for (let i = 0; i < segmentos.length; i++) {
    acum += segmentos[i].weight;
    if (r < acum) return i;
  }
  // Redondeos: la última porción con probabilidad > 0.
  for (let i = segmentos.length - 1; i >= 0; i--) if (segmentos[i].weight > 0) return i;
  return 0;
}

// Argentina no tiene horario de verano: el día arranca a las 03:00 UTC.
const OFFSET_AR_MS = 3 * 3600 * 1000;
export function inicioDelDiaAR(now: Date): Date {
  const local = new Date(now.getTime() - OFFSET_AR_MS);
  local.setUTCHours(0, 0, 0, 0);
  return new Date(local.getTime() + OFFSET_AR_MS);
}

export interface RuletaEstado { status: string; endsAt: Date | null; durationMin: number; round: number }

export function ruletaActiva(w: RuletaEstado | null, now = new Date()): boolean {
  return !!w && w.status === "active" && (!w.endsAt || w.endsAt > now);
}

/**
 * Giros del jugador que cuentan para la ventana actual: con duración, los de esta activación (round);
 * sin duración, los de hoy. Devuelve el filtro para la consulta.
 */
export function ventanaDeGiros(w: RuletaEstado, now = new Date()): { round: number } | { round: number; createdAt: { gte: Date } } {
  return w.durationMin > 0 ? { round: w.round } : { round: w.round, createdAt: { gte: inicioDelDiaAR(now) } };
}

// Tope de giros por ventana aunque salgan "Gira Gratis" seguidos (cortafuegos ante una mala configuración).
export const MAX_GIROS_POR_VENTANA = 5;

/** Puede girar si no giró en la ventana, o si su último giro fue "Gira Gratis" (y no pasó el tope). */
export function puedeGirar(girosVentana: { prizeType: string; createdAt: Date }[]): boolean {
  if (!girosVentana.length) return true;
  if (girosVentana.length >= MAX_GIROS_POR_VENTANA) return false;
  const ultimo = [...girosVentana].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  return ultimo.prizeType === "giro";
}

/** Lo que ve el jugador (sin probabilidades: eso es del operador). */
export function porcionesPublicas(segmentos: Segmento[]) {
  return segmentos.map((s) => ({ label: s.label, color: s.color, icon: s.icon }));
}
