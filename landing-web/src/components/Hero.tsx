import { motion } from "framer-motion";
import { ArrowRight, MessageCircle, ShieldCheck } from "lucide-react";
import { REGISTER_URL, WHATSAPP_URL } from "../config";
import DashboardMock from "./DashboardMock";
import { Counter } from "./ui/Counter";

const STATS = [
  { to: 10, suffix: "K+", label: "eventos atribuidos" },
  { to: 4, suffix: "", label: "países LATAM" },
  { to: 24, suffix: "/7", label: "atribución activa" },
];

export default function Hero() {
  return (
    <section id="top" className="relative pt-28 sm:pt-36">
      {/* halos de fondo que "respiran" */}
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="halo absolute -top-32 right-0 h-[36rem] w-[36rem] animate-breathe" />
        <div className="halo absolute top-40 -left-40 h-[28rem] w-[28rem] animate-breathe [animation-delay:2s]" />
      </div>

      <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-2">
        <div>
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-slate-300"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-wa-green" />
            Atribución WhatsApp → Meta Ads con Conversions API
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.05 }}
            className="text-4xl font-extrabold leading-[1.1] tracking-tight text-white sm:text-5xl lg:text-6xl"
          >
            Convertí tus chats de WhatsApp en{" "}
            <span className="gradient-text">ventas que Meta entiende.</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.12 }}
            className="mt-5 max-w-xl text-lg text-slate-300"
          >
            Optimizá por <strong className="text-white">facturación real</strong>, no por costo por
            mensaje. Publi.lat le devuelve a Meta la venta de WhatsApp y escalás por compradores
            de verdad.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="mt-8 flex flex-wrap items-center gap-3"
          >
            <a href={REGISTER_URL} className="btn-primary animate-ctaGlow">
              Crear mi cuenta <ArrowRight className="h-4 w-4" />
            </a>
            <a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer" className="btn-ghost">
              <MessageCircle className="h-4 w-4" /> Pedí una demo
            </a>
          </motion.div>

          {/* Stats con contadores */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.34 }}
            className="mt-10 grid max-w-md grid-cols-3 gap-4"
          >
            {STATS.map((s) => (
              <div key={s.label}>
                <div className="text-2xl font-extrabold text-white sm:text-3xl">
                  <Counter to={s.to} suffix={s.suffix} />
                </div>
                <div className="text-xs text-slate-400">{s.label}</div>
              </div>
            ))}
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.3 }}
            className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-slate-400"
          >
            <span className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-wa-green" /> Eventos validados con Meta
            </span>
            <span className="flex items-center gap-2">
              <span className="text-wa-green">★★★★★</span> Negocios que venden por WhatsApp
            </span>
          </motion.div>
        </div>

        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.15 }}
          className="flex justify-center lg:justify-end"
        >
          <DashboardMock />
        </motion.div>
      </div>
    </section>
  );
}
