import { MessageCircle } from "lucide-react";
import { WHATSAPP_URL } from "../config";

export default function WhatsappFloat() {
  return (
    <a
      href={WHATSAPP_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Hablar por WhatsApp"
      className="group fixed bottom-5 right-5 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-wa-green shadow-lg shadow-emerald-500/30 transition hover:scale-105"
    >
      <span className="absolute inset-0 -z-10 animate-pulseGlow rounded-full bg-wa-green/50 blur-md" />
      <MessageCircle className="h-7 w-7 text-ink" />
    </a>
  );
}
