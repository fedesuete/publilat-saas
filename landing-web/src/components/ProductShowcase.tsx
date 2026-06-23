import { useRef, type ReactNode } from "react";
import { motion, useReducedMotion, useScroll, useTransform } from "framer-motion";
import { Check } from "lucide-react";
import { Reveal } from "./ui/Reveal";
import { BrowserFrame } from "./ui/Frame";
import DashboardMock from "./DashboardMock";
import { KanbanMock, InboxMock, PaymentMock } from "./mocks";

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
    tag: "Dashboard",
    title: "Tu ROAS real, en vivo",
    desc: "Clics, chats, ventas y retorno por campaña, conjunto y anuncio. Ventana de hoy, semana y mes.",
    bullets: ["Métricas en tiempo real", "ROAS por campaña/anuncio", "Eventos Lead y Purchase"],
    url: "app.publi.lat/dashboard",
    mock: <DashboardMock />,
  },
  {
    tag: "CRM",
    title: "Kanban con montos de venta",
    desc: "Arrastrá cada lead por su etapa y marcá la compra con el valor. El Purchase sale a Meta con el mismo identificador.",
    bullets: ["Etapas arrastrables", "Monto por venta", "Atribución por contacto"],
    url: "app.publi.lat/kanban",
    mock: <KanbanMock />,
  },
  {
    tag: "Inbox",
    title: "Todos los chats, con su atribución",
    desc: "Atendé desde un solo lugar. Cada conversación muestra de qué anuncio vino y su código de seguimiento.",
    bullets: ["Multi-línea unificado", "Lead atribuido al instante", "Imágenes y comprobantes"],
    url: "app.publi.lat/inbox",
    mock: <InboxMock />,
  },
  {
    tag: "IA",
    title: "Detección de pago con IA",
    desc: "La IA lee el comprobante (imagen o PDF), extrae el monto y te lo deja listo para confirmar — o dispara la compra solo.",
    bullets: ["Lee imagen y PDF", "Extrae monto y moneda", "Confirmás con 1 clic"],
    url: "app.publi.lat/leads",
    mock: <PaymentMock />,
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
          {p.tag === "Dashboard" ? (
            <div className="flex justify-center">{p.mock}</div>
          ) : (
            <BrowserFrame url={p.url}>{p.mock}</BrowserFrame>
          )}
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
          Mirá el producto <span className="gradient-text">funcionando</span>
        </h2>
        <p className="mx-auto mt-3 max-w-2xl text-center text-slate-400">
          Todo lo que necesitás para cerrar el loop, en un solo lugar.
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
