import { LOGIN_URL, REGISTER_URL, WHATSAPP_URL } from "../config";

export default function Footer() {
  return (
    <footer className="border-t border-white/10 bg-ink2/60">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-12 sm:px-6 md:grid-cols-5">
        <div className="md:col-span-2">
          <a href="#top" className="flex items-center gap-2 text-lg font-extrabold text-white">
            <img src="/favicon.svg" alt="" className="h-7 w-7" />
            Publi<span className="gradient-text">.lat</span>
          </a>
          <p className="mt-3 max-w-sm text-sm text-slate-400">
            Atribución de WhatsApp a Meta Ads. Convertí tus chats en ventas que el algoritmo
            entiende y optimizá por compradores reales.
          </p>
        </div>

        <div>
          <div className="text-sm font-semibold text-white">Producto</div>
          <ul className="mt-3 space-y-2 text-sm text-slate-400">
            <li><a href="#caracteristicas" className="hover:text-white">Características</a></li>
            <li><a href="#como-funciona" className="hover:text-white">Cómo funciona</a></li>
            <li><a href="#precios" className="hover:text-white">Precios</a></li>
          </ul>
        </div>

        <div>
          <div className="text-sm font-semibold text-white">Cuenta</div>
          <ul className="mt-3 space-y-2 text-sm text-slate-400">
            <li><a href={LOGIN_URL} className="hover:text-white">Ingresar</a></li>
            <li><a href={REGISTER_URL} className="hover:text-white">Crear cuenta</a></li>
            <li><a href={WHATSAPP_URL} className="hover:text-white">Contacto</a></li>
          </ul>
        </div>

        <div>
          <div className="text-sm font-semibold text-white">Legal</div>
          <ul className="mt-3 space-y-2 text-sm text-slate-400">
            <li><a href="/privacidad" className="hover:text-white">Privacidad</a></li>
            <li><a href="/terminos" className="hover:text-white">Términos</a></li>
            <li><a href="/eliminacion-datos" className="hover:text-white">Eliminación de datos</a></li>
          </ul>
        </div>
      </div>

      <div className="border-t border-white/10 py-6 text-center text-xs text-slate-500">
        © 2026 Publi.lat — Todos los derechos reservados.
      </div>
    </footer>
  );
}
