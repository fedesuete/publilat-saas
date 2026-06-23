import { motion, useReducedMotion, type Variants } from "framer-motion";
import { Check, ArrowRight } from "lucide-react";
import { PhoneFrame } from "./ui/Frame";
import { Reveal } from "./ui/Reveal";
import { REGISTER_URL } from "../config";

type Line =
  | { kind: "in"; text: string; time: string }
  | { kind: "out"; text: string; time: string }
  | { kind: "img"; time: string }
  | { kind: "sys"; text: string };

const LINES: Line[] = [
  { kind: "in", text: "Hola! Vi el anuncio 👀 ¿cómo compro?", time: "20:41" },
  { kind: "sys", text: "✓ Lead enviado a Meta (CAPI)" },
  { kind: "out", text: "¡Hola! Te paso los datos para la transferencia 🙌", time: "20:41" },
  { kind: "img", time: "20:44" },
  { kind: "sys", text: "💰 Comprobante detectado por IA · ₲ 150.000" },
  { kind: "out", text: "¡Recibido! Activamos tu pedido 🎉", time: "20:44" },
  { kind: "sys", text: "✓ Purchase enviado a Meta · optimiza por compradores" },
];

export default function ChatDemo() {
  const reduce = useReducedMotion();

  const container: Variants = {
    hidden: {},
    show: { transition: { staggerChildren: reduce ? 0 : 0.5 } },
  };
  const item: Variants = {
    hidden: { opacity: 0, y: reduce ? 0 : 12 },
    show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: "easeOut" } },
  };

  return (
    <section className="mx-auto max-w-7xl px-4 py-24 sm:px-6">
      <div className="grid items-center gap-12 lg:grid-cols-2">
        <Reveal>
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-wa-green">
              Demo del loop en vivo
            </span>
            <h2 className="mt-4 text-3xl font-bold text-white sm:text-4xl">
              Del clic al <span className="gradient-text">Purchase</span>, sin tocar nada
            </h2>
            <p className="mt-4 max-w-md text-slate-400">
              Mirá cómo un chat real se convierte en una venta que Meta entiende: el clic dispara
              el Lead, la IA detecta el comprobante y la compra vuelve a Meta por la Conversions
              API — con el mismo identificador para que matchee.
            </p>
            <ul className="mt-6 space-y-2 text-sm text-slate-300">
              {["Lead automático al hacer clic", "Detección de comprobante con IA", "Purchase real a Meta por CAPI"].map(
                (t) => (
                  <li key={t} className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-wa-green" /> {t}
                  </li>
                ),
              )}
            </ul>
            <a href={REGISTER_URL} className="btn-primary mt-7">
              Probar el loop gratis <ArrowRight className="h-4 w-4" />
            </a>
          </div>
        </Reveal>

        <Reveal delay={0.1}>
          <PhoneFrame>
            <div className="bg-[#0b141a]">
              {/* header del chat */}
              <div className="flex items-center gap-3 bg-[#202c33] px-4 py-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-wa-green text-sm font-bold text-ink">
                  C
                </span>
                <div>
                  <div className="text-sm font-semibold text-white">Cliente</div>
                  <div className="text-[11px] text-emerald-300">en línea</div>
                </div>
              </div>

              {/* mensajes */}
              <motion.div
                variants={container}
                initial="hidden"
                whileInView="show"
                viewport={{ once: true, margin: "-60px" }}
                className="flex min-h-[360px] flex-col gap-2 px-3 py-4"
              >
                {LINES.map((l, i) => {
                  if (l.kind === "sys") {
                    return (
                      <motion.div key={i} variants={item} className="mx-auto my-1">
                        <span className="rounded-full bg-wa-green/15 px-3 py-1 text-[11px] font-medium text-wa-green">
                          {l.text}
                        </span>
                      </motion.div>
                    );
                  }
                  if (l.kind === "img") {
                    return (
                      <motion.div key={i} variants={item} className="flex justify-start">
                        <div className="max-w-[72%] rounded-lg rounded-tl-sm bg-[#202c33] p-1.5">
                          <div className="flex h-28 w-40 flex-col items-center justify-center rounded-md bg-gradient-to-br from-slate-700 to-slate-800 text-center">
                            <span className="text-2xl">🧾</span>
                            <span className="mt-1 text-[10px] text-slate-300">Comprobante.jpg</span>
                            <span className="text-[10px] text-slate-500">Transferencia ₲150.000</span>
                          </div>
                          <div className="mt-1 pr-1 text-right text-[10px] text-slate-400">{l.time}</div>
                        </div>
                      </motion.div>
                    );
                  }
                  const out = l.kind === "out";
                  return (
                    <motion.div key={i} variants={item} className={`flex ${out ? "justify-end" : "justify-start"}`}>
                      <div
                        className={`max-w-[78%] rounded-lg px-3 py-2 text-sm ${
                          out ? "rounded-tr-sm bg-[#005c4b] text-white" : "rounded-tl-sm bg-[#202c33] text-slate-100"
                        }`}
                      >
                        <div>{l.text}</div>
                        <div className="mt-0.5 text-right text-[10px] text-slate-300/70">{l.time}</div>
                      </div>
                    </motion.div>
                  );
                })}
              </motion.div>
            </div>
          </PhoneFrame>
        </Reveal>
      </div>
    </section>
  );
}
