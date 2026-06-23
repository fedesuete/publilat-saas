import { useRef, type ReactNode } from "react";
import { motion, useReducedMotion, useScroll, useTransform } from "framer-motion";
import { Check } from "lucide-react";
import { Reveal } from "./ui/Reveal";
import { BrowserFrame } from "./ui/Frame";
import { CajerosMock, PlayersKanbanMock, InboxMock, BotMock } from "./mocks";

interface Product {
  tag: string;
  title: string;
  desc: string;
  bullets: string[];
  url: string;
  mock: ReactNode;
}

const PRODUCTS: Product[] = [
  {
    tag: "Cajeros",
    title: "Tus cajeros, bajo control",
    desc: "Cargas, retiros y saldos de cada caja en tiempo real. Turnos, límites y un historial auditable de cada movimiento.",
    bullets: ["Cargas y retiros por caja", "Saldos y arqueo en vivo", "Historial auditable"],
    url: "app.publi.lat/cajeros",
    mock: <CajerosMock />,
  },
  {
    tag: "CRM",
    title: "Seguí a cada jugador",
    desc: "Un kanban con tus jugadores por etapa: nuevos, activos y VIP. Mirá quién deposita, quién se enfría y a quién reactivar.",
    bullets: ["Etapas arrastrables", "Segmentación y VIP", "Historial de cada jugador"],
    url: "app.publi.lat/jugadores",
    mock: <PlayersKanbanMock />,
  },
  {
    tag: "Inbox",
    title: "Todos los chats en un lugar",
    desc: "Atendé WhatsApp y Telegram desde un solo Inbox, con varios agentes y el historial del jugador siempre al lado.",
    bullets: ["WhatsApp + Telegram", "Multi-agente", "Historial del jugador"],
    url: "app.publi.lat/inbox",
    mock: <InboxMock />,
  },
  {
    tag: "Bot IA",
    title: "Un bot que acredita solo",
    desc: "Atiende 24/7, lee el comprobante (imagen o PDF), valida el monto y acredita la carga al instante. Tus cajeros descansan.",
    bullets: ["Atención 24/7", "Lee imagen y PDF", "Acredita la carga sola"],
    url: "app.publi.lat/bot",
    mock: <BotMock />,
  },
];

function Row({ p, i }: { p: Product; i: number }) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const y = useTransform(scrollYProgress, [0, 1], reduce ? [0, 0] : [40, -40]);
  const reversed = i % 2 === 1;

  return (
    <div ref={ref} className="grid items-center gap-10 lg:grid-cols-2">
      {/* texto */}
      <Reveal className={reversed ? "lg:order-2" : ""}>
        <div>
          <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-wa-green">
            {p.tag}
          </span>
          <h3 className="mt-4 text-2xl font-bold text-white sm:text-3xl">{p.title}</h3>
          <p className="mt-3 max-w-md text-slate-400">{p.desc}</p>
          <ul className="mt-5 space-y-2 text-sm text-slate-300">
            {p.bullets.map((b) => (
              <li key={b} className="flex items-center gap-2">
                <Check className="h-4 w-4 text-wa-green" /> {b}
              </li>
            ))}
          </ul>
        </div>
      </Reveal>

      {/* mockup con parallax */}
      <motion.div style={{ y }} className={reversed ? "lg:order-1" : ""}>
        <Reveal delay={0.05}>
          <BrowserFrame url={p.url}>{p.mock}</BrowserFrame>
        </Reveal>
      </motion.div>
    </div>
  );
}

export default function ProductShowcase() {
  return (
    <section id="productos" className="mx-auto max-w-7xl px-4 py-24 sm:px-6">
      <Reveal>
        <h2 className="text-center text-3xl font-bold text-white sm:text-4xl">
          Mirá la plataforma <span className="gradient-text">funcionando</span>
        </h2>
        <p className="mx-auto mt-3 max-w-2xl text-center text-slate-400">
          Todo lo que tu operación necesita, en un solo lugar.
        </p>
      </Reveal>

      <div className="mt-16 space-y-24">
        {PRODUCTS.map((p, i) => (
          <Row key={p.tag} p={p} i={i} />
        ))}
      </div>
    </section>
  );
}
