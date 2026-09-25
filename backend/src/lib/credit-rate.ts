// "Tengo 26 días" NO quiere decir 26 jornadas: CADA número prendido consume su propio día. Con 3
// números, 26 días son 9 jornadas.
//
// Por qué existe (2026-09-25): un cliente compró 60 días creyendo que eran dos meses. Tenía dos
// números prendidos (uno normal y uno de WhatsApp oficial), gastaba 2,07 días por jornada, y se le
// acabaron en 29 días de calendario. La cuenta cuadraba perfecto —60 entraron, 60 salieron— pero él
// vivió el servicio como si le hubieran robado la mitad. El panel le mostraba "días" y él leía
// "jornadas". Hoy hay tres clientes más en la misma situación.
//
// Se muestra en el panel junto al saldo y se dice en el aviso de saldo bajo.

/** Jornadas completas que aguanta el saldo con N números prendidos. Sin números, los días no se gastan. */
export function jornadasRestantes(dias: number, lineasActivas: number): number {
  if (dias <= 0) return 0;
  if (lineasActivas <= 0) return dias; // nada prendido: no se consume
  return Math.floor(dias / lineasActivas);
}

/**
 * La frase que ve el cliente. Devuelve null cuando no hay nada que aclarar (0 o 1 número: días y
 * jornadas son lo mismo y agregar texto solo confunde).
 */
export function textoRitmo(dias: number, lineasActivas: number): string | null {
  if (lineasActivas <= 1) return null;
  const j = jornadasRestantes(dias, lineasActivas);
  return `Tenés ${lineasActivas} números prendidos: se consumen ${lineasActivas} días por jornada, ` +
    `así que te alcanzan para ${j} ${j === 1 ? "jornada" : "jornadas"}.`;
}
