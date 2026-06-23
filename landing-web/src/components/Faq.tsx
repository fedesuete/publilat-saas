import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Plus } from "lucide-react";
import { Reveal } from "./ui/Reveal";

const FAQS = [
  {
    q: "¿Necesito instalar algo o saber de programación?",
    a: "No. Publi funciona en la nube: entrás desde el navegador, conectás tu WhatsApp/Telegram y empezás a operar. Te acompañamos en la puesta en marcha.",
  },
  {
    q: "¿Cómo acredita el bot las cargas?",
    a: "El jugador manda el comprobante (imagen o PDF). La IA lo lee, valida el monto y acredita la carga al instante, dejando todo registrado en caja. Podés dejarlo automático o que un cajero confirme con un clic.",
  },
  {
    q: "¿Puedo manejar varias marcas y varios cajeros?",
    a: "Sí. Operás múltiples marcas y cajas desde un solo panel, con datos separados, roles y permisos para cada cajero, supervisor y admin.",
  },
  {
    q: "¿Qué medios de pago soporta?",
    a: "Los que ya usás en LATAM: Bancard, Tigo Money, Ueno, transferencias bancarias y USDT (red Tron/TRC20). Cada movimiento queda con su comprobante.",
  },
  {
    q: "¿Mis datos y los de mis jugadores están seguros?",
    a: "Sí. Accesos por rol, registro auditable de cada carga y retiro, y respaldo nivel producción. Cada quien ve solo lo que le corresponde.",
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
