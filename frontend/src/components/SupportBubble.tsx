import { useLocation } from "react-router-dom";

// Número de soporte de Publi.lat (WhatsApp).
const SUPPORT_PHONE = "595975112248";
const SUPPORT_MSG = encodeURIComponent("Hola, necesito ayuda con Publi.lat 🙌");

// Globo flotante de WhatsApp -> soporte. Presente en todo el panel, salvo el Inbox
// (ahí taparía el campo de escribir). Lleva id para que el tour lo pueda resaltar.
export default function SupportBubble() {
  const { pathname } = useLocation();
  if (pathname.startsWith("/inbox")) return null;

  return (
    <a
      id="support-bubble"
      href={`https://wa.me/${SUPPORT_PHONE}?text=${SUPPORT_MSG}`}
      target="_blank"
      rel="noopener noreferrer"
      title="Soporte por WhatsApp"
      aria-label="Soporte por WhatsApp"
      className="fixed bottom-5 right-5 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-[#25D366] shadow-lg shadow-black/40 transition hover:scale-105 active:scale-95"
    >
      <svg viewBox="0 0 32 32" className="h-8 w-8" fill="#fff" aria-hidden="true">
        <path d="M16.004 5.333c-5.883 0-10.667 4.784-10.667 10.667 0 1.88.492 3.72 1.427 5.341L5.333 26.667l5.472-1.43a10.63 10.63 0 0 0 5.199 1.35h.004c5.883 0 10.667-4.784 10.667-10.667 0-2.85-1.11-5.53-3.127-7.546a10.6 10.6 0 0 0-7.544-3.041zm0 19.2h-.003a8.85 8.85 0 0 1-4.51-1.235l-.323-.192-3.247.851.867-3.165-.211-.325a8.84 8.84 0 0 1-1.355-4.72c0-4.888 3.978-8.866 8.87-8.866a8.81 8.81 0 0 1 6.27 2.6 8.81 8.81 0 0 1 2.597 6.272c0 4.888-3.978 8.866-8.868 8.866zm4.862-6.638c-.267-.134-1.577-.778-1.822-.867-.244-.089-.422-.133-.6.134-.178.267-.688.867-.844 1.045-.155.178-.311.2-.578.067-.267-.134-1.125-.415-2.143-1.322-.792-.706-1.327-1.578-1.482-1.845-.155-.267-.017-.411.117-.544.12-.12.267-.311.4-.467.134-.155.178-.267.267-.445.089-.178.045-.334-.022-.467-.067-.134-.6-1.446-.822-1.98-.216-.52-.437-.45-.6-.458l-.511-.009a.98.98 0 0 0-.711.334c-.245.267-.933.912-.933 2.223s.955 2.578 1.088 2.756c.134.178 1.88 2.87 4.555 4.023.636.275 1.133.439 1.52.562.639.203 1.22.174 1.68.106.512-.077 1.577-.645 1.8-1.267.222-.623.222-1.156.155-1.267-.066-.111-.244-.178-.511-.311z"/>
      </svg>
    </a>
  );
}
