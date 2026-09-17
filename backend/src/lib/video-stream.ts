// backend/src/lib/video-stream.ts
// 2026-09-17: helpers para servir video desde disco con Range (seek) sin dejar descriptores huérfanos.
//
// Contexto: /api/tutorial-video hacía `fs.createReadStream(...).pipe(res)`. Cuando el navegador corta un
// pedido de rango (seek, cambio de pestaña, buffer lleno), `pipe` desengancha la respuesta pero NO destruye
// la fuente: el archivo queda abierto para siempre. Un cliente con el <video> en loop dejó el proceso con
// 2.200 descriptores abiertos sobre 5 mp4. `stream.pipeline` destruye TODOS los streams ante un cierre
// prematuro de cualquiera de ellos.
import { pipeline } from "node:stream";
import type { Readable, Writable } from "node:stream";

export type Rango = { status: 200 | 206; start: number; end: number } | { status: 416 };

/** Traduce la cabecera Range a un tramo [start, end] del archivo de `total` bytes. */
export function rangoDeCabecera(header: string | undefined, total: number): Rango {
  if (typeof header !== "string") return { status: 200, start: 0, end: total - 1 };
  const m = /bytes=(\d*)-(\d*)/.exec(header);
  let start = m && m[1] ? parseInt(m[1], 10) : 0;
  let end = m && m[2] ? parseInt(m[2], 10) : total - 1;
  if (!Number.isFinite(start) || start < 0) start = 0;
  if (!Number.isFinite(end) || end >= total) end = total - 1;
  if (start > end) return { status: 416 };
  return { status: 206, start, end };
}

/**
 * Manda `fuente` a `res`. Si el cliente corta antes de terminar, la fuente se destruye (se cierra el fd).
 * `alTerminar` recibe el error si lo hubo (un "premature close" del cliente es esperable y no se loguea).
 */
export function enviarStream(fuente: Readable, res: Writable, alTerminar?: (err?: NodeJS.ErrnoException | null) => void): void {
  pipeline(fuente, res, (err) => {
    if (!fuente.destroyed) fuente.destroy();
    alTerminar?.(err ?? null);
  });
}
