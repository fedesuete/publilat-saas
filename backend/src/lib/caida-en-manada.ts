// CAÍDA EN MANADA: muchas líneas de clientes distintos cayéndose en pocos minutos.
//
// Por qué existe (2026-09-26): todas las líneas pasaron a salir por la IP del servidor (el proxy
// residencial costaba una fortuna y encima causaba más problemas de los que resolvía). La contra de
// esa decisión es que ahora comparten una sola IP: si WhatsApp llegara a limitarla, se caerían TODAS
// juntas. Hasta hoy nada distinguía "se cayó una línea" de "se cayó la infraestructura", así que eso
// se descubriría por un reclamo.
//
// Una línea suelta que se cae es normal. Cinco líneas de CLIENTES DISTINTOS en diez minutos no lo es:
// eso es la IP, el servidor o WhatsApp, y hay que enterarse en el momento.
//
// La cuenta se lleva por CLIENTE, no por línea: un cliente que tiene cinco números y los reinicia
// todos juntos no es una manada, es un cliente haciendo algo.
const VENTANA_MS = Number(process.env.MANADA_VENTANA_MIN ?? "10") * 60_000;
export const MANADA_UMBRAL = Number(process.env.MANADA_UMBRAL ?? "5");
const REAVISO_MS = 60 * 60_000; // no repetir el aviso más de una vez por hora

interface Caida { lineId: string; userId: string; at: number }
const caidas: Caida[] = [];
let ultimoAviso = 0;

export function registrarCaida(lineId: string, userId: string, now: number = Date.now()): void {
  caidas.push({ lineId, userId, at: now });
  // Poda: solo interesa la ventana reciente.
  const corte = now - VENTANA_MS;
  while (caidas.length && caidas[0].at < corte) caidas.shift();
}

/** Cuántos CLIENTES distintos tuvieron una caída en la ventana. */
export function clientesCaidos(now: number = Date.now()): number {
  const corte = now - VENTANA_MS;
  return new Set(caidas.filter((c) => c.at >= corte).map((c) => c.userId)).size;
}

export function lineasCaidas(now: number = Date.now()): number {
  const corte = now - VENTANA_MS;
  return new Set(caidas.filter((c) => c.at >= corte).map((c) => c.lineId)).size;
}

/**
 * ¿Hay que dar la alarma? Solo si se pasó el umbral de CLIENTES distintos y no avisamos hace poco.
 * Marca el aviso como dado (no es una consulta pura a propósito: evita que dos caídas simultáneas
 * disparen dos alarmas).
 */
export function reclamaAlarma(now: number = Date.now()): { clientes: number; lineas: number } | null {
  if (clientesCaidos(now) < MANADA_UMBRAL) return null;
  if (now - ultimoAviso < REAVISO_MS) return null;
  ultimoAviso = now;
  return { clientes: clientesCaidos(now), lineas: lineasCaidas(now) };
}

/** Para los tests: vacía el registro. */
export function reiniciarManada(): void {
  caidas.length = 0;
  ultimoAviso = 0;
}

export function textoManada(clientes: number, lineas: number, minutos: number): string {
  return (
    `Se cayeron ${lineas} líneas de ${clientes} clientes distintos en ${minutos} minutos.\n\n` +
    `Eso NO es normal: una línea suelta se cae sola, pero varias de clientes distintos a la vez apunta ` +
    `a algo compartido — la IP del servidor, el servidor mismo o WhatsApp.\n\n` +
    `Qué mirar, en orden:\n` +
    `1. ¿Vuelven solas en unos minutos? Entonces fue un corte pasajero.\n` +
    `2. Si NO vuelven y ninguna logra conectar, puede ser la IP del servidor. Se arregla pidiéndole ` +
    `una IP nueva al proveedor del VPS, o volviendo a poner proxies.\n` +
    `3. Si el panel tampoco responde, es el servidor: ver el RUNBOOK.`
  );
}
