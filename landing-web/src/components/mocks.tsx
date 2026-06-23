// Mockups con datos de ejemplo (placeholders realistas, listos para reemplazar por
// capturas reales del panel).

export function KanbanMock() {
  const cols: { name: string; tint: string; cards: string[] }[] = [
    { name: "Nuevo", tint: "text-slate-300", cards: ["Promo IG · ref 8F2A", "Camp. Verano · ref 1C9D"] },
    { name: "Interesado", tint: "text-sky-300", cards: ["WhatsApp · ref 77B0"] },
    { name: "Compró", tint: "text-wa-green", cards: ["₲ 150.000", "₲ 320.000"] },
  ];
  return (
    <div className="grid grid-cols-3 gap-2">
      {cols.map((c) => (
        <div key={c.name} className="rounded-lg bg-white/[0.03] p-2">
          <div className={`mb-2 text-[11px] font-semibold uppercase ${c.tint}`}>{c.name}</div>
          <div className="space-y-2">
            {c.cards.map((t, i) => (
              <div key={i} className="rounded-md border border-white/10 bg-ink2 px-2 py-2 text-[11px] text-slate-200">
                {t}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function InboxMock() {
  const chats = [
    { n: "Cliente · ref 8F2A", m: "Hola, quiero info", t: "20:41", on: true },
    { n: "Cliente · ref 77B0", m: "Ya transferí 🙌", t: "20:12", on: false },
    { n: "Cliente · ref 1C9D", m: "¿Hacen envíos?", t: "19:58", on: false },
  ];
  return (
    <div className="grid grid-cols-5 gap-2">
      <div className="col-span-2 space-y-1.5">
        {chats.map((c, i) => (
          <div key={i} className={`rounded-md px-2 py-2 ${c.on ? "bg-white/[0.06]" : "bg-white/[0.02]"}`}>
            <div className="truncate text-[11px] font-medium text-slate-100">{c.n}</div>
            <div className="truncate text-[10px] text-slate-500">{c.m}</div>
          </div>
        ))}
      </div>
      <div className="col-span-3 flex flex-col justify-end gap-1.5 rounded-md bg-[#0b141a] p-2">
        <div className="self-start rounded-lg rounded-tl-sm bg-[#202c33] px-2.5 py-1.5 text-[11px] text-slate-100">
          Hola, quiero info
        </div>
        <div className="self-end rounded-lg rounded-tr-sm bg-[#005c4b] px-2.5 py-1.5 text-[11px] text-white">
          ¡Hola! Te cuento 🙌
        </div>
        <div className="mx-auto rounded-full bg-wa-green/15 px-2 py-0.5 text-[10px] text-wa-green">
          ✓ Lead atribuido
        </div>
      </div>
    </div>
  );
}

export function PaymentMock() {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] p-2.5">
        <div className="flex h-16 w-12 flex-col items-center justify-center rounded-md bg-gradient-to-br from-slate-700 to-slate-800">
          <span className="text-lg">🧾</span>
        </div>
        <div className="text-[11px]">
          <div className="text-slate-200">Comprobante.jpg</div>
          <div className="text-slate-500">leído por IA</div>
        </div>
        <span className="ml-auto rounded-full bg-wa-green/15 px-2 py-1 text-[11px] font-semibold text-wa-green">
          ₲ 150.000
        </span>
      </div>
      <div className="flex items-center justify-between rounded-lg bg-white/[0.03] px-3 py-2 text-[11px]">
        <span className="text-slate-300">Confianza IA</span>
        <span className="font-semibold text-wa-green">98%</span>
      </div>
      <button className="w-full rounded-md bg-gradient-to-r from-wa-green to-emerald-400 py-2 text-[11px] font-semibold text-ink">
        💰 Confirmar compra → Purchase a Meta
      </button>
    </div>
  );
}

