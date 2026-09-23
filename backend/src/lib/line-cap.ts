// TOPE DIARIO por línea en la rotación: "a este número mandale como mucho 30 personas por día".
// Es el control manual que acompaña al peso automático por salud (line-weights.ts) y a la rampa de
// calentamiento (warmup.ts): el operador decide cuánta gente recibe cada número, para repartir y no
// quemar los nuevos.
//
// El contador vive en la propia WaLine (routedToday/routedTodayAt) en vez de contarse con una query:
// `pickLine` corre en CADA clic del anuncio y ya hace un update sobre la línea elegida, así que sumar
// uno ahí no cuesta nada. Sin tope (dailyCap = 0) el contador igual se lleva, y sirve de estadística.
//
// El "día" es el de Argentina/Paraguay (UTC-3), no el del servidor (UTC): si no, el cupo se
// reiniciaría a las 21:00 hora del cliente, en pleno horario de venta.

const OFFSET_HORAS = Number(process.env.BUSINESS_DAY_UTC_OFFSET ?? "-3");

export interface LineaConCupo {
  dailyCap: number;
  routedToday: number;
  routedTodayAt: Date | null;
}

/** Día del negocio (YYYY-MM-DD) para una fecha, en la zona del cliente. */
export function diaLocal(d: Date): string {
  return new Date(d.getTime() + OFFSET_HORAS * 3600_000).toISOString().slice(0, 10);
}

/** Cuántas personas se mandaron HOY a esta línea (0 si el contador es de un día anterior). */
export function usadoHoy(line: LineaConCupo, now: Date = new Date()): number {
  if (!line.routedTodayAt) return 0;
  return diaLocal(line.routedTodayAt) === diaLocal(now) ? line.routedToday : 0;
}

/** ¿Esta línea puede recibir otra persona hoy? Sin tope (0) siempre puede. */
export function tieneCupo(line: LineaConCupo, now: Date = new Date()): boolean {
  if (!line.dailyCap || line.dailyCap <= 0) return true;
  return usadoHoy(line, now) < line.dailyCap;
}

/** Valores para el update al asignarle un clic a la línea (reinicia solo al cambiar el día). */
export function sumarClic(line: LineaConCupo, now: Date = new Date()): { routedToday: number; routedTodayAt: Date } {
  return { routedToday: usadoHoy(line, now) + 1, routedTodayAt: now };
}

/**
 * Reparte los candidatos en los que todavía tienen cupo y los que ya llegaron al tope.
 * Si NINGUNO tiene cupo devolvemos igual todas las líneas: un clic sin línea es un lead perdido que
 * el cliente ya pagó en Meta. El tope reparte el tráfico, no apaga el negocio; cuando pasa, se avisa.
 */
export function elegibles<T extends LineaConCupo>(candidatas: T[], now: Date = new Date()): { pool: T[]; todasAlTope: boolean } {
  const conCupo = candidatas.filter((l) => tieneCupo(l, now));
  if (conCupo.length) return { pool: conCupo, todasAlTope: false };
  return { pool: candidatas, todasAlTope: candidatas.length > 0 };
}
