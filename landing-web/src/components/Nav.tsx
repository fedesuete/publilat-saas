import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import { LOGIN_URL, REGISTER_URL } from "../config";

const LINKS = [
  { href: "#caracteristicas", label: "Características" },
  { href: "#como-funciona", label: "Cómo funciona" },
  { href: "#precios", label: "Precios" },
];

export default function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-all ${
        scrolled ? "border-b border-white/10 bg-ink/80 backdrop-blur-xl" : "border-b border-transparent"
      }`}
    >
      <nav className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
        <a href="#top" className="flex items-center gap-2 text-lg font-extrabold text-white">
          <img src="/favicon.svg" alt="" className="h-7 w-7" />
          Publi<span className="gradient-text">.lat</span>
        </a>

        <div className="hidden items-center gap-8 md:flex">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} className="text-sm font-medium text-slate-300 transition hover:text-white">
              {l.label}
            </a>
          ))}
        </div>

        <div className="hidden items-center gap-3 md:flex">
          <a href={LOGIN_URL} className="text-sm font-semibold text-slate-200 transition hover:text-white">
            Ingresar
          </a>
          <a href={REGISTER_URL} className="btn-primary px-5 py-2 text-sm">
            Crear cuenta
          </a>
        </div>

        <button
          className="rounded-md p-2 text-slate-200 md:hidden"
          onClick={() => setOpen((v) => !v)}
          aria-label="Menú"
        >
          {open ? <X size={22} /> : <Menu size={22} />}
        </button>
      </nav>

      {open && (
        <div className="border-t border-white/10 bg-ink/95 px-4 py-4 md:hidden">
          <div className="flex flex-col gap-3">
            {LINKS.map((l) => (
              <a
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="rounded-md px-2 py-2 text-slate-200 hover:bg-white/5"
              >
                {l.label}
              </a>
            ))}
            <a href={LOGIN_URL} className="btn-ghost mt-1 py-2 text-sm">
              Ingresar
            </a>
            <a href={REGISTER_URL} className="btn-primary py-2 text-sm">
              Crear cuenta
            </a>
          </div>
        </div>
      )}
    </header>
  );
}
