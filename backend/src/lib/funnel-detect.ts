// Motor de detección del EMBUDO: mira los mensajes de la conversación y detecta los 2 momentos que
// disparan eventos a Meta. Estrategia HÍBRIDA por costo:
//   a) PATRÓN (primario, GRATIS): regex/keywords sobre el texto.
//   b) IA (respaldo, solo si el patrón no matchea): clasificador liviano SI/NO, best-effort + timeout.
//   c) OCR (comprobante): el monto se lee con analyzeReceipt (ai-receipt.ts) — lo usa la Fase 5.
// Todo es best-effort e idempotente en el caller; NUNCA frena el flujo de mensajes si falla.
import { classifyYesNo, aiEnabled } from "./ai-receipt.js";

// ============ Momento 1: el OPERADOR entregó las CREDENCIALES (usuario + clave) → Registro ============
// Requiere un término de "usuario" Y uno de "clave" en el mismo mensaje (evita falsos positivos con
// solo "usuario"). Casos típicos del cajero: "usuario: juan123  clave: 4567", "tu user y password son…".
const USER_RX = /\b(usuario|user|ingres[oa]|acceso|nick|apodo)\b/i;
const PASS_RX = /\b(clave|contrase[ñn]a|password|\bpass\b|\bpin\b|contra)\b/i;

// Señal por PATRÓN (gratis): ¿el texto tiene un término de usuario Y uno de clave?
export function credentialsSignal(text: string): boolean {
  if (!text) return false;
  return USER_RX.test(text) && PASS_RX.test(text);
}

// ¿El mensaje del OPERADOR le está dando el acceso al jugador? Patrón primero; si no, IA de respaldo.
// Best-effort: si la IA no está o falla, cae al patrón (false). No lanza.
export async function looksLikeCredentials(text: string): Promise<boolean> {
  if (credentialsSignal(text)) return true;
  if (!text || !aiEnabled()) return false;
  const ai = await classifyYesNo(
    text,
    "Este es un mensaje de un operador de casino a un jugador. ¿Le está entregando sus DATOS DE ACCESO (usuario y contraseña) para ingresar a jugar?",
  );
  return ai === true;
}
