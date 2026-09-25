// Tickets de soporte que quedaron SIN RESPUESTA DE VERDAD.
//
// Por qué existe (2026-09-25): una clienta preguntó el 24 a las 12:45, el robot le mandó el acuse,
// ella insistió dos veces ("gracias, espero la respuesta" / "ayer envié un msj") y nadie le contestó
// nunca. El tablero decía "0 esperando", porque **el acuse del robot cuenta como mensaje nuestro** y
// el ticket parecía atendido. 35 horas esperando, invisible.
//
// Regla: un acuse automático NO es una respuesta. Si lo último que recibió el cliente lo mandó el
// robot, el ticket sigue abierto y hay que avisar.
import { prisma } from "./prisma.js";

// A partir de acá el silencio ya es un problema (el acuse promete respuesta "a la brevedad").
export const HORAS_SIN_RESPONDER = Number(process.env.SOPORTE_ALERTA_HORAS ?? "4");

export interface TicketColgado {
  userId: string;
  email: string;
  horas: number;
  ultimoDelCliente: string;
}

/**
 * Clientes cuyo último mensaje recibido es del CLIENTE o del ROBOT (nunca una respuesta real),
 * pasadas `horas`. Ordenados del que más espera al que menos.
 */
export async function ticketsSinResponder(horas: number = HORAS_SIN_RESPONDER): Promise<TicketColgado[]> {
  const desde = new Date(Date.now() - 30 * 24 * 3600e3);
  const msgs = await prisma.supportMessage.findMany({
    where: { createdAt: { gte: desde } },
    orderBy: { createdAt: "asc" },
    select: { userId: true, fromAdmin: true, auto: true, body: true, createdAt: true },
  });

  const porCliente = new Map<string, typeof msgs>();
  for (const m of msgs) {
    if (!porCliente.has(m.userId)) porCliente.set(m.userId, []);
    porCliente.get(m.userId)!.push(m);
  }

  const corte = Date.now() - horas * 3600e3;
  const out: TicketColgado[] = [];
  for (const [userId, lista] of porCliente) {
    // Última respuesta HUMANA nuestra. El acuse del robot no cuenta.
    const respuestaReal = [...lista].reverse().find((m) => m.fromAdmin && !m.auto);
    const ultimoDelCliente = [...lista].reverse().find((m) => !m.fromAdmin);
    if (!ultimoDelCliente) continue; // nunca escribió: nada que responder
    // Si contestamos DESPUÉS de su último mensaje, está atendido.
    if (respuestaReal && respuestaReal.createdAt > ultimoDelCliente.createdAt) continue;
    if (ultimoDelCliente.createdAt.getTime() > corte) continue; // todavía dentro del plazo
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    out.push({
      userId,
      email: u?.email ?? userId,
      horas: Math.round((Date.now() - ultimoDelCliente.createdAt.getTime()) / 3600e3),
      ultimoDelCliente: ultimoDelCliente.body.replace(/\s+/g, " ").slice(0, 180),
    });
  }
  return out.sort((a, b) => b.horas - a.horas);
}

/** Texto del aviso. Aparte para poder testearlo sin red ni base. */
export function textoTicketsColgados(tickets: TicketColgado[]): string {
  const l = [
    tickets.length === 1
      ? "Hay 1 cliente esperando respuesta en soporte:"
      : `Hay ${tickets.length} clientes esperando respuesta en soporte:`,
    "",
  ];
  for (const t of tickets.slice(0, 5)) {
    l.push(`• ${t.email} — hace ${t.horas} h`);
    l.push(`  "${t.ultimoDelCliente}"`);
  }
  if (tickets.length > 5) l.push(`…y ${tickets.length - 5} más.`);
  l.push("");
  l.push("(El acuse automático no cuenta como respuesta: estos siguen sin contestar.)");
  return l.join("\n");
}
