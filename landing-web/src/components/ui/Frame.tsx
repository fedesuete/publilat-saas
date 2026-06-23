import type { ReactNode } from "react";

// Marco tipo navegador para envolver los mockups de producto.
export function BrowserFrame({ url = "app.publi.lat", children }: { url?: string; children: ReactNode }) {
  return (
    <div className="mock-frame">
      <div className="flex items-center gap-2 border-b border-white/10 bg-white/[0.03] px-4 py-2.5">
        <span className="h-3 w-3 rounded-full bg-red-400/70" />
        <span className="h-3 w-3 rounded-full bg-yellow-400/70" />
        <span className="h-3 w-3 rounded-full bg-green-400/70" />
        <span className="ml-3 truncate rounded-md bg-white/5 px-3 py-0.5 text-[11px] text-slate-500">
          {url}
        </span>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

// Marco tipo celular para el chat de WhatsApp.
export function PhoneFrame({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[300px] rounded-[2rem] border border-white/15 bg-black p-2 shadow-2xl shadow-black/50">
      <div className="overflow-hidden rounded-[1.6rem]">{children}</div>
    </div>
  );
}
