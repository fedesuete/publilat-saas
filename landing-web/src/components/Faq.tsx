import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Plus } from "lucide-react";
import { Reveal } from "./ui/Reveal";

const FAQS = [
  {
    q: "¿Necesito saber de programación o de la API de Meta?",
    a: "No. Cargás tu Pixel y tu token de Conversions API una vez (te guiamos paso a paso) y Publi.lat se encarga del resto: dispara los eventos Lead y Purchase por vos.",
  },
  {
    q: "¿Sirve si vendo por WhatsApp con varias personas/líneas?",
    a: "Sí. Podés conectar varias líneas de WhatsApp y el sistema reparte los clics entre ellas con rotación automática. Todos los chats caen en un Inbox unificado.",
  },
  {
    q: "¿Cómo sabe Meta que la persona compró?",
    a: "Cuando marcás la venta (o la IA detecta el comprobante), enviamos el evento Purchase por la Conversions API con el mismo identificador del clic original. Así Meta hace el match y optimiza por compradores reales.",
  },
  {
    q: "¿Qué medios de pago puedo usar para cargar días?",
    a: "MercadoPago, Stripe (tarjeta) y USDT (cripto, red Tron/TRC20) directo a tu wallet. 1 día = 1 línea activa por 24 horas.",
  },
  {
    q: "¿La detección de pago por comprobante es confiable?",
    a: "La IA lee la imagen o el PDF y extrae el monto. Podés dejarla en modo semi-automático (te lo resalta y confirmás con 1 clic) o automático. Nunca manda una compra falsa a Meta si no hay confianza alta.",
  },
];

function Item({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="card-border overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
        aria-expanded={open}
      >
        <span className="font-medium text-white">{q}</span>
        <Plus
          className={`h-5 w-5 shrink-0 text-wa-green transition-transform duration-300 ${open ? "rotate-45" : ""}`}
        />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: "easeInOut" }}
          >
            <p className="px-5 pb-5 text-sm leading-relaxed text-slate-400">{a}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function Faq() {
  return (
    <section className="mx-auto max-w-3xl px-4 py-24 sm:px-6">
      <Reveal>
        <h2 className="text-center text-3xl font-bold text-white sm:text-4xl">
          Preguntas <span className="gradient-text">frecuentes</span>
        </h2>
      </Reveal>
      <div className="mt-10 space-y-3">
        {FAQS.map((f, i) => (
          <Reveal key={f.q} delay={i * 0.05}>
            <Item q={f.q} a={f.a} />
          </Reveal>
        ))}
      </div>
    </section>
  );
}
