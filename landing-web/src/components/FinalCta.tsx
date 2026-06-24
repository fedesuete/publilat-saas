import { ArrowRight } from "lucide-react";
import { Reveal } from "./ui/Reveal";
import { REGISTER_URL, WHATSAPP_URL } from "../config";

export default function FinalCta() {
  return (
    <section className="mx-auto max-w-7xl px-4 pb-24 sm:px-6">
      <Reveal>
        <div className="card-border glow relative overflow-hidden px-6 py-16 text-center sm:px-12">
          <div className="pointer-events-none absolute inset-0 -z-10">
            <div className="halo absolute left-1/2 top-0 h-[24rem] w-[24rem] -translate-x-1/2" />
          </div>
          <h2 className="mx-auto max-w-2xl text-3xl font-extrabold text-white sm:text-4xl">
            Dejá de adivinar. <span className="gradient-text">Empezá a escalar.</span>
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-slate-300">
            Conectá tu Pixel, tu WhatsApp y tus anuncios en minutos. La primera venta que vuelva a
            Meta cambia cómo optimizás para siempre.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <a href={REGISTER_URL} className="btn-primary animate-ctaGlow">
              Crear mi cuenta <ArrowRight className="h-4 w-4" />
            </a>
            <a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer" className="btn-ghost">
              Pedí una demo
            </a>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
