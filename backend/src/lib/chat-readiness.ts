// Qué le falta a una cuenta para que su Chat App funcione DE VERDAD.
//
// Esta lista ya existía, pero solo la veía el admin: el cliente configuraba, le quedaba algo a medias
// y se enteraba por un reclamo días después. Los dos tickets del 25/09 son exactamente eso:
//   · Una clienta cargó el link de su plataforma pero tenía el bot APAGADO. Ese botón viaja con el
//     mensaje de usuario y clave que arma el bot, así que ningún jugador lo veía nunca. Ella lo
//     leyó como una falla del sistema.
//   · Otra preguntó si el pixel funciona mandando la publicidad al Chat App. Depende del LINK: el de
//     registro atribuye, el de chat directo entra anónimo y el pixel queda ciego. Con el link
//     equivocado, una campaña entera no reporta ni una conversión.
//
// Por eso ahora la misma revisión se le muestra al cliente en su panel, con el problema Y su
// consecuencia en criollo. La idea es que nadie tenga que abrir un ticket para enterarse.
import { prisma } from "./prisma.js";

export interface ItemRevision {
  key: string;
  ok: boolean;
  detalle: string;
}
export interface AvisoRevision {
  nivel: "error" | "aviso";
  titulo: string;
  texto: string;
}

export async function chatReadiness(userId: string) {
  const [u, credit, lines, pixel] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        slug: true, brandName: true, botEnabled: true, botPaymentInfo: true, chatPayCbu: true, chatPayAlias: true,
        chatPlatformUrl: true, chatDayEnabled: true, chatDayExpiresAt: true, casinoApiKey: true, casinoAutoCredit: true,
      },
    }),
    prisma.credit.findUnique({ where: { userId }, select: { days: true } }),
    prisma.waLine.count({ where: { userId, status: "active", expiresAt: { gt: new Date() } } }),
    prisma.pixel.findFirst({ where: { userId }, select: { id: true } }),
  ]);
  if (!u) return null;
  const chatDayActivo = Boolean(u.chatDayExpiresAt && u.chatDayExpiresAt > new Date());

  const items: ItemRevision[] = [
    { key: "dias", ok: (credit?.days ?? 0) > 0 || chatDayActivo || lines > 0, detalle: `${credit?.days ?? 0} día(s) de saldo` },
    { key: "canal_activo", ok: chatDayActivo || lines > 0, detalle: chatDayActivo ? "día de Chat App vigente" : lines > 0 ? `${lines} línea(s) de WhatsApp activa(s)` : "sin día ni línea: el chat está apagado" },
    { key: "marca", ok: Boolean(u.brandName), detalle: u.brandName ?? "sin nombre de marca" },
    { key: "bot", ok: u.botEnabled, detalle: u.botEnabled ? "bot prendido" : "bot apagado" },
    { key: "datos_de_pago", ok: Boolean(u.chatPayCbu || u.chatPayAlias || u.botPaymentInfo || u.casinoApiKey), detalle: u.casinoApiKey ? "CVU de la recaudadora (casino)" : (u.chatPayCbu || u.chatPayAlias) ? "CBU/alias propios" : "sin datos de pago" },
    { key: "plataforma_de_juego", ok: Boolean(u.chatPlatformUrl), detalle: u.chatPlatformUrl ?? "sin link de plataforma" },
    { key: "pixel", ok: Boolean(pixel), detalle: pixel ? "pixel cargado" : "sin pixel: no se miden los eventos de Meta" },
  ];

  // Combinaciones que se ven "bien" campo por campo pero NO funcionan juntas. Son las que generaron
  // los reclamos: cada una dice qué pasa y qué hacer, no solo qué falta.
  const avisos: AvisoRevision[] = [];
  if (u.chatPlatformUrl && !u.botEnabled) {
    avisos.push({
      nivel: "error",
      titulo: "Cargaste el link de tu plataforma pero el bot está apagado",
      texto:
        "El botón «🎮 Entrar a la plataforma» viaja junto con el mensaje de usuario y clave, y ese mensaje lo arma el bot. " +
        "Con el bot apagado, tus jugadores nunca lo reciben. Prendé el bot acá abajo, o mandá tu publicidad al link de registro.",
    });
  }
  if (!pixel) {
    avisos.push({
      nivel: "aviso",
      titulo: "Todavía no cargaste tu pixel",
      texto: "Sin pixel, Meta no se entera de los registros ni de las cargas, así que la publicidad no aprende a quién mostrarle tus anuncios.",
    });
  }
  if (!chatDayActivo && lines === 0) {
    avisos.push({
      nivel: "error",
      titulo: "Tu chat está apagado",
      texto: "El Chat App necesita un día vigente (de una línea de WhatsApp o del propio Chat App). Sin eso, tus jugadores no pueden entrar.",
    });
  }

  const chatBase = (process.env.CHAT_PWA_URL ?? "https://chat.publi.lat").replace(/\/$/, "");
  return {
    listo: items.every((i) => i.ok),
    items,
    avisos,
    casino: { keyPropia: Boolean(u.casinoApiKey), autoCredit: u.casinoAutoCredit },
    // Cuál de los dos links usar NO es un detalle: define si la publicidad se puede medir o no.
    links: {
      registro: {
        url: `${chatBase}/r/${u.slug}`,
        titulo: "Para tu publicidad",
        texto: "El jugador se registra y Meta recibe el registro y la compra. Es el que hace que la publicidad aprenda.",
      },
      chatDirecto: {
        url: `${chatBase}/c/${u.slug}`,
        titulo: "Para atención",
        texto: "Entra directo al chat, sin registrarse. Sirve para responder consultas, pero Meta NO ve nada: no lo uses en anuncios.",
      },
    },
  };
}
